import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createServer } from "~/mcp/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  annotateNodesWithAssets,
  resolveAssetPath,
  type FramelinkExportBlock,
} from "~/utils/framelink-export.js";
import type { SimplifiedNode } from "~/extractors/types.js";

describe("annotateNodesWithAssets", () => {
  it("stamps imagePath / imageScale / svgPath onto matching nodes by id", () => {
    const nodes: SimplifiedNode[] = [
      {
        id: "1:2",
        name: "Frame",
        type: "FRAME",
        children: [
          { id: "3:4", name: "Icon", type: "IMAGE-SVG" },
          { id: "5:6", name: "Text", type: "TEXT" },
        ],
      },
    ];
    const manifest: FramelinkExportBlock["assets"] = {
      "1:2": { image: "design.assets/node_1_2.png", imageScale: 2 },
      "3:4": { svg: "design.assets/icon_3_4.svg" },
    };

    annotateNodesWithAssets(nodes, manifest);

    expect(nodes[0].imagePath).toBe("design.assets/node_1_2.png");
    expect(nodes[0].imageScale).toBe(2);
    expect(nodes[0].children![0].svgPath).toBe("design.assets/icon_3_4.svg");
    // Unmatched node untouched
    expect(nodes[0].children![1].imagePath).toBeUndefined();
    expect(nodes[0].children![1].svgPath).toBeUndefined();
  });

  it("is a no-op when manifest is missing or empty", () => {
    const nodes: SimplifiedNode[] = [{ id: "1:2", name: "x", type: "FRAME" }];
    annotateNodesWithAssets(nodes, undefined);
    annotateNodesWithAssets(nodes, {});
    expect(nodes[0].imagePath).toBeUndefined();
  });
});

describe("resolveAssetPath", () => {
  it("resolves a relative asset path against the JSON file's directory", () => {
    const jsonPath = path.join(os.tmpdir(), "subdir", "design.json");
    const resolved = resolveAssetPath(jsonPath, "design.assets/node_1_2.png");
    expect(resolved).toBe(path.resolve(os.tmpdir(), "subdir", "design.assets", "node_1_2.png"));
  });

  it("rejects paths that escape the JSON directory (path traversal guard)", () => {
    const jsonPath = path.join(os.tmpdir(), "subdir", "design.json");
    expect(() => resolveAssetPath(jsonPath, "../../etc/passwd")).toThrow(/outside/);
  });
});

