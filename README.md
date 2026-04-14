<div align="center">
  <h1>Figma MCP Local</h1>
  <h3>Use Figma designs with AI coding agents — without an API key.<br/>Export from Figma once, use locally forever.</h3>
  <a href="https://github.com/MiHarsh/Figma-MCP-Local/blob/main/LICENSE">
    <img alt="MIT License" src="https://img.shields.io/github/license/MiHarsh/Figma-MCP-Local" />
  </a>
</div>

<br/>

A [Model Context Protocol](https://modelcontextprotocol.io/introduction) server + Figma desktop plugin that lets AI coding agents (Cursor, VS Code Copilot, Windsurf, etc.) consume Figma design data from **local JSON files** — no Figma API key, no rate limits, no internet required.

> **Built on top of [Framelink MCP](https://github.com/GLips/Figma-Context-MCP)** — uses the same extractor pipeline to simplify raw Figma data into compact, LLM-friendly output. This project adds the offline export path.

> 🤖 **Fully vibe-coded** — this entire project (plugin + MCP tool + docs) was generated via AI-assisted development. Contributions are welcome!

## Why?

The official [Framelink MCP](https://github.com/GLips/Figma-Context-MCP) server is excellent, but it requires a Figma API key. Free-tier Figma accounts hit aggressive rate limits, making it impractical for heavy use. This project solves that:

1. **Export** design data from Figma using a desktop plugin (one-time, no API key)
2. **Process** the exported JSON through the same extractor pipeline
3. **Feed** the simplified output to your AI coding agent

Same quality output as the API-based approach — zero API calls.

## How It Works

```
┌─────────────┐     Export JSON      ┌──────────────────┐     Place in project     ┌─────────────────┐
│  Figma       │ ──────────────────► │  .json file       │ ────────────────────────► │  your-project/  │
│  (Plugin)    │                     │  (downloaded)     │                          │  designs/       │
└─────────────┘                     └──────────────────┘                          └────────┬────────┘
                                                                                           │
                                                                                    Agent prompt:
                                                                              "Implement the design
                                                                           from ./designs/my_app.json"
                                                                                           │
                                                                                           ▼
┌─────────────┐     Simplified       ┌──────────────────┐     Reads file            ┌─────────────────┐
│  Agent       │ ◄────────────────── │  MCP Server       │ ◄──────────────────────── │  get_figma_data │
│  writes code │     design data     │  (extractor       │     & runs extractors     │  _from_json     │
└─────────────┘                     │   pipeline)       │                          └─────────────────┘
                                    └──────────────────┘
```

## Quick Start

### 1. Build the MCP server

```bash
git clone https://github.com/MiHarsh/Figma-MCP-Local.git
cd Figma-MCP-Local
pnpm install
pnpm build
```

### 2. Build the Figma plugin

```bash
cd figma-plugin
npm install
npm run build
```

### 3. Install the plugin in Figma

1. Open the **Figma desktop app**
2. Go to **Plugins → Development → Import plugin from manifest...**
3. Select `figma-plugin/manifest.json` from this repo
4. The plugin appears under **Plugins → Development → Framelink Exporter**

### 4. Export design data

1. Open any Figma file
2. Run the plugin: **Plugins → Development → Framelink Exporter**
3. Select the nodes/frames you want to export
4. Click **Export as JSON** — a `.json` file downloads automatically
5. Place the file in your project (e.g. `designs/` folder)

### 5. Configure MCP in your editor

Add to your editor's MCP config (`mcp.json`, `.cursor/mcp.json`, etc.):

**Mac / Linux:**
```json
{
  "mcpServers": {
    "figma-local": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/Figma-MCP-Local/dist/bin.js", "--stdio"]
    }
  }
}
```

**Windows:**
```json
{
  "mcpServers": {
    "figma-local": {
      "type": "stdio",
      "command": "node",
      "args": ["C:\\path\\to\\Figma-MCP-Local\\dist\\bin.js", "--stdio"]
    }
  }
}
```

> No `FIGMA_API_KEY` needed. No `env` block needed. No `PORT` needed (stdio mode doesn't use HTTP). Just the path to `dist/bin.js`.

### 6. Use it

Open your editor's agent/chat mode and ask:

> Implement the design from `./designs/my_dashboard_2026-04-14.json`

The agent calls `get_figma_data_from_json`, runs the file through the extractor pipeline, and gets clean simplified design data — identical output to what the API-based Framelink MCP produces.

## MCP Tool

### `get_figma_data_from_json`

Reads a locally exported Figma JSON file and returns simplified design data (layout, styling, text, components).

| Parameter | Required | Description |
|-----------|----------|-------------|
| `filePath` | Yes | Absolute or relative path to the exported JSON file |
| `depth` | No | Max tree traversal depth. Only use if explicitly requested |

**Example prompts:**
> Implement the design from `./designs/dashboard.json`

> Build the login page from the exported Figma file at `C:\projects\app\designs\login_2026-04-14.json`

## Figma Plugin

The `figma-plugin/` directory contains a Figma desktop plugin that exports design node data as JSON compatible with the MCP tool.

### Export Options

- **Export selected nodes** — only what you've selected (frames, components, groups)
- **Export current page** — the entire page
- **Limit traversal depth** — cap how deep the tree serialization goes

### What Gets Captured

| Category | Properties |
|----------|-----------|
| **Layout** | `absoluteBoundingBox`, `constraints`, auto-layout (`layoutMode`, `itemSpacing`, `padding*`, sizing modes) |
| **Visuals** | `fills`, `strokes`, `effects`, `opacity`, `cornerRadius`, `blendMode`, `clipsContent` |
| **Text** | `characters`, `style` (font family/size/weight/alignment/line height/letter spacing), `styleOverrideTable` |
| **Components** | `componentProperties`, `componentPropertyDefinitions`, `componentId`, component set metadata |
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

## For API-based Figma Access

If you need **real-time API access** (live Figma data, image downloads), use the official [Framelink MCP for Figma](https://github.com/GLips/Figma-Context-MCP). You can run both servers side-by-side — they complement each other:

```json
{
  "mcpServers": {
    "figma-api": {
      "command": "npx",
      "args": ["-y", "figma-developer-mcp", "--figma-api-key=YOUR-KEY", "--stdio"]
    },
    "figma-local": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/Figma-MCP-Local/dist/bin.js", "--stdio"]
    }
  }
}
```

## Contributing

Contributions are welcome! This project was fully vibe-coded and there's plenty of room to improve:

- Better plugin UI/UX
- Support for exporting image fills alongside JSON
- Batch export of multiple pages
- Auto-detection of exported files in the project

Fork it, hack on it, open a PR.

## Credits

Built on top of [Framelink MCP for Figma](https://github.com/GLips/Figma-Context-MCP) by [GLips](https://github.com/GLips). The extractor pipeline that simplifies raw Figma data is theirs — this project adds the offline export layer.

## License

MIT
