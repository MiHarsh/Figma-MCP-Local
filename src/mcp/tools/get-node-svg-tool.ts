import { z } from "zod";
import fs from "fs/promises";
import { Logger } from "~/utils/logger.js";
import type { ToolExtra } from "~/mcp/progress.js";
import { readFramelinkJson, resolveAssetPath } from "~/utils/framelink-export.js";

const parametersSchema = z.object({
  filePath: z
    .string()
    .describe("Path to the same Figma JSON file you passed to `get_figma_data_from_json`."),
  nodeId: z
    .string()
    .describe(
      "Figma node ID (e.g. \"1:23\") of the icon/vector subtree whose SVG markup you want. " +
        "Use the `id` field from a node in the simplified output that carries an `svgPath`.",
    ),
});

export type GetNodeSvgParams = z.infer<typeof parametersSchema>;

async function handler(params: GetNodeSvgParams, extra: ToolExtra) {
  void extra;
  try {
    const { filePath, nodeId } = parametersSchema.parse(params);
    const { framelink, resolvedPath } = await readFramelinkJson(filePath);

    if (!framelink) {
      return errorResult(
        `JSON file at ${resolvedPath} has no framelinkExport block. Re-export with the Figma plugin (v1.1+) ` +
          "with 'Export icon subtrees as SVG' enabled.",
      );
    }

    const entry = framelink.assets[nodeId];
    if (!entry?.svg) {
      return errorResult(
        `No SVG asset for node "${nodeId}". Available SVG nodes: ` +
          `[${Object.entries(framelink.assets).filter(([, v]) => v.svg).map(([k]) => k).join(", ") || "none"}]. ` +
          "Re-export with 'Export icon subtrees as SVG' enabled if you need this node as SVG.",
      );
    }

    const assetPath = resolveAssetPath(resolvedPath, entry.svg);
    const text = await fs.readFile(assetPath, "utf-8");

    Logger.log(`Returning SVG ${entry.svg} (${text.length} chars) for node ${nodeId}`);

    return {
      content: [{ type: "text" as const, text }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    Logger.error("Error reading node SVG:", message);
    return errorResult(`Error reading node SVG: ${message}`);
  }
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

export const getNodeSvgTool = {
  name: "get_node_svg",
  description:
    "Retrieve the actual SVG markup of an icon or vector subtree from the asset manifest produced " +
    "by the Framelink plugin. Use this for any node tagged `IMAGE-SVG` in the simplified output — " +
    "the SVG is far higher fidelity than reconstructing geometry from path data, and can be inlined " +
    "directly into React/Vue components.",
  parametersSchema,
  handler,
} as const;
