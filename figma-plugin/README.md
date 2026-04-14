# Framelink Exporter — Figma Plugin

A Figma desktop plugin that exports design node data as JSON files compatible with the Framelink MCP server. This bypasses the Figma REST API entirely, letting you work with local files instead — especially useful on free-tier Figma plans with aggressive rate limits.

## How It Works

The plugin serializes the Figma Plugin API's node tree into the exact JSON shape that the Figma REST API returns (`GetFileNodesResponse` for selected nodes, `GetFileResponse` for full-page exports). The exported JSON can be consumed directly by the Framelink MCP extractor pipeline.

## Setup

```bash
cd figma-plugin
npm install   # or pnpm install
npm run build
```

## Installing in Figma

1. Open the Figma desktop app
2. Go to **Plugins → Development → Import plugin from manifest...**
3. Select `figma-plugin/manifest.json` from this repo
4. The plugin will appear under **Plugins → Development → Framelink Exporter**

## Usage

1. Open a Figma file
2. Run the plugin from **Plugins → Development → Framelink Exporter**
3. Select the nodes you want to export (frames, components, pages)
4. Click **Export as JSON** (or **Export Current Page** for the full page)
5. Save the downloaded JSON file to your project

### Options

- **Export selected nodes** — Exports only what you've selected (produces `GetFileNodesResponse` format)
- **Export current page** — Exports the entire page (produces `GetFileResponse` format)
- **Limit traversal depth** — Caps how many levels deep the tree serialization goes

## Exported Data Format

The plugin captures the same properties that Framelink's extractors consume:

- **Layout** — `absoluteBoundingBox`, `constraints`, auto-layout props (`layoutMode`, `itemSpacing`, `padding*`, sizing modes)
- **Visuals** — `fills`, `strokes`, `effects`, `opacity`, `cornerRadius`, `blendMode`, `clipsContent`
- **Text** — `characters`, `style` (font family, size, weight, alignment, line height, letter spacing), `styleOverrideTable`
- **Components** — `componentProperties`, `componentPropertyDefinitions`, `componentId`
- **Structure** — Full node tree with `id`, `name`, `type`, `visible`, `children`

## Development

```bash
npm run watch   # Rebuild on file changes
```

After making changes, reload the plugin in Figma: **Plugins → Development → Framelink Exporter** (right-click → **Run last plugin** or re-open it).

## Project Structure

```
figma-plugin/
├── manifest.json       # Figma plugin manifest
├── package.json        # Dependencies & scripts
├── tsconfig.json       # TypeScript config
├── build.mjs           # esbuild build script
├── src/
│   ├── code.ts         # Plugin sandbox code (node serialization)
│   └── ui.html         # Plugin UI (export controls + download)
└── dist/               # Build output (git-ignored)
    ├── code.js
    └── ui.html
```
