import { describe, expect, it } from "vitest";
import { parse } from "smol-toml";
import { config } from "../src/config.ts";
import { applySettings, readsHelixConfig, SETTINGS_TEMPLATE } from "../src/settings.ts";
import { setTomlKey } from "../src/tomlEdit.ts";
import { altText, freeName, imageLink, inside, pastedName, unusedImages } from "../src/imageInput.ts";

describe("settings", () => {
  it("the template parses, and changes nothing while commented out", () => {
    const before = structuredClone(config);
    const toml = parse(SETTINGS_TEMPLATE);
    expect(applySettings(toml)).toEqual([]);
    expect(config).toEqual(before);
  });

  it("every setting in the template takes effect once uncommented", () => {
    // Both theme lines are examples of one setting: the second stays.
    const text = SETTINGS_TEMPLATE.replace('# theme = "auto"\n', "").replace(/^# (?=[\w-]+ = |\[)/gm, "");
    const toml = parse(text);
    applySettings(toml);
    expect(config.theme).toEqual({ light: "catppuccin_latte", dark: "catppuccin_mocha" });
    expect(config.imageFolder).toBe("assets");
    expect(config.lineNumbers).toBe(true);
  });

  it("applies this editor's own options over the Helix ones", () => {
    applySettings({
      "read-helix-config": false,
      "check-for-updates": false,
      editor: { spellcheck: false, "text-width": 72 },
      images: { folder: "./img/" },
      keys: { normal: { space: { w: ":w" } } },
    });
    expect(config.readHelixConfig).toBe(false);
    expect(config.checkForUpdates).toBe(false);
    expect(config.spellcheck).toBe(false);
    expect(config.textWidth).toBe(72);
    expect(config.imageFolder).toBe("img");
    expect((config.keys.normal.space as Record<string, unknown>).w).toBe(":w");
  });

  it("read-helix-config falls back to the default", () => {
    config.readHelixConfig = true;
    expect(readsHelixConfig(null)).toBe(true);
    expect(readsHelixConfig({})).toBe(true);
    expect(readsHelixConfig({ "read-helix-config": false })).toBe(false);
  });
});

describe("image input", () => {
  it("names pasted images by the time", () => {
    expect(pastedName("image/png", new Date(2026, 9, 22, 14, 30, 5))).toBe("pasted-2026-10-22-143005.png");
    expect(pastedName("image/jpeg", new Date(2026, 0, 2, 3, 4, 5))).toBe("pasted-2026-01-02-030405.jpg");
  });

  it("picks a free, link-friendly file name", () => {
    expect(freeName("Team photo (1).jpg", [])).toBe("Team-photo-1.jpg");
    expect(freeName("chart.png", ["chart.png", "Chart-2.png"])).toBe("chart-3.png");
    expect(freeName("...", [])).toBe("image.png");
  });

  it("links images inside the document's folder where they are", () => {
    expect(inside("/notes", "/notes/img/a.png")).toBe("img/a.png");
    expect(inside("/notes", "/notes-old/a.png")).toBeNull();
    expect(inside("/", "/a.png")).toBe("a.png");
  });

  it("calls an image unused only when no markdown mentions its name", () => {
    const texts = ["![](assets/a%20b%20%282%29.png) and ![[c.png]]", "<img src=\"assets/d.png\">"];
    expect(unusedImages(["a b (2).png", "c.png", "d.png", "e.png"], texts)).toEqual(["e.png"]);
  });

  it("writes links a markdown parser reads back", () => {
    expect(imageLink("assets/a b (2).png", altText("a_b-2.png"))).toBe("![a b 2](assets/a%20b%20%282%29.png)");
    expect(imageLink("x.png", "[draft]")).toBe("![\\[draft\\]](x.png)");
    expect(altText("pasted-2026-10-22-143005-2.png")).toBe("");
  });
});

describe("setTomlKey", () => {
  it("sets a key in its table, on its line or its commented-out one, keeping the rest", () => {
    expect(setTomlKey("", "editor", "hints", "false")).toBe("[editor]\nhints = false\n");
    expect(setTomlKey("[editor]\nhints = true\n[keys]\n", "editor", "hints", "false")).toBe("[editor]\nhints = false\n[keys]\n");
    expect(setTomlKey("[editor]\nx = 1\n[images]\nhints = 2\n", "editor", "hints", "false")).toBe("[editor]\nhints = false\nx = 1\n[images]\nhints = 2\n");
    const set = setTomlKey(SETTINGS_TEMPLATE, "editor", "hints", "false");
    expect(set).toContain("toggles them.\nhints = false\n");
    expect(set.split("\n").length).toBe(SETTINGS_TEMPLATE.split("\n").length);
    applySettings(parse(set));
    expect(config.hints).toBe(false);
  });
});
