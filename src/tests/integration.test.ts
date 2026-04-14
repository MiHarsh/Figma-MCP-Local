import { createServer } from "../mcp/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const describeOrSkip = process.env.RUN_FIGMA_INTEGRATION === "1" ? describe : describe.skip;

describeOrSkip("Figma MCP Local Server Tests", () => {
  let server: McpServer;
  let client: Client;

  beforeAll(async () => {
    server = createServer();

    client = new Client({
      name: "figma-test-client",
      version: "1.0.0",
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterAll(async () => {
    await client.close();
  });

  describe("Get Figma Data from JSON", () => {
    it("should return error for missing file", async () => {
      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "get_figma_data_from_json",
            arguments: { filePath: "/tmp/nonexistent-file.json" },
          },
        },
        CallToolResultSchema,
      );

      expect(result.isError).toBe(true);
    }, 60000);
  });
});
