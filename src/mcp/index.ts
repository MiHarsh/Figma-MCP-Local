import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolExtra } from "./progress.js";
import {
  getFigmaDataFromJsonTool,
  getNodeImageTool,
  getNodeSvgTool,
  type GetFigmaDataFromJsonParams,
  type GetNodeImageParams,
  type GetNodeSvgParams,
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

  server.registerTool(
    getNodeImageTool.name,
    {
      title: "Get Node Image",
      description: getNodeImageTool.description,
      inputSchema: getNodeImageTool.parametersSchema,
      annotations: { readOnlyHint: true },
    },
    (params: GetNodeImageParams, extra: ToolExtra) => getNodeImageTool.handler(params, extra),
  );

  server.registerTool(
    getNodeSvgTool.name,
    {
      title: "Get Node SVG",
      description: getNodeSvgTool.description,
      inputSchema: getNodeSvgTool.parametersSchema,
      annotations: { readOnlyHint: true },
    },
    (params: GetNodeSvgParams, extra: ToolExtra) => getNodeSvgTool.handler(params, extra),
  );

  return server;
}

export { createServer };
