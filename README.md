<a href="https://www.framelink.ai/?utm_source=github&utm_medium=referral&utm_campaign=readme" target="_blank" rel="noopener">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://www.framelink.ai/github/HeaderDark.png" />
    <img alt="Framelink" src="https://www.framelink.ai/github/HeaderLight.png" />
  </picture>
</a>

<div align="center">
  <h1>Framelink MCP for Figma</h1>
  <h3>Give your coding agent access to your Figma data.<br/>Implement designs in any framework in one-shot.</h3>
  <a href="https://npmcharts.com/compare/figma-developer-mcp?interval=30">
    <img alt="weekly downloads" src="https://img.shields.io/npm/dm/figma-developer-mcp.svg">
  </a>
  <a href="https://github.com/GLips/Figma-Context-MCP/blob/main/LICENSE">
    <img alt="MIT License" src="https://img.shields.io/github/license/GLips/Figma-Context-MCP" />
  </a>
  <a href="https://framelink.ai/discord">
    <img alt="Discord" src="https://img.shields.io/discord/1352337336913887343?color=7389D8&label&logo=discord&logoColor=ffffff" />
  </a>
  <br />
  <a href="https://twitter.com/glipsman">
    <img alt="Twitter" src="https://img.shields.io/twitter/url?url=https%3A%2F%2Fx.com%2Fglipsman&label=%40glipsman" />
  </a>
</div>

<br/>

