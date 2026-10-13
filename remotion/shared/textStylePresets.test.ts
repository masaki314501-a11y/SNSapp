import { describe, expect, it } from "vitest";
import { TEXT_STYLE_PRESETS, findTextStylePreset } from "./textStylePresets";
import { CAPTION_FONT_FAMILY_OPTIONS } from "./schema";

const HEX = /^#[0-9a-f]{6}$/;

describe("TEXT_STYLE_PRESETS", () => {
  it("idが重ならず、名前から引ける", () => {
    const ids = TEXT_STYLE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findTextStylePreset("creative-001")?.id).toBe("creative-001");
    expect(findTextStylePreset(undefined)).toBeUndefined();
  });

  it("書体は同梱している物だけ、色は#RRGGBB、長さは文字の大きさに対して常識的な割合", () => {
    const fonts = new Set(CAPTION_FONT_FAMILY_OPTIONS.map((option) => option.value));
    for (const preset of TEXT_STYLE_PRESETS) {
      expect(fonts.has(preset.fontFamily)).toBe(true);
      const colors = [
        preset.color,
        ...(preset.gradient?.stops.map(([color]) => color) ?? []),
        ...preset.strokes.map(([color]) => color),
        preset.shadow?.color,
        ...(preset.backgrounds?.map((background) => background.color) ?? []),
      ].filter((color) => color !== undefined);
      for (const color of colors) expect(color).toMatch(HEX);
      expect(preset.color !== undefined || preset.gradient !== undefined).toBe(true);
      for (const [, width] of preset.strokes) expect(width).toBeGreaterThan(0);
      for (const [, width] of preset.strokes) expect(width).toBeLessThan(1);
    }
  });
});
