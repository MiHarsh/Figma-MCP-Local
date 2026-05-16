/**
 * Framelink Exporter — Figma plugin that serializes the current selection (or
 * entire page) into the exact JSON shape returned by the Figma REST API
 * (GetFileNodesResponse / GetFileResponse), plus a `framelinkExport` metadata
 * block carrying an asset manifest (PNGs, SVGs, image-fill bytes).
 *
 * Why this exists: The Figma REST API has aggressive rate limits on free plans.
 * This plugin lets designers export the relevant subtree once, commit the JSON
 * (and an `<filename>.assets/` sidecar folder) alongside the codebase, and let
 * AI coding tools consume it locally.
 */

const PLUGIN_VERSION = "1.2.0";

// Image scale for rendered frame screenshots. @2x is a good tradeoff between
// fidelity (handles retina, small text legible) and file size.
const FRAME_IMAGE_SCALE = 2;

// ── Helpers ──────────────────────────────────────────────────────────────────

function rgbaToApi(color: RGB | RGBA): { r: number; g: number; b: number; a: number } {
  return {
    r: color.r,
    g: color.g,
    b: color.b,
    a: "a" in color ? color.a : 1,
  };
}

function colorToApi(paint: Paint): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: paint.type,
    visible: paint.visible ?? true,
    opacity: paint.opacity ?? 1,
    blendMode: paint.blendMode,
  };

  if (paint.type === "SOLID") {
    base.color = rgbaToApi(paint.color);
  }

  if (
    paint.type === "GRADIENT_LINEAR" ||
    paint.type === "GRADIENT_RADIAL" ||
    paint.type === "GRADIENT_ANGULAR" ||
    paint.type === "GRADIENT_DIAMOND"
  ) {
    base.gradientHandlePositions = paint.gradientTransform
      ? transformToHandlePositions(paint.gradientTransform)
      : [];
    base.gradientStops = paint.gradientStops?.map((s) => ({
      color: rgbaToApi(s.color),
      position: s.position,
    }));
  }

  if (paint.type === "IMAGE") {
    base.scaleMode = paint.scaleMode;
    base.imageRef = paint.imageHash;
    if (paint.imageTransform) {
      base.imageTransform = paint.imageTransform;
    }
  }

  return base;
}

function transformToHandlePositions(
  transform: Transform,
): Array<{ x: number; y: number }> {
  const [[a, b, tx], [c, d, ty]] = transform;
  return [
    { x: tx, y: ty },
    { x: a + tx, y: c + ty },
    { x: b + tx, y: d + ty },
  ];
}

function effectToApi(effect: Effect): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: effect.type,
    visible: effect.visible,
  };

  if ("radius" in effect) base.radius = effect.radius;
  if ("color" in effect && effect.color) base.color = rgbaToApi(effect.color);
  if ("offset" in effect && effect.offset) base.offset = effect.offset;
  if ("spread" in effect) base.spread = effect.spread;
  if ("blendMode" in effect) base.blendMode = effect.blendMode;

  return base;
}

function constraintsToApi(
  node: SceneNode & { constraints?: Constraints },
): { horizontal: string; vertical: string } | undefined {
  if (!("constraints" in node) || !node.constraints) return undefined;
  return {
    horizontal: node.constraints.horizontal,
    vertical: node.constraints.vertical,
  };
}

function boundingBoxFromNode(
  node: SceneNode,
): { x: number; y: number; width: number; height: number } | undefined {
  if (!("absoluteBoundingBox" in node)) return undefined;
  const bb = (node as FrameNode).absoluteBoundingBox;
  if (!bb) return undefined;
  return { x: bb.x, y: bb.y, width: bb.width, height: bb.height };
}

function renderBoundsFromNode(
  node: SceneNode,
): { x: number; y: number; width: number; height: number } | undefined {
  if (!("absoluteRenderBounds" in node)) return undefined;
  const rb = (node as FrameNode).absoluteRenderBounds;
  if (!rb) return undefined;
  return { x: rb.x, y: rb.y, width: rb.width, height: rb.height };
}

/**
 * Extract the per-node `styles` map (REST API shape: `Record<StyleType, styleId>`)
 * from the plugin API's split `*StyleId` properties. The extractor's named-style
 * resolution depends on this — without it every fill/stroke/text style gets a
 * synthetic varId instead of the design-system style name.
 */
