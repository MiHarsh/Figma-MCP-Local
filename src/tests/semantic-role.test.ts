import { describe, it, expect } from "vitest";
import { deriveSemanticRole } from "~/utils/semantic-role.js";

describe("deriveSemanticRole", () => {
  it("matches common button naming variants", () => {
    expect(deriveSemanticRole("Button/Primary")).toBe("button");
    expect(deriveSemanticRole("btn-secondary")).toBe("button");
    expect(deriveSemanticRole("Primary CTA")).toBe("button");
    // Icon-button is more specific but still semantically a button
    expect(deriveSemanticRole("Icon Button/Hover")).toBe("button");
  });

  it("matches form controls", () => {
    expect(deriveSemanticRole("TextField/Default")).toBe("textbox");
    expect(deriveSemanticRole("text input")).toBe("textbox");
    expect(deriveSemanticRole("Textarea/Multiline")).toBe("textarea");
    expect(deriveSemanticRole("Dropdown/Open")).toBe("dropdown");
    expect(deriveSemanticRole("Combobox")).toBe("dropdown");
    expect(deriveSemanticRole("Checkbox/Checked")).toBe("checkbox");
    expect(deriveSemanticRole("Radio button")).toBe("radio");
    expect(deriveSemanticRole("Toggle/On")).toBe("switch");
    expect(deriveSemanticRole("Search bar")).toBe("searchbox");
  });

  it("matches container and overlay primitives", () => {
    expect(deriveSemanticRole("Modal/Confirm")).toBe("dialog");
    expect(deriveSemanticRole("Dialog/Alert")).toBe("dialog");
    expect(deriveSemanticRole("Card/Hover")).toBe("card");
    expect(deriveSemanticRole("Toast notification")).toBe("alert");
  });

  it("matches navigation primitives", () => {
    expect(deriveSemanticRole("NavBar")).toBe("navigation");
    expect(deriveSemanticRole("Tab/Active")).toBe("tab");
    expect(deriveSemanticRole("Breadcrumb")).toBe("breadcrumb");
  });

  it("returns undefined for non-matching names", () => {
    expect(deriveSemanticRole("UnknownThingamajig")).toBeUndefined();
    expect(deriveSemanticRole("")).toBeUndefined();
    expect(deriveSemanticRole(undefined)).toBeUndefined();
  });
});
