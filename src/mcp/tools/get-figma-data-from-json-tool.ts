import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { GetFileResponse, GetFileNodesResponse } from "@figma/rest-api-spec";
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

const parametersSchema = z.object({
  filePath: z
    .string()
    .describe(
      "Absolute or relative path to a JSON file exported by the Framelink Figma plugin. " +
        "The file must contain a raw Figma API response (GetFileResponse or GetFileNodesResponse).",
    ),
  depth: z
    .number()
    .optional()
    .describe(
      "OPTIONAL. Do NOT use unless explicitly requested by the user. Controls how many levels deep to traverse the node tree.",
    ),
});

export type GetFigmaDataFromJsonParams = z.infer<typeof parametersSchema>;

async function getFigmaDataFromJson(
  params: GetFigmaDataFromJsonParams,
  outputFormat: "yaml" | "json",
  extra: ToolExtra,
) {
  try {
    const { filePath: rawPath, depth } = parametersSchema.parse(params);
    const resolvedPath = path.resolve(rawPath);

    Logger.log(`Reading local Figma JSON from ${resolvedPath}`);
    await sendProgress(extra, 0, 3, "Reading local Figma JSON file");

    const raw = await fs.readFile(resolvedPath, "utf-8");
    const rawSize = Buffer.byteLength(raw, "utf-8");
    const data: GetFileResponse | GetFileNodesResponse = JSON.parse(raw);

    const nodeCounter = { count: 0 };
    let stopSimplifyHeartbeat: (() => void) | undefined;

    await sendProgress(extra, 1, 3, "Simplifying design data");
    stopSimplifyHeartbeat = startProgressHeartbeat(
      extra,
      () => `Simplifying design data (${nodeCounter.count} nodes processed)`,
    );

    const simplifiedDesign = await simplifyRawFigmaObject(data, allExtractors, {
      maxDepth: depth,
      afterChildren: collapseSvgContainers,
      nodeCounter,
    });
    stopSimplifyHeartbeat?.();

    const rawSizeKb = rawSize / 1024;
    const hasVariables = detectVariables(data);
    const namedStyleCount = countNamedStyles(data);
    const measured = measureSimplifiedDesign(simplifiedDesign);

    await sendProgress(extra, 2, 3, "Serializing response");
    const { nodes, globalVars, ...metadata } = simplifiedDesign;
    const result = { metadata, nodes, globalVars };
    const formatted = serializeResult(result, outputFormat);

    Logger.log(
      `Processed local file: ${measured.simplifiedNodeCount} nodes, ` +
        `${rawSizeKb.toFixed(0)} KB raw → ${(Buffer.byteLength(formatted, "utf-8") / 1024).toFixed(0)} KB simplified`,
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
    "Process a locally exported Figma JSON file (from the Framelink Figma plugin) and " +
    "return simplified design data. Use this instead of get_figma_data when working with " +
    "exported JSON files to avoid Figma API rate limits.",
  parametersSchema,
  handler: getFigmaDataFromJson,
} as const;