function nodeStylesToApi(node: SceneNode): Record<string, string> | undefined {
  const styles: Record<string, string> = {};
  const candidates: Array<[string, string]> = [
    ["fill", "fillStyleId"],
    ["stroke", "strokeStyleId"],
    ["effect", "effectStyleId"],
    ["text", "textStyleId"],
    ["grid", "gridStyleId"],
  ];
  for (const [key, prop] of candidates) {
    if (!(prop in node)) continue;
    const value = (node as unknown as Record<string, unknown>)[prop];
    if (typeof value === "string" && value.length > 0) {
      styles[key] = value;
    }
  }
  return Object.keys(styles).length > 0 ? styles : undefined;
}

// ── Yielding & cancellation ──────────────────────────────────────────────────

let cancelled = false;

class ExportCancelled extends Error {
  constructor() { super("Export cancelled"); }
}

function yieldAndCheckCancel(): Promise<void> {
  return new Promise((resolve, reject) => setTimeout(() => {
    if (cancelled) reject(new ExportCancelled());
    else resolve();
  }, 0));
}

// ── Node count ───────────────────────────────────────────────────────────────

function countNodes(node: SceneNode, currentDepth: number, maxDepth?: number): number {
  let count = 1;
  if ("children" in node) {
    if (maxDepth !== undefined && currentDepth >= maxDepth) return count;
    for (const child of (node as FrameNode & { children: readonly SceneNode[] }).children) {
      count += countNodes(child, currentDepth + 1, maxDepth);
    }
  }
  return count;
}

// ── SVG-eligibility detection ────────────────────────────────────────────────

/**
 * Mirrors `SVG_ELIGIBLE_TYPES` in src/extractors/built-in.ts. Kept in sync so
 * the plugin can pre-render SVGs for the same subtrees the extractor will
 * collapse to IMAGE-SVG, ensuring the agent gets actual vector markup instead
 * of a typed placeholder.
 */
const SVG_LEAF_TYPES = new Set([
  "VECTOR",
  "BOOLEAN_OPERATION",
  "STAR",
  "LINE",
  "ELLIPSE",
  "REGULAR_POLYGON",
  "RECTANGLE",
]);

const SVG_CONTAINER_TYPES = new Set(["FRAME", "GROUP", "INSTANCE", "BOOLEAN_OPERATION"]);

function nodeHasImageFill(node: SceneNode): boolean {
  if (!("fills" in node)) return false;
  const fills = node.fills;
  if (fills === figma.mixed || !Array.isArray(fills)) return false;
  return fills.some((f) => f.type === "IMAGE");
}

/**
 * Walk a subtree once and return the set of node IDs that are the topmost
 * "all-SVG" nodes — i.e. nodes whose entire subtree is vector-only and
 * whose parent is NOT also all-SVG. These are the nodes worth rendering as
 * standalone SVG files; rendering inner nodes too would duplicate content.
 */
function collectSvgRoots(node: SceneNode): Set<string> {
  const roots = new Set<string>();

  function isAllSvg(n: SceneNode): boolean {
    if (nodeHasImageFill(n)) return false;
    if (SVG_LEAF_TYPES.has(n.type) && !("children" in n)) return true;
    if ("children" in n) {
      const children = (n as FrameNode & { children: readonly SceneNode[] }).children;
      if (children.length === 0) return false;
      if (!SVG_CONTAINER_TYPES.has(n.type) && !SVG_LEAF_TYPES.has(n.type)) return false;
      return children.every((c) => isAllSvg(c));
    }
    return false;
  }

  function walk(n: SceneNode, parentIsAllSvg: boolean) {
    const selfAllSvg = isAllSvg(n);
    if (selfAllSvg && !parentIsAllSvg) {
      roots.add(n.id);
    }
    if ("children" in n && !selfAllSvg) {
      // Only recurse into non-all-SVG containers; otherwise we'd pick up
      // already-covered descendants.
      for (const child of (n as FrameNode & { children: readonly SceneNode[] }).children) {
        walk(child, selfAllSvg);
      }
    }
  }

  walk(node, false);
  return roots;
}

// ── Node Serializer ──────────────────────────────────────────────────────────

type ProgressTracker = {
  callback: (serialized: number, total: number, nodeName: string) => void;
  serialized: number;
  total: number;
};

type SerializedNode = Record<string, unknown>;

type SerializeOpts = {
  currentDepth: number;
  maxDepth?: number;
  progress?: ProgressTracker;
  // Image refs (hashes) to fetch bytes for after serialization
  imageRefs: Set<string>;
};

