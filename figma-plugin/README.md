# Framelink Exporter — Figma Plugin

Companion plugin for [**figma-local-mcp**](https://github.com/MiHarsh/figma-local-mcp) — exports Figma design data + assets (PNG renders, SVG icons, image-fill bytes) as a single `.zip` so AI coding agents can consume your designs without an API key, OAuth dance, or rate limits.

> **Heads up:** this plugin is the *producer*. The `.zip` it generates is meant to be unzipped into your repo and read by the MCP server. You need both pieces installed.

🎨 **Figma Community:** <https://www.figma.com/community/plugin/1626137893880787983/framelink-exporter>
📦 **MCP server:** [`figma-local-mcp`](https://www.npmjs.com/package/figma-local-mcp) on npm
🐙 **Source / issues:** https://github.com/MiHarsh/figma-local-mcp

---

## Quick start

### 1. Install the MCP server

```bash
npm install -g figma-local-mcp     # or use npx in your client config
```

### 2. Add it to your AI client

<details><summary><b>Cursor / Cline / Claude Desktop (MCP config snippet)</b></summary>

```jsonc
{
  "mcpServers": {
    "figma-local": {
      "command": "npx",
      "args": ["-y", "figma-local-mcp", "--stdio"]
    }
  }
}
```

Restart the client. You should see three new tools: `get_figma_data_from_json`, `get_node_image`, `get_node_svg`.
</details>

### 3. Install this plugin in Figma

**Option A: Install from the Figma Community (recommended)** — zero build, auto-updates.

Open the plugin's Community page: <https://www.figma.com/community/plugin/1626137893880787983/framelink-exporter> → click **Open in…** to add it to your Figma. It will appear under **Plugins → Framelink Exporter** in every file.

**Option B: Build & sideload from source** (useful for development)

```bash
cd figma-plugin
npm install
npm run build
```

Then in the Figma desktop app: **Plugins → Development → Import plugin from manifest…** → pick `figma-plugin/manifest.json`.

### 4. Export → unzip → ask your agent

1. Run **Plugins → Development → Framelink Exporter**
2. Select the frames you want to export
3. Click **Export as ZIP** → unzip into your repo (e.g. `./design/`)
4. In your AI client:
   > *"Build a React component matching `./design/myfile.json`"*

The agent calls `get_figma_data_from_json` → reads the manifest → calls `get_node_image` for ground truth → calls `get_node_svg` for icons → generates code with the actual rendered design as a reference.

---

## How it works

The plugin serializes the Figma node tree into the exact JSON shape that the Figma REST API returns (`GetFileNodesResponse` for selected nodes, `GetFileResponse` for full-page exports), with a `framelinkExport` metadata block at the root carrying an asset manifest.

When asset export is enabled (default), the plugin packages the JSON + an `<filename>.assets/` folder of sidecar files into a single `.zip` download.

## Export options

- **Scope**
  - *Export selected nodes* — produces `GetFileNodesResponse` shape
  - *Export current page* — produces `GetFileResponse` shape
- **Assets**
  - *Render selected frames as PNG (@2x)* — top-level frames are rendered for visual grounding
  - *Export icon subtrees as SVG* — vector-only subtrees are rendered as actual SVG markup (no path-data reconstruction needed)
  - *Include image-fill bytes* — raster fills referenced by `imageRef` are saved as PNG bytes
- **Limit traversal depth** — caps how many levels deep the tree serialization goes

## What gets exported

Everything Framelink's extractors consume, plus the new asset references the MCP wires into the simplified output:

- **Layout** — `absoluteBoundingBox`, `constraints`, auto-layout (`layoutMode`, `itemSpacing`, `padding*`, sizing modes)
- **Visuals** — `fills`, `strokes`, `effects`, `opacity`, `cornerRadius`, `blendMode`, `clipsContent`
- **Per-node named-style references** — the `styles` map (`{fill, text, effect, stroke}` → styleId) so the extractor can resolve design-system style names
- **Text** — `characters`, `style` (font, size, weight, alignment, line height), `styleOverrideTable`
- **Components** — `componentProperties`, `componentPropertyDefinitions`, `componentId`, plus cross-scope component metadata for instances whose main component lives outside the export scope
- **Structure** — Full node tree with `id`, `name`, `type`, `visible`, `children`

### Asset manifest (`framelinkExport`)

A top-level `framelinkExport` block carries metadata + the asset manifest:

```jsonc
{
  "framelinkExport": {
    "pluginVersion": "1.2.0",
    "exportedAt": "2026-05-16T...",
    "scope": "selection",
    "depth": null,
    "fileName": "MyDesignFile",
    "pageId": "0:1",
    "pageName": "Page 1",
    "rootNodeIds": ["1:23"],
    "assetsFolder": "design.assets",
    "assets": {
      "1:23": { "image": "design.assets/node_1_23.png", "imageScale": 2 },
      "5:67": { "svg":   "design.assets/icon_5_67.svg" }
    },
    "imageFills": {
      "abc123...": "design.assets/image_abc123.png"
    },
    "options": { "exportFrameImages": true, "exportSvgs": true, "exportImageFills": true }
  }
}
```

The MCP server reads this block and:
- stamps `imagePath` / `svgPath` / `renderHint` onto matching nodes in the simplified output
- resolves `componentId` → `componentName` + heuristic `semanticRole` (button, textbox, dropdown, …) on every INSTANCE so generated code uses semantic markup
- injects local `assetPath` into image-fill style entries
- emits a top-level `REQUIRED_NEXT_ACTIONS` checklist telling the agent which `get_node_image` / `get_node_svg` calls to make

## Development

```bash
npm run watch   # Rebuild on file changes
```

After editing, reload the plugin in Figma (right-click in the plugin menu → **Run last plugin** or re-open it).

## Project structure

```
figma-plugin/
├── manifest.json       # Figma plugin manifest
├── package.json
├── tsconfig.json
├── build.mjs           # esbuild build (target: es2017 — Figma sandbox safe)
├── src/
│   ├── code.ts         # Plugin sandbox: node serialization + asset rendering
│   └── ui.html         # Plugin UI: export controls + inline ZIP packager
└── dist/               # Build output (git-ignored)
    ├── code.js
    └── ui.html
```

## License

MIT — same as the parent [figma-local-mcp](https://github.com/MiHarsh/figma-local-mcp) project.
