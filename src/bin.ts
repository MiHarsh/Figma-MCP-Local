#!/usr/bin/env node

import { cli } from "cleye";
import { getServerConfig } from "./config.js";
import { startServer } from "./server.js";

const argv = cli({
  name: "figma-mcp-local",
  version: process.env.NPM_PACKAGE_VERSION ?? "unknown",
  flags: {
    env: {
      type: String,
      description: "Path to custom .env file to load environment variables from",
    },
    port: {
      type: Number,
      description: "Port to run the server on",
    },
    host: {
      type: String,
      description: "Host to run the server on",
    },
    json: {
      type: Boolean,
      description: "Output data from tools in JSON format instead of YAML",
    },
    stdio: {
      type: Boolean,
      description: "Run in stdio transport mode for MCP clients",
    },
  },
});

const isStdio = argv.flags.stdio === true || process.env.NODE_ENV === "cli";
const config = getServerConfig({ ...argv.flags, stdio: isStdio });
startServer(config).catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