Give [Cursor](https://cursor.sh/) and other AI-powered coding tools access to your Figma files with this [Model Context Protocol](https://modelcontextprotocol.io/introduction) server.

When Cursor has access to Figma design data, it's **way** better at one-shotting designs accurately than alternative approaches like pasting screenshots.

<h3><a href="https://www.framelink.ai/docs/quickstart?utm_source=github&utm_medium=referral&utm_campaign=readme">See quickstart instructions →</a></h3>

## Demo

[Watch a demo of building a UI in Cursor with Figma design data](https://youtu.be/6G9yb-LrEqg)

[![Watch the video](https://img.youtube.com/vi/6G9yb-LrEqg/maxresdefault.jpg)](https://youtu.be/6G9yb-LrEqg)

## How it works

1. Open your IDE's chat (e.g. agent mode in Cursor).
2. Paste a link to a Figma file, frame, or group.
3. Ask Cursor to do something with the Figma file—e.g. implement the design.
4. Cursor will fetch the relevant metadata from Figma and use it to write your code.

This MCP server is specifically designed for use with Cursor. Before responding with context from the [Figma API](https://www.figma.com/developers/api), it simplifies and translates the response so only the most relevant layout and styling information is provided to the model.

Reducing the amount of context provided to the model helps make the AI more accurate and the responses more relevant.

## Getting Started

Many code editors and other AI clients use a configuration file to manage MCP servers.

The `figma-developer-mcp` server can be configured by adding the following to your configuration file.

> NOTE: You will need to create a Figma access token to use this server. Instructions on how to create a Figma API access token can be found [here](https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens).

### MacOS / Linux

```json
{
  "mcpServers": {
    "Framelink MCP for Figma": {
      "command": "npx",
      "args": ["-y", "figma-developer-mcp", "--figma-api-key=YOUR-KEY", "--stdio"]
    }
  }
}
```

### Windows

```json
{
  "mcpServers": {
    "Framelink MCP for Figma": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "figma-developer-mcp", "--figma-api-key=YOUR-KEY", "--stdio"]
    }
  }
}
```

Or you can set `FIGMA_API_KEY` and `PORT` in the `env` field.

If you need more information on how to configure the Framelink MCP for Figma, see the [Framelink docs](https://www.framelink.ai/docs/quickstart?utm_source=github&utm_medium=referral&utm_campaign=readme).

## Setup with Local Build (stdio)

If you're running from a local clone instead of npx, point directly at the built `bin.js`:

```json
{
  "mcpServers": {
    "figma": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/Figma-Context-MCP/dist/bin.js", "--stdio"],
      "env": {
        "FIGMA_API_KEY": "YOUR-FIGMA-API-KEY"
      }
    }
  }
}
```

> **Windows example:**
> ```json
> {
>   "mcpServers": {
>     "figma": {
>       "type": "stdio",
>       "command": "node",
>       "args": ["C:\\path\\to\\Figma-Context-MCP\\dist\\bin.js", "--stdio"],
>       "env": {
>         "FIGMA_API_KEY": "YOUR-FIGMA-API-KEY"
>       }
>     }
>   }
> }
> ```

### Steps

1. Clone the repo and install dependencies:
   ```bash
   git clone https://github.com/GLips/Figma-Context-MCP.git
   cd Figma-Context-MCP
   pnpm install
   pnpm build
   ```
2. Create a Figma Personal Access Token ([instructions](https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens)).
3. Add the config above to your editor's MCP config file (e.g. `mcp.json`, `settings.json`, or `.cursor/mcp.json`), replacing the path and API key.
4. Restart your editor — the MCP tools will be available in agent mode.

## Available Tools

The server exposes the following MCP tools:

### `get_figma_data`

Fetches design data from the Figma API and returns simplified layout, styling, and content information.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `fileKey` | Yes | The Figma file key (from a URL like `figma.com/design/<fileKey>/...`) |
| `nodeId` | No | A specific node ID (from URL param `node-id=<nodeId>`). Use format `1234:5678` or `I5666:180910;1:10515;1:10336` for nested instances |
| `depth` | No | Max tree traversal depth. Only use if explicitly requested |

**Example prompt:**
> Implement this Figma design: https://www.figma.com/design/ABC123/MyApp?node-id=10-502

The agent will automatically call `get_figma_data` with `fileKey: "ABC123"` and `nodeId: "10:502"`.

---

### `get_figma_data_from_json`

Processes a locally exported Figma JSON file (from the [Framelink Figma Plugin](#figma-plugin-offline-export)) through the same simplification pipeline. **No Figma API key or internet connection required.**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `filePath` | Yes | Absolute or relative path to the exported JSON file |
| `depth` | No | Max tree traversal depth. Only use if explicitly requested |

**Example prompt:**
> Implement the design from this exported file: ./design-exports/my_app_2026-04-14.json

The agent will call `get_figma_data_from_json` with the file path and return the same simplified output as the API-based tool.

---

### `download_figma_images`

Downloads images (fills, renders) from a Figma file to a local directory.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `fileKey` | Yes | The Figma file key |
| `nodes` | Yes | Array of nodes to download, each with `nodeId`, `fileName`, and optional image options |
| `localPath` | Yes | Local directory path to save images to |

> This tool can be disabled with the `--skip-image-downloads` flag.

## Figma Plugin (Offline Export)

The `figma-plugin/` directory contains a Figma desktop plugin that exports design data as JSON files compatible with `get_figma_data_from_json`. This is useful when:

- You're on a **free Figma plan** with API rate limits
- You want to work **offline** or without an API key
- You want to **commit design data** alongside your code

### Plugin Setup

```bash
cd figma-plugin
npm install
npm run build
```

### Installing the Plugin in Figma

1. Open the **Figma desktop app** (the plugin API is not available in the browser)
2. Go to **Plugins → Development → Import plugin from manifest...**
3. Navigate to the `figma-plugin/` folder in this repo and select `manifest.json`
4. The plugin now appears under **Plugins → Development → Framelink Exporter**

### Exporting Design Data

1. Open any Figma file
2. Run the plugin: **Plugins → Development → Framelink Exporter**
3. **Select nodes** in Figma — the plugin UI shows what's selected
4. Choose your export scope:
   - **Export as JSON** — exports only the selected nodes
   - **Export Current Page** — exports the entire page
5. Optionally check **Limit traversal depth** to cap how deep the tree goes
6. A `.json` file downloads automatically (named `<file>_<date>.json`)

### End-to-End Workflow

Here's the complete flow from Figma design to implemented code — no API key needed:

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

**Step 1 — Export from Figma:**
```
Open Figma → Run Framelink Exporter → Select frames → Export as JSON
```

**Step 2 — Place the file in your project:**
```
my-project/
├── designs/
│   └── dashboard_2026-04-14.json    ← exported file
├── src/
└── mcp.json
```

**Step 3 — Ask your agent:**
> Implement the design from `./designs/dashboard_2026-04-14.json`

The agent calls `get_figma_data_from_json`, which reads the file, runs it through the same extractor pipeline as the API-based tool, and returns simplified design data. The output is identical — the agent can't tell whether data came from the API or a local file.

### What the Plugin Captures

The exported JSON matches the exact format the Figma REST API returns, including:

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

After making changes, re-run the plugin in Figma to pick up the new build.

## Star History

<a href="https://star-history.com/#GLips/Figma-Context-MCP"><img src="https://api.star-history.com/svg?repos=GLips/Figma-Context-MCP&type=Date" alt="Star History Chart" width="600" /></a>

## Learn More

The Framelink MCP for Figma is simple but powerful. Get the most out of it by learning more at the [Framelink](https://framelink.ai?utm_source=github&utm_medium=referral&utm_campaign=readme) site.
