/**
 * Framelink Exporter — Figma plugin that serializes the current selection (or
 * entire page) into the exact JSON shape returned by the Figma REST API
 * (GetFileNodesResponse / GetFileResponse). The exported file can be fed
 * directly to Framelink MCP's extractor pipeline without hitting the API.
 *
 * Why this exists: The Figma REST API has aggressive rate limits on free plans.
 * This plugin lets designers export the relevant subtree once, commit the JSON
 * alongside the codebase, and let AI coding tools consume it locally.
 */

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
  // The gradient transform is a 2x3 matrix [[a, b, tx], [c, d, ty]]
  // Handle positions are start, end, and a width control point
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

// ── Node Serializer ──────────────────────────────────────────────────────────

type SerializedNode = Record<string, unknown>;

/**
 * Recursively serialize a Figma Plugin API node into the REST API JSON shape.
 * Captures the same properties that Framelink's extractors consume:
 *  - layout (absoluteBoundingBox, constraints, auto-layout props)
 *  - visuals (fills, strokes, effects, opacity, corner radius)
 *  - text (characters, style)
 *  - components (componentProperties, mainComponent reference)
 */
async function serializeNode(node: SceneNode, currentDepth: number, maxDepth?: number): Promise<SerializedNode> {
  const result: SerializedNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible,
  };

  // Bounding boxes
  const bb = boundingBoxFromNode(node);
  if (bb) result.absoluteBoundingBox = bb;
  const rb = renderBoundsFromNode(node);
  if (rb) result.absoluteRenderBounds = rb;

  // Size
  if ("width" in node) result.size = { x: (node as FrameNode).width, y: (node as FrameNode).height };

  // Constraints
  const c = constraintsToApi(node as SceneNode & { constraints?: Constraints });
  if (c) result.constraints = c;

  // Blend mode and opacity
  if ("blendMode" in node) result.blendMode = (node as GeometryMixin & BaseNodeMixin).blendMode;
  if ("opacity" in node) result.opacity = (node as BlendMixin).opacity;
  if ("isMask" in node) result.isMask = (node as any).isMask;

  // Fills and strokes
  if ("fills" in node) {
    const fills = node.fills;
    if (fills !== figma.mixed && Array.isArray(fills)) {
      result.fills = fills.map(colorToApi);
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

  // Corner radius
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

  // Effects
  if ("effects" in node) {
    result.effects = (node as BlendMixin & SceneNode).effects.map(effectToApi);
  }

  // Clips content
  if ("clipsContent" in node) result.clipsContent = (node as FrameNode).clipsContent;

  // Auto-layout properties (these map to the REST API's layout properties)
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

  // Layout sizing
  if ("layoutSizingHorizontal" in node) {
    result.layoutSizingHorizontal = (node as FrameNode).layoutSizingHorizontal;
  }
  if ("layoutSizingVertical" in node) {
    result.layoutSizingVertical = (node as FrameNode).layoutSizingVertical;
  }
  if ("layoutGrow" in node) result.layoutGrow = (node as FrameNode).layoutGrow;
  if ("layoutAlign" in node) result.layoutAlign = (node as FrameNode).layoutAlign;
  if ("layoutPositioning" in node) result.layoutPositioning = (node as FrameNode).layoutPositioning;

  // Min/max size
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

    // Collect the dominant text style (Figma REST API returns a single `style` object)
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

    // Character-level style overrides (styleOverrideTable)
    // The REST API returns this when segments differ. We'll provide a simplified
    // version by detecting styled segments.
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
          // Each character in the segment gets this override ID
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

  // ── Component properties ───────────────────────────────────────────────────

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

  // ── Children ───────────────────────────────────────────────────────────────

  if ("children" in node) {
    const container = node as FrameNode & { children: readonly SceneNode[] };
    if (maxDepth !== undefined && currentDepth >= maxDepth) {
      // Truncated — still note there are children
      result.children = [];
    } else {
      const childResults: SerializedNode[] = [];
      for (const child of container.children) {
        childResults.push(await serializeNode(child, currentDepth + 1, maxDepth));
      }
      result.children = childResults;
    }
  }

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

async function collectStyles(): Promise<Record<string, { key: string; name: string; styleType: string; description: string }>> {
  const styles: Record<string, { key: string; name: string; styleType: string; description: string }> = {};
  // Collect local paint styles
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

// ── Export logic ──────────────────────────────────────────────────────────────

async function exportSelection(nodes: readonly SceneNode[], depth?: number): Promise<string> {
  if (nodes.length === 0) throw new Error("No nodes selected");

  const components: Record<string, ComponentMeta> = {};
  const componentSets: Record<string, ComponentSetMeta> = {};

  for (const node of nodes) {
    collectComponents(node, components, componentSets);
  }

  const styles = await collectStyles();

  if (nodes.length === 1) {
    // Single node: export as GetFileNodesResponse format
    const node = nodes[0];
    const serialized = await serializeNode(node, 0, depth);

    const response = {
      name: figma.root.name,
      nodes: {
        [node.id]: {
          document: serialized,
          components,
          componentSets,
          styles,
        },
      },
    };

    return JSON.stringify(response, null, 2);
  }

  // Multiple nodes: wrap in a virtual frame (GetFileNodesResponse with first node)
  // Actually the REST API returns one entry per requested node ID.
  const nodesMap: Record<string, unknown> = {};
  for (const node of nodes) {
    nodesMap[node.id] = {
      document: await serializeNode(node, 0, depth),
      components,
      componentSets,
      styles,
    };
  }

  const response = {
    name: figma.root.name,
    nodes: nodesMap,
  };

  return JSON.stringify(response, null, 2);
}

async function exportPage(page: PageNode, depth?: number): Promise<string> {
  const components: Record<string, ComponentMeta> = {};
  const componentSets: Record<string, ComponentSetMeta> = {};

  for (const child of page.children) {
    collectComponents(child, components, componentSets);
  }

  const styles = await collectStyles();

  // Export as GetFileResponse format (what the REST API returns for full file fetch)
  const children: SerializedNode[] = [];
  for (const child of page.children) {
    children.push(await serializeNode(child, 0, depth));
  }

  const response = {
    name: figma.root.name,
    document: {
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
      children: [
        {
          id: page.id,
          name: page.name,
          type: "CANVAS",
          children,
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

  return JSON.stringify(response, null, 2);
}

// ── Plugin entry point ───────────────────────────────────────────────────────

figma.showUI(__html__, { width: 320, height: 420 });

function updateSelection() {
  const nodes = figma.currentPage.selection;
  figma.ui.postMessage({
    type: "selection-changed",
    count: nodes.length,
    names: nodes.map((n) => n.name),
  });
}

// Fire once on open
updateSelection();

// React to selection changes
figma.on("selectionchange", updateSelection);

figma.ui.onmessage = async (msg: { type: string; scope: string; depth?: number }) => {
  if (msg.type !== "export") return;

  try {
    figma.ui.postMessage({
      type: "export-progress",
      message: "Serializing node tree...",
    });

    let data: string;
    let nodeCount: number;
    const depth = msg.depth;

    if (msg.scope === "page") {
      data = await exportPage(figma.currentPage, depth);
      nodeCount = figma.currentPage.children.length;
    } else {
      const selection = figma.currentPage.selection;
      if (selection.length === 0) {
        figma.ui.postMessage({
          type: "export-result",
          success: false,
          error: "No nodes selected. Select at least one node in Figma.",
        });
        return;
      }
      data = await exportSelection(selection, depth);
      nodeCount = selection.length;
    }

    // Sanitize file name from the Figma file name
    const safeName = figma.root.name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
    const timestamp = new Date().toISOString().slice(0, 10);
    const fileName = `${safeName}_${timestamp}.json`;

    figma.ui.postMessage({
      type: "export-result",
      success: true,
      data,
      fileName,
      nodeCount,
    });
  } catch (error) {
    figma.ui.postMessage({
      type: "export-result",
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