async function serializeNode(node: SceneNode, opts: SerializeOpts): Promise<SerializedNode> {
  const result: SerializedNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible,
  };

  const bb = boundingBoxFromNode(node);
  if (bb) result.absoluteBoundingBox = bb;
  const rb = renderBoundsFromNode(node);
  if (rb) result.absoluteRenderBounds = rb;

  if ("width" in node) result.size = { x: (node as FrameNode).width, y: (node as FrameNode).height };

  const c = constraintsToApi(node as SceneNode & { constraints?: Constraints });
  if (c) result.constraints = c;

  if ("blendMode" in node) result.blendMode = (node as GeometryMixin & BaseNodeMixin).blendMode;
  if ("opacity" in node) result.opacity = (node as BlendMixin).opacity;
  if ("isMask" in node) result.isMask = (node as unknown as { isMask: boolean }).isMask;

  // Per-node named-style references (REST API `styles` object).
  // Extractor's getStyleMatch reads this to resolve fill/text/effect styleIds.
  const nodeStyles = nodeStylesToApi(node);
  if (nodeStyles) result.styles = nodeStyles;

  if ("fills" in node) {
    const fills = node.fills;
    if (fills !== figma.mixed && Array.isArray(fills)) {
      result.fills = fills.map(colorToApi);
      // Track image-fill refs for asset collection
      for (const fill of fills) {
        if (fill.type === "IMAGE" && fill.imageHash) {
          opts.imageRefs.add(fill.imageHash);
        }
      }
    }
  }

  if ("strokes" in node) {
    result.strokes = (node as GeometryMixin).strokes.map(colorToApi);
  }
  if ("strokeWeight" in node) {
    const sw = (node as GeometryMixin).strokeWeight;
    if (sw !== figma.mixed) result.strokeWeight = sw;
  }
  if ("strokeAlign" in node) result.strokeAlign = (node as GeometryMixin).strokeAlign;

  if ("cornerRadius" in node) {
    const cr = (node as RectangleNode).cornerRadius;
    if (cr !== figma.mixed) {
      result.cornerRadius = cr;
    } else if ("topLeftRadius" in node) {
      result.rectangleCornerRadii = [
        (node as RectangleNode).topLeftRadius,
        (node as RectangleNode).topRightRadius,
        (node as RectangleNode).bottomRightRadius,
        (node as RectangleNode).bottomLeftRadius,
      ];
    }
  }

  if ("effects" in node) {
    result.effects = (node as BlendMixin & SceneNode).effects.map(effectToApi);
  }

  if ("clipsContent" in node) result.clipsContent = (node as FrameNode).clipsContent;

  if ("layoutMode" in node) {
    const frame = node as FrameNode;
    if (frame.layoutMode !== "NONE") {
      result.layoutMode = frame.layoutMode;
      result.primaryAxisSizingMode = frame.primaryAxisSizingMode;
      result.counterAxisSizingMode = frame.counterAxisSizingMode;
      result.primaryAxisAlignItems = frame.primaryAxisAlignItems;
      result.counterAxisAlignItems = frame.counterAxisAlignItems;
      result.itemSpacing = frame.itemSpacing;
      result.counterAxisSpacing = frame.counterAxisSpacing ?? 0;
      result.paddingLeft = frame.paddingLeft;
      result.paddingRight = frame.paddingRight;
      result.paddingTop = frame.paddingTop;
      result.paddingBottom = frame.paddingBottom;

      if ("layoutWrap" in frame) {
        result.layoutWrap = frame.layoutWrap;
      }
    }
  }

  if ("layoutSizingHorizontal" in node) {
    result.layoutSizingHorizontal = (node as FrameNode).layoutSizingHorizontal;
  }
  if ("layoutSizingVertical" in node) {
    result.layoutSizingVertical = (node as FrameNode).layoutSizingVertical;
  }
  if ("layoutGrow" in node) result.layoutGrow = (node as FrameNode).layoutGrow;
  if ("layoutAlign" in node) result.layoutAlign = (node as FrameNode).layoutAlign;
  if ("layoutPositioning" in node) result.layoutPositioning = (node as FrameNode).layoutPositioning;

  if ("minWidth" in node) {
    const f = node as FrameNode;
    if (f.minWidth != null) result.minWidth = f.minWidth;
    if (f.maxWidth != null) result.maxWidth = f.maxWidth;
    if (f.minHeight != null) result.minHeight = f.minHeight;
    if (f.maxHeight != null) result.maxHeight = f.maxHeight;
  }

  // ── Text ───────────────────────────────────────────────────────────────────

  if (node.type === "TEXT") {
    const text = node as TextNode;
    result.characters = text.characters;

    const fontSize = text.fontSize !== figma.mixed ? text.fontSize : 14;
    const fontWeight = text.fontWeight !== figma.mixed ? text.fontWeight : 400;
    const fontFamily =
      text.fontName !== figma.mixed ? text.fontName.family : "Inter";
    const fontStyle =
      text.fontName !== figma.mixed ? text.fontName.style : "Regular";
    const letterSpacing =
      text.letterSpacing !== figma.mixed ? text.letterSpacing : { value: 0, unit: "PIXELS" };
    const lineHeight =
      text.lineHeight !== figma.mixed ? text.lineHeight : { unit: "AUTO" };
    const textAlignHorizontal = text.textAlignHorizontal;
    const textAlignVertical = text.textAlignVertical;
    const textDecoration = text.textDecoration !== figma.mixed ? text.textDecoration : "NONE";
    const textCase = text.textCase !== figma.mixed ? text.textCase : "ORIGINAL";

    result.style = {
      fontFamily,
      fontPostScriptName: `${fontFamily}-${fontStyle.replace(/\s+/g, "")}`,
      fontWeight,
      fontSize,
      textAlignHorizontal,
      textAlignVertical,
      letterSpacing: letterSpacing.unit === "PERCENT"
        ? (letterSpacing.value / 100) * (fontSize as number)
        : letterSpacing.value,
      lineHeightPx:
        lineHeight.unit === "PIXELS"
          ? lineHeight.value
          : lineHeight.unit === "PERCENT"
            ? (lineHeight.value / 100) * (fontSize as number)
            : (fontSize as number) * 1.2,
      lineHeightUnit: lineHeight.unit === "AUTO" ? "INTRINSIC_%"
        : lineHeight.unit === "PERCENT" ? "FONT_SIZE_%"
          : "PIXELS",
      textDecoration,
      textCase,
    };

    try {
      const segments = text.getStyledTextSegments([
        "fontSize", "fontWeight", "fontName", "fills",
        "letterSpacing", "lineHeight", "textDecoration", "textCase",
      ]);

      if (segments.length > 1) {
        const overrides: Record<string, Record<string, unknown>> = {};
        const characterStyleOverrides: number[] = [];
        let overrideId = 1;

        for (const seg of segments) {
          const id = overrideId++;
          overrides[String(id)] = {
            fontFamily: seg.fontName.family,
            fontWeight: seg.fontWeight,
            fontSize: seg.fontSize,
            textDecoration: seg.textDecoration,
            textCase: seg.textCase,
            fills: seg.fills.map(colorToApi),
          };
          for (let i = 0; i < seg.end - seg.start; i++) {
            characterStyleOverrides.push(id);
          }
        }

        result.characterStyleOverrides = characterStyleOverrides;
        result.styleOverrideTable = overrides;
      }
    } catch {
      // getStyledTextSegments may fail on some text nodes — non-critical
    }
  }

  if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
    const comp = node as ComponentNode | ComponentSetNode;
    if (comp.componentPropertyDefinitions) {
      result.componentPropertyDefinitions = comp.componentPropertyDefinitions;
    }
  }

  if (node.type === "INSTANCE") {
    const inst = node as InstanceNode;
    if (inst.componentProperties) {
      result.componentProperties = inst.componentProperties;
    }
    const mainComp = await inst.getMainComponentAsync();
    if (mainComp) {
      result.componentId = mainComp.id;
    }
  }

  if ("children" in node) {
    const container = node as FrameNode & { children: readonly SceneNode[] };
    if (opts.maxDepth !== undefined && opts.currentDepth >= opts.maxDepth) {
      result.children = [];
    } else {
      const childResults: SerializedNode[] = [];
      for (const child of container.children) {
        childResults.push(
          await serializeNode(child, { ...opts, currentDepth: opts.currentDepth + 1 }),
        );
      }
      result.children = childResults;
    }
  }

  if (opts.progress) {
    opts.progress.serialized++;
    opts.progress.callback(opts.progress.serialized, opts.progress.total, node.name);
  }

  await yieldAndCheckCancel();

  return result;
}

