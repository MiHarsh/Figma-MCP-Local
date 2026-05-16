import { z } from "zod";
import fs from "fs/promises";
import { Logger } from "~/utils/logger.js";
import type { ToolExtra } from "~/mcp/progress.js";
import { readFramelinkJson, resolveAssetPath } from "~/utils/framelink-export.js";

const parametersSchema = z.object({
  filePath: z
    .string()
    .describe(
      "Path to the same Figma JSON file you passed to `get_figma_data_from_json`. " +
        "Asset paths in the JSON's `framelinkExport.assets` block are resolved relative to this file.",
    ),
  nodeId: z
    .string()
    .describe(
      "Figma node ID (e.g. \"1:23\") of the node whose rendered PNG you want. " +
        "Use the `id` field from a node in the simplified output that carries an `imagePath`.",
    ),
});

export type GetNodeImageParams = z.infer<typeof parametersSchema>;

async function handler(params: GetNodeImageParams, extra: ToolExtra) {
  void extra;
  try {
    const { filePath, nodeId } = parametersSchema.parse(params);
    const { framelink, resolvedPath } = await readFramelinkJson(filePath);

    if (!framelink) {
      return errorResult(
        `JSON file at ${resolvedPath} has no framelinkExport block. Re-export with the Figma plugin (v1.1+) ` +
          "with 'Render selected frames as PNG' enabled.",
      );
    }

    const entry = framelink.assets[nodeId];
    if (!entry?.image) {
      return errorResult(
        `No image asset for node "${nodeId}". Available image nodes: ` +
          `[${Object.entries(framelink.assets).filter(([, v]) => v.image).map(([k]) => k).join(", ") || "none"}]. ` +
          "Re-export with 'Render selected frames as PNG' enabled if you need this node rendered.",
      );
    }

    const assetPath = resolveAssetPath(resolvedPath, entry.image);
    const bytes = await fs.readFile(assetPath);
    const base64 = bytes.toString("base64");

    Logger.log(`Returning PNG ${entry.image} (${(bytes.length / 1024).toFixed(0)} KB) for node ${nodeId}`);

    // MCP image content blocks are the protocol-native way to deliver pixels
    // to multimodal agents. The agent receives the PNG inline and can reason
    // about it visually — no token-eating base64-in-text workarounds.
    return {
      content: [
        {
          type: "image" as const,
          data: base64,
          mimeType: "image/png",
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    Logger.error("Error reading node image:", message);
    return errorResult(`Error reading node image: ${message}`);
  }
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

export const getNodeImageTool = {
  name: "get_node_image",
  description:
    "Retrieve the rendered PNG screenshot of a Figma node from the asset manifest produced by the " +
    "Framelink plugin. Returns an MCP image content block that multimodal agents can view directly. " +
    "Call this for the root frame BEFORE generating UI code — visual ground truth dramatically " +
    "improves layout, spacing, and color fidelity vs. inferring from JSON alone.",
  parametersSchema,
  handler,
} as const;
