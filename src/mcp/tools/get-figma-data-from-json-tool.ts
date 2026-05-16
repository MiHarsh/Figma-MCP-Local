import { z } from "zod";
import { Logger } from "~/utils/logger.js";
import { sendProgress, startProgressHeartbeat, type ToolExtra } from "~/mcp/progress.js";
import {
  simplifyRawFigmaObject,
  allExtractors,
  collapseSvgContainers,
} from "~/extractors/index.js";
import { serializeResult } from "~/utils/serialize.js";
import {
  measureSimplifiedDesign,
  countNamedStyles,
  detectVariables,
} from "~/services/get-figma-data-metrics.js";
import {
  annotateImageFillsWithAssetPaths,
  annotateNodesWithAssets,
  annotateNodesWithComponentInfo,
  buildNextActions,
  readFramelinkJson,
  type FramelinkExportBlock,
} from "~/utils/framelink-export.js";
import { JsonFileCache } from "~/utils/json-file-cache.js";

const parametersSchema = z.object({
  filePath: z
    .string()
    .describe(
      "Absolute or relative path to a JSON file exported by the Framelink Figma plugin. " +
        "The file must contain a raw Figma API response (GetFileResponse or GetFileNodesResponse), " +
        "optionally with a `framelinkExport` block carrying an asset manifest.",
    ),
  depth: z
    .number()
    .optional()
    .describe(
      "OPTIONAL. Do NOT use unless explicitly requested by the user. Controls how many levels deep to traverse the node tree.",
    ),
});

export type GetFigmaDataFromJsonParams = z.infer<typeof parametersSchema>;

type CachedDesign = {
  framelink: FramelinkExportBlock | undefined;
  rawSize: number;
};

// Cache the parsed JSON + framelink block per (path, mtime). Simplification is
// re-run per request because the `depth` parameter can change between calls and
// the simplified result is cheap relative to JSON parsing of multi-MB files.
const designCache = new JsonFileCache<CachedDesign>();

async function getFigmaDataFromJson(
  params: GetFigmaDataFromJsonParams,
  outputFormat: "yaml" | "json",
  extra: ToolExtra,
) {
  try {
    const { filePath: rawPath, depth } = parametersSchema.parse(params);

    Logger.log(`Reading local Figma JSON from ${rawPath}`);
    await sendProgress(extra, 0, 3, "Reading local Figma JSON file");

    const { raw, framelink, rawSize, resolvedPath } = await readFramelinkJson(rawPath);
    // Warm the cache so sibling tools (get_node_image / get_node_svg) hit it
    // without re-reading the file on the next call from the same agent turn.
    await designCache.getOrLoad(resolvedPath, async () => ({ framelink, rawSize }));

    const nodeCounter = { count: 0 };
    let stopSimplifyHeartbeat: (() => void) | undefined;

    await sendProgress(extra, 1, 3, "Simplifying design data");
    stopSimplifyHeartbeat = startProgressHeartbeat(
      extra,
      () => `Simplifying design data (${nodeCounter.count} nodes processed)`,
    );

    const simplifiedDesign = await simplifyRawFigmaObject(raw, allExtractors, {
      maxDepth: depth,
      afterChildren: collapseSvgContainers,
      nodeCounter,
    });
    stopSimplifyHeartbeat?.();

    // Stamp imagePath / svgPath onto matching nodes from the plugin's manifest.
    annotateNodesWithAssets(simplifiedDesign.nodes, framelink?.assets);
    // Resolve componentId → componentName + heuristic semanticRole on every
    // INSTANCE so agents generate semantic markup instead of generic <div>s.
    annotateNodesWithComponentInfo(
      simplifiedDesign.nodes,
      simplifiedDesign.components,
      simplifiedDesign.componentSets,
    );
    // Inject local image-fill paths into deduplicated style entries so the
    // agent sees `assetPath: design.assets/image_<hash>.png` next to imageRef.
    annotateImageFillsWithAssetPaths(simplifiedDesign.globalVars, framelink?.imageFills);

    const rawSizeKb = rawSize / 1024;
    const hasVariables = detectVariables(raw);
    const namedStyleCount = countNamedStyles(raw);
    const measured = measureSimplifiedDesign(simplifiedDesign);

    await sendProgress(extra, 2, 3, "Serializing response");
    const { nodes, globalVars, ...metadata } = simplifiedDesign;

    // Surface plugin metadata + a brief usage hint so agents understand the
    // payload shape and know when to chain into get_node_image / get_node_svg.
    const enrichedMetadata: Record<string, unknown> = { ...metadata };
    if (framelink) {
      const nextActions = buildNextActions(framelink, simplifiedDesign.nodes);
      enrichedMetadata.framelinkExport = {
        pluginVersion: framelink.pluginVersion,
        exportedAt: framelink.exportedAt,
        scope: framelink.scope,
        depth: framelink.depth,
        pageName: framelink.pageName,
        rootNodeIds: framelink.rootNodeIds,
        assetCount: Object.keys(framelink.assets).length,
        imageFillCount: Object.keys(framelink.imageFills).length,
        // REQUIRED-NEXT-ACTIONS is the loud, scannable section agents pick
        // up first. Phrased as imperatives so the LLM treats it as a checklist.
        REQUIRED_NEXT_ACTIONS: nextActions.length
          ? nextActions
          : ["No assets exported — work from JSON only."],
        usage:
          "MUST use rendered assets when available — they are the source of truth, not the JSON. " +
          "Each node's `renderHint` field tells you the exact tool call. " +
          "INSTANCE nodes carry `componentName` + `semanticRole` (button/textbox/dropdown/…) — " +
          "use these to generate semantic HTML/JSX, not generic <div>s. " +
          "ABSENT-ASSET RULE: when a node has no imagePath/svgPath/assetPath, render an empty " +
          "placeholder sized to the bounding box. NEVER substitute stock icons (FontAwesome, " +
          "lucide, heroicons), placeholder image URLs, fabricated SVG, or invented graphics — " +
          "the user explicitly chose not to export those assets.",
      };
    }
    const result = {
      metadata: enrichedMetadata,
      nodes,
      globalVars,
    };
    const formatted = serializeResult(result, outputFormat);

    Logger.log(
      `Processed local file: ${measured.simplifiedNodeCount} nodes, ` +
        `${rawSizeKb.toFixed(0)} KB raw → ${(Buffer.byteLength(formatted, "utf-8") / 1024).toFixed(0)} KB simplified` +
        (framelink
          ? ` (${Object.keys(framelink.assets).length} node assets, ${Object.keys(framelink.imageFills).length} image fills)`
          : ""),
    );

    return {
      content: [{ type: "text" as const, text: formatted }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    Logger.error(`Error processing local Figma JSON:`, message);
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Error processing local Figma JSON: ${message}` }],
    };
  }
}

export const getFigmaDataFromJsonTool = {
  name: "get_figma_data_from_json",
  description:
    "Process a locally exported Figma JSON file (from the Framelink Figma plugin) and return " +
    "simplified design data. Use this instead of any remote Figma tools to avoid API rate limits. " +
    "When the export carries an asset manifest, the response includes a `REQUIRED_NEXT_ACTIONS` " +
    "list — you MUST follow those imperatives (call `get_node_image` for screenshots, " +
    "`get_node_svg` for icons) before generating any UI code. Nodes also carry `componentName` " +
    "and `semanticRole` (button, textbox, dropdown, …) so generated markup uses the correct " +
    "semantic element.",
  parametersSchema,
  handler: getFigmaDataFromJson,
} as const;