// ── Component & Style collection ─────────────────────────────────────────────

type ComponentMeta = {
  key: string;
  name: string;
  description: string;
  componentSetId?: string;
};

type ComponentSetMeta = {
  key: string;
  name: string;
  description: string;
};

function collectComponents(
  node: SceneNode,
  components: Record<string, ComponentMeta>,
  componentSets: Record<string, ComponentSetMeta>,
) {
  if (node.type === "COMPONENT") {
    const comp = node as ComponentNode;
    const meta: ComponentMeta = {
      key: comp.key,
      name: comp.name,
      description: comp.description,
    };
    if (comp.parent && comp.parent.type === "COMPONENT_SET") {
      meta.componentSetId = comp.parent.id;
    }
    components[comp.id] = meta;
  }

  if (node.type === "COMPONENT_SET") {
    const cs = node as ComponentSetNode;
    componentSets[cs.id] = {
      key: cs.key,
      name: cs.name,
      description: cs.description,
    };
  }

  if ("children" in node) {
    for (const child of (node as FrameNode & { children: readonly SceneNode[] }).children) {
      collectComponents(child, components, componentSets);
    }
  }
}

/**
 * Walk a subtree, find all INSTANCE nodes whose main component lives outside
 * the current export scope, and add the missing component metadata so the
 * extractor's component lookup resolves cleanly. Without this, agents see
 * `componentId: <id>` references with no matching definition.
 */
