import fs from "fs/promises";
import path from "path";
import type {
  GetFileResponse,
  GetFileNodesResponse,
} from "@figma/rest-api-spec";
import type {
  GlobalVars,
  SimplifiedDesign,
  SimplifiedNode,
} from "~/extractors/types.js";
import type {
  SimplifiedComponentDefinition,
  SimplifiedComponentSetDefinition,
} from "~/transformers/component.js";
import type { SimplifiedFill, SimplifiedImageFill } from "~/transformers/style.js";
import { deriveSemanticRole } from "~/utils/semantic-role.js";

/**
 * The plugin attaches this block at the root of every exported JSON file.
 * It carries the asset manifest the MCP needs to wire `imagePath`/`svgPath`
 * into the simplified output and to resolve sidecar paths for the
 * `get_node_image` / `get_node_svg` tools.
 *
 * Optional on read: older plugin exports (pre-1.1) won't have it. When absent,
 * the tool degrades gracefully — no asset paths surface, the tools just return
 * "not found" if asked.
 */
export type FramelinkExportBlock = {
  pluginVersion: string;
  exportedAt: string;
  scope: "selection" | "page";
  depth: number | null;
  fileName: string;
  pageId: string;
  pageName: string;
  rootNodeIds: string[];
  assetsFolder: string;
  assets: Record<string, { image?: string; imageScale?: number; svg?: string }>;
  imageFills: Record<string, string>;
  options: {
    exportFrameImages: boolean;
    exportSvgs: boolean;
    exportImageFills: boolean;
  };
};

export type RawWithFramelinkExport =
  | (GetFileResponse & { framelinkExport?: FramelinkExportBlock })
  | (GetFileNodesResponse & { framelinkExport?: FramelinkExportBlock });

/**
 * Pull the `framelinkExport` block out of the raw response without mutating
 * the input. Returns `undefined` if the file was produced by an older plugin
 * (or hand-authored).
 */
export function extractFramelinkBlock(
  raw: RawWithFramelinkExport,
): FramelinkExportBlock | undefined {
  return raw.framelinkExport;
}

/**
 * Walk the simplified node tree and stamp `imagePath` / `svgPath` from the
 * plugin's asset manifest onto matching nodes, plus a `renderHint` directing
 * the agent to fetch the asset rather than reconstruct from primitives.
 *
 * Crucially, `IMAGE-SVG` nodes that have NO matching asset get a negative
 * directive instead — without it, agents tend to "helpfully" substitute a
 * stock icon (FontAwesome, lucide, etc.) or fabricate path data, both of
 * which produce wrong output. We'd rather render an empty placeholder than
 * the wrong icon. Mutates in place — the simplified tree is freshly built
 * per request, so there's no aliasing risk.
 */
export function annotateNodesWithAssets(
  nodes: SimplifiedNode[],
  manifest: FramelinkExportBlock["assets"] | undefined,
): void {
  const haveManifest = manifest && Object.keys(manifest).length > 0;

  function walk(node: SimplifiedNode) {
    const entry = haveManifest ? manifest![node.id] : undefined;
    const hints: string[] = [];

    if (entry?.image) {
      node.imagePath = entry.image;
      if (entry.imageScale) node.imageScale = entry.imageScale;
      hints.push(
        `View the rendered design via get_node_image(filePath, "${node.id}") before generating code for this subtree.`,
      );
    }
    if (entry?.svg) {
      node.svgPath = entry.svg;
      hints.push(
        `Inline the actual SVG via get_node_svg(filePath, "${node.id}"). Do NOT reconstruct from path data, fills, or geometry.`,
      );
    }

    // Negative directive: collapsed vector subtree with no exported asset.
    // Without this hint, models reach for stock icon libraries or invent SVG
    // markup based on the layer name — both produce visually wrong output.
    if (node.type === "IMAGE-SVG" && !entry?.svg && !entry?.image) {
      hints.push(
        "NO asset was exported for this vector node. Render an empty placeholder " +
          "sized to the bounding box (e.g. <span aria-hidden style={{width, height}} />). " +
          "Do NOT substitute a stock icon, FontAwesome glyph, or fabricated SVG.",
      );
    }

    if (hints.length) node.renderHint = hints.join(" ");
    if (node.children) for (const child of node.children) walk(child);
  }

  for (const node of nodes) walk(node);
}

/**
 * Look up component metadata for every INSTANCE node and stamp the resolved
 * `componentName`, optional `componentDescription`, and a heuristic
 * `semanticRole` directly onto the node. Without this, agents see only an
 * opaque `componentId` and have to cross-reference the components map — which
 * they often skip, producing generic `<div>` markup for what is obviously a
 * button or input.
 *
 * Component sets are checked too so a variant like "Button/Primary/Default"
 * gets the parent set name as a fallback.
 */
