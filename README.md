<div align="center">
  <h1>Figma MCP Local</h1>
  <h3>Use Figma designs with AI coding agents — without an API key.<br/>Export from Figma once, use locally forever.</h3>
  <a href="https://github.com/MiHarsh/figma-local-mcp/blob/main/LICENSE">
    <img alt="MIT License" src="https://img.shields.io/github/license/MiHarsh/figma-local-mcp" />
  </a>
  <a href="https://www.npmjs.com/package/figma-local-mcp">
    <img alt="npm" src="https://img.shields.io/npm/v/figma-local-mcp?color=cb3837&logo=npm" />
  </a>
  <a href="https://www.figma.com/community/plugin/1626137893880787983/framelink-exporter">
    <img alt="Figma Community Plugin" src="https://img.shields.io/badge/Figma_Plugin-Framelink_Exporter-F24E1E?logo=figma&logoColor=white" />
  </a>
</div>

<br/>

A [Model Context Protocol](https://modelcontextprotocol.io/introduction) server + Figma desktop plugin that lets AI coding agents (Cursor, VS Code Copilot, Claude Desktop, Windsurf, Cline, etc.) consume Figma design data from **local files** — no Figma API key, no rate limits, no internet required.

The plugin packages your design as a single ZIP containing the JSON tree **plus** pre-rendered PNG screenshots (for multimodal visual grounding), pre-rendered SVG icons (no path-data reconstruction), and image-fill bytes. The server then exposes three composable tools that hand the agent exactly what it needs to generate **pixel-accurate, semantically-correct** UI code.

> **Built on top of [Framelink MCP](https://github.com/GLips/Figma-Context-MCP)** — uses the same extractor pipeline to simplify raw Figma data into compact, LLM-friendly output. This project adds the offline export path, visual grounding, semantic enrichment, and an agent-directing protocol.

> 🤖 **Fully vibe-coded** — this entire project (plugin + MCP tool + docs) was generated via AI-assisted development. Contributions are welcome!

## Why this over the official Framelink MCP?

The official [Framelink MCP](https://github.com/GLips/Figma-Context-MCP) is excellent for real-time API workflows. This project optimizes for a different shape: **offline, designer-curated exports with visual context baked in.** Concrete differences:

| Capability | Framelink MCP (API-based) | figma-local-mcp (this project) |
|---|---|---|
| **Figma API key / OAuth** | Required | Not needed |
| **Free-tier rate limits** | Hit aggressively on real designs | None — fully local |
| **Internet during use** | Required for every request | Not required after export |
| **Visual grounding** | Image download tool on demand | Pre-rendered PNG @2x of top-level frames, bundled in ZIP, returned as native MCP `image` content block |
| **Icon fidelity** | SVG via API (multiple round-trips) | Pre-rendered SVG markup in sidecar files; agent inlines verbatim |
| **Image fills** | `imageRef` → API download | Bytes bundled locally; `assetPath` injected into the simplified output |
| **Component semantics** | `componentId` + `name` | + heuristic `semanticRole` (`button`, `textbox`, `dropdown`, `checkbox`, `dialog`, …) on every INSTANCE so the agent generates `<input>` / `<select>` / `<button>` instead of generic `<div>` |
| **Agent guidance** | Tool description only | Top-level `REQUIRED_NEXT_ACTIONS` checklist + per-node `renderHint` + **ABSENT-ASSET RULE** that explicitly forbids fabricating stock icons / placeholder URLs / invented SVG when an asset wasn't exported |
| **Cross-page components** | API resolves automatically | Plugin walks `INSTANCE → mainComponent` across pages and bundles the missing definitions in scope |
| **Per-node named styles** | Available via API | Per-node `styles` map captured by plugin, named styles resolved end-to-end |
| **Workflow shape** | Real-time: agent ↔ Figma API | Designer exports once → commits ZIP to repo → agents work offline forever |
| **Reproducibility** | Live data shifts with edits | ZIP is checked-in, deterministic, code-review-able |

**Use this** when you want zero-friction, reproducible, visually-grounded design context in your repo.  
**Use Framelink** when you need live API access (continuously syncing screens, programmatic image downloads outside a designer workflow).

They also compose cleanly side-by-side in the same MCP config.

## Why?

The official Framelink MCP server is excellent, but it requires a Figma API key. Free-tier Figma accounts hit aggressive rate limits, making it impractical for heavy use. This project solves that:

1. **Export** design data + assets from Figma using a desktop plugin (one-time, no API key)
2. **Process** the exported JSON through the same extractor pipeline, enriched with asset paths + semantic roles
3. **Feed** the simplified output to your AI coding agent, which chains into `get_node_image` / `get_node_svg` for pixel-perfect output

Same quality output as the API-based approach — zero API calls.

## How It Works

```
┌──────────────┐   Export ZIP    ┌────────────────────────────┐   Unzip into project   ┌──────────────────────────┐
│  Figma       │ ──────────────► │  myfile.zip                │ ─────────────────────► │  your-project/designs/   │
│  (Plugin)    │                 │  ├─ myfile.json            │                        │  ├─ myfile.json          │
│              │                 │  └─ myfile.assets/         │                        │  └─ myfile.assets/       │
│              │                 │     ├─ node_*.png  (frames)│                        │     ├─ *.png  (frames)   │
│              │                 │     ├─ icon_*.svg  (icons) │                        │     ├─ *.svg  (icons)    │
│              │                 │     └─ image_*.png (fills) │                        │     └─ *.png  (fills)    │
└──────────────┘                 └────────────────────────────┘                        └────────────┬─────────────┘
                                                                                                   │
                                                                                            Agent prompt:
                                                                                      "Implement the design
                                                                                    from ./designs/myfile.json"
                                                                                                   │
                                                                                                   ▼
┌──────────────┐  Simplified JSON   ┌──────────────────┐    Reads JSON     ┌──────────────────────────┐
│  Agent       │ ◄───────────────── │   MCP Server     │ ◄──────────────── │  get_figma_data_from_json│
│  writes code │  + asset paths +   │  (extractor      │   + manifest      │                          │
│              │  REQUIRED_NEXT_…   │   pipeline +     │   + asset paths   │  Agent then chains:      │
│              │   ◄─ PNG bytes ──  │   asset wiring)  │ ◄──── reads ────  │  get_node_image  ──┐     │
│              │   ◄─ SVG markup ─  │                  │       sidecars    │  get_node_svg    ──┤     │
└──────────────┘                    └──────────────────┘                   └────────────────────┘     │
                                                                                                      │
                                                                                                      ▼
                                                                                          Pixel-accurate,
                                                                                          semantically-correct
                                                                                          UI code
```

The agent doesn't just see *coordinates and colors* — it **views** the rendered design (multimodal PNG) and **inlines** real SVGs, so generated UI matches the design instead of drifting from it.

## Quick Start

### Option A: Use via npx (recommended)

No clone required. Just configure your editor's MCP config:

```json
{
  "mcpServers": {
    "figma-local": {
      "command": "npx",
      "args": ["-y", "figma-local-mcp", "--stdio"]
    }
  }
}
```

Then skip to [step 2 (build the Figma plugin)](#2-build-the-figma-plugin).

### Option B: Clone and build locally

#### 1. Build the MCP server

```bash
git clone https://github.com/MiHarsh/figma-local-mcp.git
cd figma-local-mcp
pnpm install
pnpm build
```

### 2. Install the Figma plugin

**Option A: Install from the Figma Community (recommended)** — zero build, auto-updates.

1. Open the plugin's Community page: <https://www.figma.com/community/plugin/1626137893880787983/framelink-exporter>
2. Click **Open in…** → your Figma file (or **Try it out**)
3. The plugin is now available under **Plugins → Framelink Exporter** in every file

**Option B: Sideload the pre-built plugin**

1. Go to the [latest GitHub Release](https://github.com/MiHarsh/figma-local-mcp/releases/latest)
2. Download `figma-plugin.zip`
3. Unzip to any folder
4. Open the **Figma desktop app**
5. Go to **Plugins → Development → Import plugin from manifest...**
6. Select `manifest.json` from the unzipped folder
7. The plugin appears under **Plugins → Development → Framelink Exporter**

**Option C: Build from source**

```bash
cd figma-plugin
npm install
npm run build
```

Then import `figma-plugin/manifest.json` in Figma as above.

### 3. Export design data

1. Open any Figma file
2. Run the plugin: **Plugins → Development → Framelink Exporter**
3. Select the nodes/frames you want to export
4. Pick which assets to include (PNG frame renders, SVG icons, image-fill bytes — all on by default)
5. Click **Export as ZIP** — a `.zip` downloads automatically containing your JSON + an `<filename>.assets/` folder
6. Unzip into your project (e.g. `./designs/`); the plugin auto-closes with a Figma toast confirming the export

### 4. Configure MCP in your editor

Add to your editor's MCP config (`mcp.json`, `.cursor/mcp.json`, etc.):

**Via npx (recommended — no clone needed):**
```json
{
  "mcpServers": {
    "figma-local": {
      "command": "npx",
      "args": ["-y", "figma-local-mcp", "--stdio"]
    }
  }
}
```

**Via local clone — Mac / Linux:**
```json
{
  "mcpServers": {
    "figma-local": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/figma-local-mcp/dist/bin.js", "--stdio"]
    }
  }
}
```

**Via local clone — Windows:**
```json
{
  "mcpServers": {
    "figma-local": {
      "type": "stdio",
      "command": "node",
      "args": ["C:\\path\\to\\figma-local-mcp\\dist\\bin.js", "--stdio"]
    }
  }
}
```

> No `FIGMA_API_KEY` needed. No `env` block needed. No `PORT` needed (stdio mode doesn't use HTTP). Just the path to `dist/bin.js`.

### 5. Use it

Open your editor's agent/chat mode and ask:

> Build a React component matching `./designs/my_dashboard.json`

A capable agent will then chain three tool calls automatically:

1. `get_figma_data_from_json({ filePath })` → simplified design tree + `REQUIRED_NEXT_ACTIONS` checklist + per-node `imagePath` / `svgPath` / `renderHint` / `semanticRole`
2. `get_node_image({ filePath, nodeId })` → rendered PNG of the root frame as a native MCP image content block (the agent *sees* the design)
3. `get_node_svg({ filePath, nodeId })` for every node carrying `svgPath` → exact icon markup, inlined verbatim

The result: code that uses `<input type="email">` not `<div>` (because `semanticRole: textbox`), real SVGs not invented path data, and matches the layout/spacing of the actual design because the agent grounded its output in the rendered image.

## MCP Tools

### `get_figma_data_from_json`

Reads a Framelink-exported JSON file and returns the simplified design tree. When the export carries an asset manifest, the response is enriched with:

- **`REQUIRED_NEXT_ACTIONS`** — top-level checklist of follow-up tool calls (e.g. *"View root frame screenshot: get_node_image(filePath, '1:23')"*)
- **`renderHint`** on every node with an exported asset — imperative directive to call `get_node_image` / `get_node_svg`
- **`componentName`** + **`semanticRole`** on every INSTANCE — heuristic mapping to UI primitives (`button`, `textbox`, `dropdown`, `checkbox`, `dialog`, `card`, `tab`, `navigation`, `badge`, `icon`, …)
- **`assetPath`** on every image fill — local sidecar PNG path so agents reference real bytes, not placeholder URLs
- **ABSENT-ASSET RULE** in the metadata `usage` field — explicitly forbids the agent from fabricating stock icons / placeholder image URLs / invented SVG when an asset wasn't exported

| Parameter | Required | Description |
|-----------|----------|-------------|
| `filePath` | Yes | Absolute or relative path to the exported JSON file |
| `depth` | No | Max tree traversal depth. Only use if explicitly requested |

### `get_node_image`

Returns the rendered PNG screenshot of a Figma node as an **MCP `image` content block** that multimodal agents (Claude, GPT-4o, Gemini) view directly. Call this for any node carrying `imagePath` — it's the single biggest fidelity unlock for code generation.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `filePath` | Yes | Same JSON path you passed to `get_figma_data_from_json` |
| `nodeId` | Yes | Figma node id (e.g. `"1:23"`) — must carry `imagePath` in the simplified output |

### `get_node_svg`

Returns the exact SVG markup of an icon / vector subtree. Use for every node tagged `IMAGE-SVG` that carries `svgPath`. Inline the output verbatim into your React/Vue/Svelte component — no path-data reconstruction needed.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `filePath` | Yes | Same JSON path you passed to `get_figma_data_from_json` |
| `nodeId` | Yes | Figma node id of the vector subtree |

**Example prompts:**
> Implement the design from `./designs/dashboard.json`

> Build the login page from the exported Figma file at `C:\projects\app\designs\login_2026-04-14.json`

## Figma Plugin

The `figma-plugin/` directory contains a Figma desktop plugin that exports design data + assets as a single ZIP. See [`figma-plugin/README.md`](./figma-plugin/README.md) for the full plugin docs.

### Export Options

- **Scope** — selected nodes (`GetFileNodesResponse` shape) or current page (`GetFileResponse` shape)
- **Assets** (all on by default)
  - *Render selected frames as PNG (@2x)* — visual grounding
  - *Export icon subtrees as SVG* — actual vector markup
  - *Include image-fill bytes* — raster fills referenced by `imageRef`
- **Limit traversal depth** — cap how deep the tree serialization goes

### What Gets Captured

| Category | Properties |
|----------|-----------|
| **Layout** | `absoluteBoundingBox`, `constraints`, auto-layout (`layoutMode`, `itemSpacing`, `padding*`, sizing modes) |
| **Visuals** | `fills`, `strokes`, `effects`, `opacity`, `cornerRadius`, `blendMode`, `clipsContent` |
| **Per-node named-style refs** | `styles` map (`{fill, text, effect, stroke}` → styleId) so the extractor resolves design-system style names |
| **Text** | `characters`, `style` (font family/size/weight/alignment/line height/letter spacing), `styleOverrideTable` |
| **Components** | `componentProperties`, `componentPropertyDefinitions`, `componentId`, component set metadata, **plus cross-scope component metadata** for instances whose main component lives outside the export scope |
| **Assets** | Top-level `framelinkExport` block carrying the manifest for PNGs, SVGs, and image-fill bytes |
| **Structure** | Full node tree with `id`, `name`, `type`, `visible`, `children` |

### Plugin Development

```bash
cd figma-plugin
npm run watch    # Rebuild on file changes
```

## CLI Flags

| Flag | Description |
|------|-------------|
| `--stdio` | Run in stdio mode (required for MCP clients) |
| `--json` | Output in JSON instead of YAML |
| `--port <n>` | HTTP server port (default: 3333) |
| `--host <h>` | HTTP server host (default: 127.0.0.1) |

## Run alongside the official Framelink MCP

If you also need **real-time API access** (live data, programmatic image downloads outside a designer-curated export), the two servers compose cleanly — different tool names, different workflows, no conflict:

```json
{
  "mcpServers": {
    "figma-api": {
      "command": "npx",
      "args": ["-y", "figma-developer-mcp", "--figma-api-key=YOUR-KEY", "--stdio"]
    },
    "figma-local": {
      "command": "npx",
      "args": ["-y", "figma-local-mcp", "--stdio"]
    }
  }
}
```

## Contributing

Contributions are welcome! Some directions still on the table:

- Smarter cross-scope component definition resolution (variants, nested instances)
- `get_node` / `list_figma_frames` tools for non-truncating navigation of large files
- `boundVariables` (Figma Variables → design tokens) capture in the plugin
- Better naming-hygiene normalization (collapse `Frame 23`, `Group 4` boilerplate names)
- Prototype interaction data (hover / click / transitions)

Fork it, hack on it, open a PR.

## Credits

Built on top of [Framelink MCP for Figma](https://github.com/GLips/Figma-Context-MCP) by [GLips](https://github.com/GLips). The extractor pipeline that simplifies raw Figma data is theirs — this project adds the offline export layer.

## License

MIT