async function collectCrossScopeComponents(
  node: SceneNode,
  components: Record<string, ComponentMeta>,
  componentSets: Record<string, ComponentSetMeta>,
): Promise<void> {
  if (node.type === "INSTANCE") {
    const inst = node as InstanceNode;
    const main = await inst.getMainComponentAsync();
    if (main && !components[main.id]) {
      const meta: ComponentMeta = {
        key: main.key,
        name: main.name,
        description: main.description,
      };
      if (main.parent && main.parent.type === "COMPONENT_SET") {
        meta.componentSetId = main.parent.id;
        if (!componentSets[main.parent.id]) {
          const cs = main.parent as ComponentSetNode;
          componentSets[main.parent.id] = {
            key: cs.key,
            name: cs.name,
            description: cs.description,
          };
        }
      }
      components[main.id] = meta;
    }
  }
  if ("children" in node) {
    for (const child of (node as FrameNode & { children: readonly SceneNode[] }).children) {
      await collectCrossScopeComponents(child, components, componentSets);
    }
  }
}

async function collectStyles(): Promise<Record<string, { key: string; name: string; styleType: string; description: string }>> {
  const styles: Record<string, { key: string; name: string; styleType: string; description: string }> = {};
  for (const style of await figma.getLocalPaintStylesAsync()) {
    styles[style.id] = {
      key: style.key,
      name: style.name,
      styleType: "FILL",
      description: style.description,
    };
  }
  for (const style of await figma.getLocalTextStylesAsync()) {
    styles[style.id] = {
      key: style.key,
      name: style.name,
      styleType: "TEXT",
      description: style.description,
    };
  }
  for (const style of await figma.getLocalEffectStylesAsync()) {
    styles[style.id] = {
      key: style.key,
      name: style.name,
      styleType: "EFFECT",
      description: style.description,
    };
  }
  return styles;
}

// ── Asset collection ─────────────────────────────────────────────────────────

type AssetEntry = {
  /** Path relative to the assets folder, e.g. "node_1_23.png" */
  path: string;
  /** Raw bytes — sent to UI as Uint8Array (structured-cloned through postMessage). */
  bytes: Uint8Array;
  /** MIME type for download blob */
  mime: string;
};

type AssetManifestEntry = {
  /** Relative path to image render of this node (e.g. "design.assets/node_1_23.png"). */
  image?: string;
  imageScale?: number;
  /** Relative path to SVG markup of this node. Set for SVG-eligible vector subtrees. */
  svg?: string;
};

type ImageFillManifest = Record<string, string>; // imageRef → relative path

function safeIdForFilename(id: string): string {
  // Figma node IDs look like "1:23" — colons are illegal on Windows
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}

/**
 * Render a node as PNG @2x. Returns null if the node is empty or rendering
 * fails (Figma will throw for certain node states like fully-transparent
 * groups). Caller treats null as "skip this asset" rather than aborting.
 */