export function annotateNodesWithComponentInfo(
  nodes: SimplifiedNode[],
  components: Record<string, SimplifiedComponentDefinition>,
  componentSets: Record<string, SimplifiedComponentSetDefinition>,
): void {
  function walk(node: SimplifiedNode) {
    if (node.type === "INSTANCE" && node.componentId) {
      const comp = components[node.componentId];
      if (comp) {
        const set = comp.componentSetId ? componentSets[comp.componentSetId] : undefined;
        // Prefer "<Set>/<Variant>" (matches how designers think) when available.
        const fullName = set ? `${set.name}/${comp.name}` : comp.name;
        node.componentName = fullName;
        const desc = comp.description ?? set?.description;
        if (desc && desc.trim().length) node.componentDescription = desc.trim();
        const role = deriveSemanticRole(fullName) ?? deriveSemanticRole(node.name);
        if (role) node.semanticRole = role;
      }
    } else {
      // Even non-instance nodes can have semantic names ("Search bar", "Card").
      // We tag conservatively so designers naming a frame "Card" still gets
      // a hint, without overriding component-derived roles above.
      const role = deriveSemanticRole(node.name);
      if (role) node.semanticRole = role;
    }
    if (node.children) for (const child of node.children) walk(child);
  }
  for (const node of nodes) walk(node);
}

/**
 * Walk every entry in `globalVars.styles` that contains image fills and inject
 * the local `assetPath` from the plugin's `imageFills` manifest. After this
 * pass, an agent reading a fill array sees the actual sidecar PNG path
 * (`design.assets/image_<hash>.png`) instead of just an opaque `imageRef`.
 */
export function annotateImageFillsWithAssetPaths(
  globalVars: GlobalVars,
  imageFills: FramelinkExportBlock["imageFills"] | undefined,
): void {
  if (!imageFills || Object.keys(imageFills).length === 0) return;

  for (const value of Object.values(globalVars.styles)) {
    if (!Array.isArray(value)) continue;
    for (const fill of value as SimplifiedFill[]) {
      if (typeof fill === "string") continue;
      if (fill.type !== "IMAGE") continue;
      const imageFill = fill as SimplifiedImageFill;
      const assetPath = imageFills[imageFill.imageRef];
      if (assetPath) imageFill.assetPath = assetPath;
    }
  }
}

/**
 * Collect a flat list of imperative directives the agent should follow when
 * building UI from this design. Surfaced at the top of the response so the
 * agent sees concrete next tool calls before drowning in node detail.
 */
export function buildNextActions(
  framelink: FramelinkExportBlock,
  nodes: SimplifiedNode[],
): string[] {
  const actions: string[] = [];

  // Root frame screenshots come first — most important grounding signal.
  for (const rootId of framelink.rootNodeIds) {
    const entry = framelink.assets[rootId];
    if (entry?.image) {
      actions.push(
        `View root frame screenshot: get_node_image(filePath, "${rootId}") — call this FIRST for visual ground truth.`,
      );
    }
  }

  // SVG icons next — count them so the agent batches calls.
  let svgCount = 0;
  function countSvgs(node: SimplifiedNode) {
    if (node.svgPath) svgCount++;
    if (node.children) node.children.forEach(countSvgs);
  }
  nodes.forEach(countSvgs);
  if (svgCount > 0) {
    actions.push(
      `Inline ${svgCount} icon${svgCount === 1 ? "" : "s"} via get_node_svg for every node carrying an svgPath. ` +
        `Do NOT reconstruct icons from geometry primitives.`,
    );
  }

  if (Object.keys(framelink.imageFills).length > 0) {
    actions.push(
      `Use the local image files referenced by fill[].assetPath for any IMAGE fills — do not use placeholder URLs.`,
    );
  }

  return actions;
}

/**
 * Resolve an asset reference (relative path stored in the manifest) against the
 * directory of the JSON file the manifest came from. Throws if the resolved
 * path escapes that directory — defensive against tampered manifests.
 */
export function resolveAssetPath(jsonFilePath: string, relativePath: string): string {
  const baseDir = path.dirname(path.resolve(jsonFilePath));
  const resolved = path.resolve(baseDir, relativePath);
  const baseWithSep = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
  if (resolved !== baseDir && !resolved.startsWith(baseWithSep)) {
    throw new Error(
      `Asset path "${relativePath}" resolves outside the JSON file's directory. ` +
        `Refusing to read for security.`,
    );
  }
  return resolved;
}

/**
 * Read + parse the JSON file once. Surfaces a friendly error if the file
 * doesn't exist or isn't valid JSON. Used by every tool that operates on a
 * Framelink export — sharing the implementation keeps error messages and the
 * (optional) cache lookup consistent.
 */
export async function readFramelinkJson(filePath: string): Promise<{
  raw: RawWithFramelinkExport;
  framelink: FramelinkExportBlock | undefined;
  rawSize: number;
  resolvedPath: string;
}> {
  const resolvedPath = path.resolve(filePath);
  let text: string;
  try {
    text = await fs.readFile(resolvedPath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`Figma JSON file not found: ${resolvedPath}`);
    }
    throw err;
  }

  let raw: RawWithFramelinkExport;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Failed to parse Figma JSON at ${resolvedPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    raw,
    framelink: extractFramelinkBlock(raw),
    rawSize: Buffer.byteLength(text, "utf-8"),
    resolvedPath,
  };
}

export type SimplifiedDesignWithFramelink = SimplifiedDesign & {
  framelinkExport?: FramelinkExportBlock;
};