describe("Asset-aware MCP tools (end-to-end)", () => {
  let server: McpServer;
  let client: Client;
  let tmpDir: string;
  let jsonPath: string;

  // Smallest possible PNG (1x1 transparent) — base64 of the canonical bytes
  // used in test fixtures across the ecosystem.
  const PNG_1X1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
    "base64",
  );

  beforeEach(async () => {
    server = createServer();
    client = new Client({ name: "framelink-test-client", version: "1.0.0" });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientT), server.connect(serverT)]);

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "framelink-test-"));
    jsonPath = path.join(tmpDir, "design.json");

    // Build a minimal Framelink-shaped export with one frame + one icon, and
    // matching sidecar PNG + SVG files. Validates the full read → resolve →
    // return-content path without depending on a real Figma export.
    const assetsFolder = "design.assets";
    const pngName = "node_1_2.png";
    const svgName = "icon_3_4.svg";
    await fs.mkdir(path.join(tmpDir, assetsFolder));
    await fs.writeFile(path.join(tmpDir, assetsFolder, pngName), PNG_1X1);
    await fs.writeFile(
      path.join(tmpDir, assetsFolder, svgName),
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="4"/></svg>',
    );

    const figmaExport = {
      name: "TestFile",
      framelinkExport: {
        pluginVersion: "1.1.0",
        exportedAt: "2026-05-16T00:00:00Z",
        scope: "selection",
        depth: null,
        fileName: "TestFile",
        pageId: "0:1",
        pageName: "Page 1",
        rootNodeIds: ["1:2"],
        assetsFolder,
        assets: {
          // Realistic plugin shape: frame 1:2 only contains vectors → plugin
          // emits both an image render AND an SVG for the same root node, and
          // the extractor's collapseSvgContainers drops 3:4 from the simplified
          // tree (folded into the parent's IMAGE-SVG).
          "1:2": {
            image: `${assetsFolder}/${pngName}`,
            imageScale: 2,
            svg: `${assetsFolder}/${svgName}`,
          },
        },
        imageFills: {},
        options: { exportFrameImages: true, exportSvgs: true, exportImageFills: true },
      },
      nodes: {
        "1:2": {
          document: {
            id: "1:2",
            name: "Frame",
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
            children: [
              {
                id: "3:4",
                name: "Icon",
                type: "VECTOR",
                absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
              },
            ],
          },
          components: {},
          componentSets: {},
          styles: {},
        },
      },
    };

    await fs.writeFile(jsonPath, JSON.stringify(figmaExport, null, 2));
  });

  afterEach(async () => {
    await client.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("get_figma_data_from_json surfaces framelinkExport metadata + imagePath/svgPath on nodes", async () => {
    const result = await client.request(
      {
        method: "tools/call",
        params: { name: "get_figma_data_from_json", arguments: { filePath: jsonPath } },
      },
      CallToolResultSchema,
    );

    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("framelinkExport");
    expect(text).toContain("pluginVersion: 1.1.0");
    expect(text).toContain("imagePath: design.assets/node_1_2.png");
    // VECTOR-only FRAME collapses to IMAGE-SVG; both image AND svg paths land
    // on the surviving parent node so the agent can pick its preferred fidelity.
    expect(text).toContain("svgPath: design.assets/icon_3_4.svg");
    // Imperative directives + per-node renderHint
    expect(text).toContain("REQUIRED_NEXT_ACTIONS");
    expect(text).toContain("get_node_image");
    expect(text).toContain("renderHint:");
  });

  it("annotates INSTANCE nodes with componentName + semanticRole", async () => {
    // Build a mini export with a Button component + an instance referencing it.
    const componentExport = {
      name: "WithComponents",
      framelinkExport: {
        pluginVersion: "1.1.0",
        exportedAt: "2026-05-16T00:00:00Z",
        scope: "selection",
        depth: null,
        fileName: "WithComponents",
        pageId: "0:1",
        pageName: "Page 1",
        rootNodeIds: ["10:0"],
        assetsFolder: "wc.assets",
        assets: {},
        imageFills: {},
        options: { exportFrameImages: false, exportSvgs: false, exportImageFills: false },
      },
      nodes: {
        "10:0": {
          document: {
            id: "10:0",
            name: "Container",
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
            children: [
              {
                id: "20:0",
                name: "Primary CTA",
                type: "INSTANCE",
                componentId: "30:0",
                absoluteBoundingBox: { x: 0, y: 0, width: 120, height: 40 },
              },
              {
                id: "21:0",
                name: "Email field",
                type: "INSTANCE",
                componentId: "31:0",
                absoluteBoundingBox: { x: 0, y: 50, width: 200, height: 40 },
              },
            ],
          },
          components: {
            "30:0": { key: "k1", name: "Default", description: "Solid filled button" },
            "31:0": { key: "k2", name: "TextField/Default", description: "" },
          },
          componentSets: {},
          styles: {},
        },
      },
    };
    const componentJsonPath = path.join(tmpDir, "components.json");
    await fs.writeFile(componentJsonPath, JSON.stringify(componentExport));

    const result = await client.request(
      {
        method: "tools/call",
        params: { name: "get_figma_data_from_json", arguments: { filePath: componentJsonPath } },
      },
      CallToolResultSchema,
    );

    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    // Layer name "Primary CTA" → button (CTA pattern)
    expect(text).toMatch(/semanticRole:\s*button/);
    // Component name "TextField/Default" → textbox
    expect(text).toMatch(/semanticRole:\s*textbox/);
    // Component name surfaces directly on the instance
    expect(text).toContain("componentName: TextField/Default");
    // Component description is preserved when non-empty
    expect(text).toContain("componentDescription: Solid filled button");
  });

  it("get_node_image returns an MCP image content block with the PNG bytes", async () => {
    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "get_node_image",
          arguments: { filePath: jsonPath, nodeId: "1:2" },
        },
      },
      CallToolResultSchema,
    );

    expect(result.isError).toBeFalsy();
    const content = result.content[0] as { type: string; data: string; mimeType: string };
    expect(content.type).toBe("image");
    expect(content.mimeType).toBe("image/png");
    expect(Buffer.from(content.data, "base64").equals(PNG_1X1)).toBe(true);
  });

  it("get_node_svg returns the raw SVG markup as text", async () => {
    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "get_node_svg",
          arguments: { filePath: jsonPath, nodeId: "1:2" },
        },
      },
      CallToolResultSchema,
    );

    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("<svg");
    expect(text).toContain("<circle");
  });

  it("returns a helpful error when asking for an image of a node that has none", async () => {
    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "get_node_image",
          arguments: { filePath: jsonPath, nodeId: "9:99" },
        },
      },
      CallToolResultSchema,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("No image asset for node");
    // Lists what IS available so the agent can self-correct
    expect(text).toContain("1:2");
  });

  it("falls back gracefully when the JSON has no framelinkExport block (legacy export)", async () => {
    const legacyJson = {
      name: "Legacy",
      nodes: {
        "1:2": {
          document: {
            id: "1:2",
            name: "Frame",
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
          },
          components: {},
          componentSets: {},
          styles: {},
        },
      },
    };
    const legacyPath = path.join(tmpDir, "legacy.json");
    await fs.writeFile(legacyPath, JSON.stringify(legacyJson));

    const dataResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "get_figma_data_from_json",
          arguments: { filePath: legacyPath },
        },
      },
      CallToolResultSchema,
    );
    expect(dataResult.isError).toBeFalsy();
    const text = (dataResult.content[0] as { text: string }).text;
    expect(text).not.toContain("framelinkExport");

    const imgResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "get_node_image",
          arguments: { filePath: legacyPath, nodeId: "1:2" },
        },
      },
      CallToolResultSchema,
    );
    expect(imgResult.isError).toBe(true);
    expect((imgResult.content[0] as { text: string }).text).toContain("no framelinkExport");
  });
});