async function exportNodeAsPng(node: SceneNode): Promise<Uint8Array | null> {
  try {
    return await node.exportAsync({
      format: "PNG",
      constraint: { type: "SCALE", value: FRAME_IMAGE_SCALE },
    });
  } catch {
    return null;
  }
}

async function exportNodeAsSvg(node: SceneNode): Promise<string | null> {
  try {
    return await node.exportAsync({ format: "SVG_STRING" });
  } catch {
    return null;
  }
}

function utf8Encode(s: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
  // Fallback for older Figma sandboxes — naive UTF-8 encoder.
  const bytes = new Uint8Array(s.length * 4);
  let pos = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes[pos++] = c;
    else if (c < 0x800) {
      bytes[pos++] = 0xc0 | (c >> 6);
      bytes[pos++] = 0x80 | (c & 0x3f);
    } else {
      bytes[pos++] = 0xe0 | (c >> 12);
      bytes[pos++] = 0x80 | ((c >> 6) & 0x3f);
      bytes[pos++] = 0x80 | (c & 0x3f);
    }
  }
  return bytes.slice(0, pos);
}

type AssetCollectionResult = {
  assets: AssetEntry[];
  manifest: Record<string, AssetManifestEntry>; // nodeId → entry
  imageFills: ImageFillManifest;
  /** Folder name (without trailing slash) where assets are placed in the ZIP. */
  assetsFolder: string;
};

type AssetOptions = {
  exportFrameImages: boolean;
  exportSvgs: boolean;
  exportImageFills: boolean;
  /** Top-level frames to render as PNG. */
  topLevelNodes: readonly SceneNode[];
  /** Image-fill refs collected during serialization. */
  imageRefs: Set<string>;
  /** Asset folder name (e.g. "design.assets"). */
  assetsFolder: string;
  onProgress: (label: string) => void;
};

async function collectAssets(opts: AssetOptions): Promise<AssetCollectionResult> {
  const assets: AssetEntry[] = [];
  const manifest: Record<string, AssetManifestEntry> = {};
  const imageFills: ImageFillManifest = {};
  const folder = opts.assetsFolder;

  // 1. Top-level frame screenshots — what the agent uses for visual grounding.
  if (opts.exportFrameImages) {
    for (const node of opts.topLevelNodes) {
      opts.onProgress(`Rendering ${node.name} (PNG)`);
      const bytes = await exportNodeAsPng(node);
      if (bytes) {
        const filename = `node_${safeIdForFilename(node.id)}.png`;
        assets.push({ path: filename, bytes, mime: "image/png" });
        manifest[node.id] = {
          ...(manifest[node.id] ?? {}),
          image: `${folder}/${filename}`,
          imageScale: FRAME_IMAGE_SCALE,
        };
      }
      await yieldAndCheckCancel();
    }
  }

  // 2. SVG exports for vector subtrees — closes the IMAGE-SVG dead-end.
  if (opts.exportSvgs) {
    const svgRoots = new Set<string>();
    for (const top of opts.topLevelNodes) {
      for (const id of collectSvgRoots(top)) svgRoots.add(id);
    }
    for (const id of svgRoots) {
      const node = await figma.getNodeByIdAsync(id);
      if (!node || !("exportAsync" in node)) continue;
      opts.onProgress(`Rendering ${(node as SceneNode).name} (SVG)`);
      const svg = await exportNodeAsSvg(node as SceneNode);
      if (svg) {
        const filename = `icon_${safeIdForFilename(id)}.svg`;
        assets.push({ path: filename, bytes: utf8Encode(svg), mime: "image/svg+xml" });
        manifest[id] = {
          ...(manifest[id] ?? {}),
          svg: `${folder}/${filename}`,
        };
      }
      await yieldAndCheckCancel();
    }
  }

  // 3. Image-fill bytes (raster fills referenced by imageRef hash).
  if (opts.exportImageFills) {
    for (const ref of opts.imageRefs) {
      opts.onProgress(`Fetching image fill ${ref.slice(0, 8)}…`);
      try {
        const image = figma.getImageByHash(ref);
        if (!image) continue;
        const bytes = await image.getBytesAsync();
        const filename = `image_${ref}.png`;
        assets.push({ path: filename, bytes, mime: "image/png" });
        imageFills[ref] = `${folder}/${filename}`;
      } catch {
        // Skip — image bytes may be unavailable for some refs (e.g. removed)
      }
      await yieldAndCheckCancel();
    }
  }

  return { assets, manifest, imageFills, assetsFolder: folder };
}

