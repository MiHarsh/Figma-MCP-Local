import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Logger } from "../utils/logger.js";
import type { ToolExtra } from "./progress.js";
import {
  getFigmaDataFromJsonTool,
  type GetFigmaDataFromJsonParams,
} from "./tools/index.js";

const serverInfo = {
  name: "Figma MCP Local Server",
  version: process.env.NPM_PACKAGE_VERSION ?? "unknown",
  description:
    "Processes locally exported Figma JSON files and returns simplified design data for AI coding agents. No Figma API key required.",
};

type CreateServerOptions = {
  outputFormat?: "yaml" | "json";
};

function createServer({ outputFormat = "yaml" }: CreateServerOptions = {}) {
  const server = new McpServer(serverInfo);

  server.registerTool(
    getFigmaDataFromJsonTool.name,
    {
      title: "Get Figma Data from JSON",
      description: getFigmaDataFromJsonTool.description,
      inputSchema: getFigmaDataFromJsonTool.parametersSchema,
      annotations: { readOnlyHint: true },
    },
    (params: GetFigmaDataFromJsonParams, extra: ToolExtra) =>
      getFigmaDataFromJsonTool.handler(params, outputFormat, extra),
  );

  return server;
}

export { createServer };
