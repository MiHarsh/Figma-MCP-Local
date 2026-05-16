/**
 * Map a Figma component or layer name to a familiar semantic UI primitive.
 *
 * Why heuristic, not exhaustive: design teams use wildly different naming
 * conventions ("Button/Primary", "btn-primary", "PrimaryButton", "CTA Button").
 * We err on the side of recall — if a name plausibly looks like a primitive,
 * tag it. The agent treats the tag as a strong hint, not a contract, and the
 * extractor's `componentName`/`componentDescription` fields remain available
 * for cases the heuristic misses.
 *
 * Why this exists: agents repeatedly generate `<div>` for what is obviously a
 * button or input because the raw Figma data has no semantic signal — node
 * type is just `INSTANCE`/`FRAME`. A targeted hint dramatically improves
 * generated component fidelity (proper element, correct ARIA, correct events).
 */

type Rule = { pattern: RegExp; role: string };

// Order matters: more specific patterns first so e.g. "icon button" classifies
// as button (action), not icon (display-only). Patterns are checked against
// the component's full path including any "Set/Variant" prefix.
const RULES: Rule[] = [
  // Form controls — most agent value here, hardest to recover from JSON alone.
  { pattern: /\b(text\s*field|text\s*box|input\s*field|text\s*input|textinput)\b/i, role: "textbox" },
  { pattern: /\b(text\s*area|textarea)\b/i, role: "textarea" },
  { pattern: /\b(combo\s*box|combobox|dropdown|select|picker)\b/i, role: "dropdown" },
  { pattern: /\b(check\s*box|checkbox)\b/i, role: "checkbox" },
  { pattern: /\b(radio\s*button|radio)\b/i, role: "radio" },
  { pattern: /\b(toggle|switch)\b/i, role: "switch" },
  { pattern: /\b(slider|range)\b/i, role: "slider" },
  { pattern: /\b(progress\s*bar|progress)\b/i, role: "progressbar" },
  { pattern: /\b(search\s*bar|searchbar|search\s*field)\b/i, role: "searchbox" },

  // Action triggers
  { pattern: /\b(icon\s*button|iconbutton)\b/i, role: "button" },
  { pattern: /\b(button|btn|cta)\b/i, role: "button" },
  { pattern: /\b(link|hyperlink|anchor)\b/i, role: "link" },

  // Containers / overlays
  { pattern: /\b(modal|dialog)\b/i, role: "dialog" },
  { pattern: /\b(drawer|sheet|side\s*panel)\b/i, role: "drawer" },
  { pattern: /\b(popover|popup|tooltip)\b/i, role: "popover" },
  { pattern: /\b(menu(\s*item)?|context\s*menu)\b/i, role: "menu" },
  { pattern: /\b(card|tile)\b/i, role: "card" },
  { pattern: /\b(banner|alert|toast|notification|snackbar)\b/i, role: "alert" },

  // Navigation
  { pattern: /\b(tab\s*bar|tabs|tab)\b/i, role: "tab" },
  { pattern: /\b(breadcrumb)\b/i, role: "breadcrumb" },
  { pattern: /\b(nav\s*bar|navbar|navigation|header|app\s*bar|appbar)\b/i, role: "navigation" },
  { pattern: /\b(footer)\b/i, role: "contentinfo" },
  { pattern: /\b(sidebar|side\s*nav)\b/i, role: "navigation" },
  { pattern: /\b(pagination|pager)\b/i, role: "pagination" },
  { pattern: /\b(stepper|wizard)\b/i, role: "stepper" },

  // Display
  { pattern: /\b(badge|chip|tag|pill|label\s*chip)\b/i, role: "badge" },
  { pattern: /\b(avatar|profile\s*pic)\b/i, role: "avatar" },
  { pattern: /\b(icon)\b/i, role: "icon" },
  { pattern: /\b(divider|separator|hr)\b/i, role: "separator" },
  { pattern: /\b(table|grid)\b/i, role: "table" },
  { pattern: /\b(list(\s*item)?)\b/i, role: "list" },
  { pattern: /\b(image|photo|picture|thumbnail|thumb)\b/i, role: "image" },
  { pattern: /\b(spinner|loader|loading)\b/i, role: "progressbar" },
];

/**
 * Returns a semantic role string if the name plausibly matches a known UI
 * primitive, else undefined. Caller decides where to attach (typically to the
 * INSTANCE node or to a FRAME whose name is conventionally semantic).
 */
export function deriveSemanticRole(name: string | undefined): string | undefined {
  if (!name) return undefined;
  for (const { pattern, role } of RULES) {
    if (pattern.test(name)) return role;
  }
  return undefined;
}