// ── Export logic ──────────────────────────────────────────────────────────────

function generateDefaultFileName(): string {
  // Returned WITHOUT extension. The UI appends .json or .zip based on whether
  // assets are bundled — surfacing a fixed extension here would mislead users
  // since the plugin downloads as .zip when assets are included.
  const safeName = figma.root.name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
  // YYYYMMDD-HHMMSS in local time. Filename-safe (no colons), sortable, and
  // unique across multiple exports in the same minute. Local time matches the
  // user's mental model of "when did I export this?" better than UTC would.
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${safeName}_${timestamp}`;
}

function deriveAssetsFolder(jsonFileName: string): string {
  const base = jsonFileName.replace(/\.json$/i, "");
  return `${base}.assets`;
}

type ExportInput = {
  scope: "selection" | "page";
  nodes: readonly SceneNode[];
  page: PageNode;
  depth?: number;
  exportFrameImages: boolean;
  exportSvgs: boolean;
  exportImageFills: boolean;
  jsonFileName: string;
};

type ExportResult = {
  json: string;
  assets: AssetEntry[];
  nodeCount: number;
  assetsFolder: string;
};

async function performExport(input: ExportInput): Promise<ExportResult> {
  const { scope, nodes, page, depth, jsonFileName } = input;

  if (scope === "selection" && nodes.length === 0) {
    throw new Error("No nodes selected. Select at least one node in Figma.");
  }

  const totalNodes = nodes.reduce((acc, n) => acc + countNodes(n, 0, depth), 0);
  const progress: ProgressTracker = {
    callback: (current, total, nodeName) => {
      figma.ui.postMessage({ type: "export-progress", current, total, nodeName });
    },
    serialized: 0,
    total: totalNodes,
  };

  const components: Record<string, ComponentMeta> = {};
  const componentSets: Record<string, ComponentSetMeta> = {};
  for (const n of nodes) collectComponents(n, components, componentSets);
  for (const n of nodes) await collectCrossScopeComponents(n, components, componentSets);

  const styles = await collectStyles();

  const imageRefs = new Set<string>();
  const serializeOpts: SerializeOpts = {
    currentDepth: 0,
    maxDepth: depth,
    progress,
    imageRefs,
  };

  const serializedNodes: SerializedNode[] = [];
  for (const node of nodes) {
    serializedNodes.push(await serializeNode(node, serializeOpts));
  }

  const assetsFolder = deriveAssetsFolder(jsonFileName);
  const assetResult = await collectAssets({
    exportFrameImages: input.exportFrameImages,
    exportSvgs: input.exportSvgs,
    exportImageFills: input.exportImageFills,
    topLevelNodes: nodes,
    imageRefs,
    assetsFolder,
    onProgress: (label) => {
      figma.ui.postMessage({ type: "export-progress-asset", label });
    },
  });

  // Build framelinkExport metadata block — single source of truth for asset
  // resolution on the MCP side. Lives at the JSON root.
  const framelinkExport = {
    pluginVersion: PLUGIN_VERSION,
    exportedAt: new Date().toISOString(),
    scope,
    depth: depth ?? null,
    fileName: figma.root.name,
    pageId: page.id,
    pageName: page.name,
    rootNodeIds: nodes.map((n) => n.id),
    assetsFolder,
    assets: assetResult.manifest,
    imageFills: assetResult.imageFills,
    options: {
      exportFrameImages: input.exportFrameImages,
      exportSvgs: input.exportSvgs,
      exportImageFills: input.exportImageFills,
    },
  };

  let response: Record<string, unknown>;
  if (scope === "selection") {
    const nodesMap: Record<string, unknown> = {};
    for (let i = 0; i < nodes.length; i++) {
      nodesMap[nodes[i].id] = {
        document: serializedNodes[i],
        components,
        componentSets,
        styles,
      };
    }
    response = {
      name: figma.root.name,
      framelinkExport,
      nodes: nodesMap,
    };
  } else {
    response = {
      name: figma.root.name,
      framelinkExport,
      document: {
        id: "0:0",
        name: "Document",
        type: "DOCUMENT",
        children: [
          {
            id: page.id,
            name: page.name,
            type: "CANVAS",
            children: serializedNodes,
            backgroundColor: page.backgrounds?.[0]
              ? rgbaToApi((page.backgrounds[0] as SolidPaint).color)
              : { r: 1, g: 1, b: 1, a: 1 },
          },
        ],
      },
      components,
      componentSets,
      styles,
    };
  }

  return {
    json: JSON.stringify(response, null, 2),
    assets: assetResult.assets,
    nodeCount: nodes.length,
    assetsFolder,
  };
}

// ── Plugin entry point ───────────────────────────────────────────────────────

// Initial height pre-allocates room for the always-reserved progress slot
// (visibility: hidden in CSS) so the loading state never causes a scroll flash
// before the resize message round-trips. Export & Cancel share a single grid
// cell, so we don't need extra room for the cancel button. The UI's
// MutationObserver shrinks this back down once it measures actual content.
figma.showUI(__html__, { width: 380, height: 680 });

function updateSelection() {
  const nodes = figma.currentPage.selection;
  figma.ui.postMessage({
    type: "selection-changed",
    count: nodes.length,
    names: nodes.map((n) => n.name),
    defaultFileName: generateDefaultFileName(),
  });
}

updateSelection();
figma.on("selectionchange", updateSelection);

type UIMessage = {
  type: string;
  scope?: "selection" | "page";
  depth?: number;
  fileName?: string;
  exportFrameImages?: boolean;
  exportSvgs?: boolean;
  exportImageFills?: boolean;
  // For "download-complete" — short summary the toast will display.
  notify?: string;
  // For "open-url" — the URL to open in the user's default browser.
  url?: string;
  // For "resize" — pixel height the UI needs to render without scroll.
  height?: number;
};

// External URLs the plugin is allowed to open. We don't accept arbitrary URLs
// from the UI side (even though the UI is our own code) — this guard documents
// intent and prevents accidental drift if someone adds new buttons later.
const ALLOWED_OPEN_URL_PREFIXES = [
  "https://github.com/MiHarsh/figma-local-mcp",
  "https://www.npmjs.com/package/figma-local-mcp",
];

figma.ui.onmessage = async (msg: UIMessage) => {
  if (msg.type === "cancel-export") {
    cancelled = true;
    return;
  }

  // The UI measures its rendered height (DOM-driven, varies with status text /
  // progress visibility) and asks the sandbox to size the window to fit. Hard-
  // coding a height in showUI() left dead whitespace at the bottom.
  if (msg.type === "resize" && typeof msg.height === "number") {
    const clamped = Math.max(360, Math.min(900, Math.round(msg.height)));
    figma.ui.resize(380, clamped);
    return;
  }

  // The UI confirms the file download landed in the user's downloads folder.
  // Keeping the dialog open after success was friction; closing here with a
  // canvas toast is the Figma-native UX (matches built-in plugins).
  if (msg.type === "download-complete") {
    if (msg.notify) figma.notify(msg.notify, { timeout: 4000 });
    figma.closePlugin();
    return;
  }

  // Open external links in the user's default browser. The Figma iframe is
  // sandboxed so <a target="_blank"> clicks are blocked — the host API is the
  // only reliable way out.
  if (msg.type === "open-url" && msg.url) {
    if (ALLOWED_OPEN_URL_PREFIXES.some((p) => msg.url!.startsWith(p))) {
      figma.openExternal(msg.url);
    }
    return;
  }

  if (msg.type !== "export") return;

  cancelled = false;

  try {
    const scope: "selection" | "page" = msg.scope === "page" ? "page" : "selection";
    const nodes =
      scope === "page"
        ? (figma.currentPage.children as readonly SceneNode[])
        : figma.currentPage.selection;

    const fileName = msg.fileName || generateDefaultFileName();
    const result = await performExport({
      scope,
      nodes,
      page: figma.currentPage,
      depth: msg.depth,
      exportFrameImages: msg.exportFrameImages !== false,
      exportSvgs: msg.exportSvgs !== false,
      exportImageFills: msg.exportImageFills !== false,
      jsonFileName: fileName,
    });

    figma.ui.postMessage({
      type: "export-result",
      success: true,
      json: result.json,
      assets: result.assets.map((a) => ({ path: a.path, bytes: a.bytes, mime: a.mime })),
      assetsFolder: result.assetsFolder,
      fileName,
      nodeCount: result.nodeCount,
    });
  } catch (error) {
    if (error instanceof ExportCancelled) {
      figma.ui.postMessage({ type: "export-cancelled" });
      return;
    }
    figma.ui.postMessage({
      type: "export-result",
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
