import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "~/mcp/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

describe("tool validation", () => {
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    server = createServer();
    client = new Client({ name: "validation-test-client", version: "1.0.0" });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientT), server.connect(serverT)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("returns error for missing filePath", async () => {
    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "get_figma_data_from_json",
          arguments: {},
        },
      },
      CallToolResultSchema,
    );
    expect(result.isError).toBe(true);
  });

  it("returns error for non-existent file", async () => {
    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "get_figma_data_from_json",
          arguments: { filePath: "/tmp/does-not-exist-12345.json" },
        },
      },
      CallToolResultSchema,
    );
    expect(result.isError).toBe(true);
  });
});
