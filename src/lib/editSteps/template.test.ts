import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectSegment } from "@/lib/videoProject";
import { framingToMatch, type StepState } from "./logic";
import { buildTemplateObjects, placeTemplateFills, TEMPLATE_FILL_TAG, TOPIC_FRAME, type ReferenceTemplate } from "./template";
import { referenceIdOf } from "./templateStore";

const load = (name: string) =>
  JSON.parse(readFileSync(path.join(process.cwd(), "data", "reference-templates", name), "utf8")) as ReferenceTemplate;
const ranking = load("konna-ha-ni-naritai-ranking.json");
const compare = load("kyousei-dochiraga-osusume.json");

const segment = (key: string, start: number, duration: number): ProjectSegment => ({
  key,
  caption: "字幕",
  startFromSeconds: start,
  durationInSeconds: duration,
  captionAnimation: "pop",
  volume: 1,
});
const baseState = (built: ReturnType<typeof buildTemplateObjects>): StepState => ({
  segments: [segment("a", 0, 2), segment("b", 2, 2), segment("c", 4, 2), segment("d", 6, 2)],
  framing: null,
  captionYPercent: null,
  globalShapes: built.globalShapes,
  globalOverlays: built.globalOverlays,
});

describe("見た目の手本の型", () => {
  it("手本の保存名から、型を探す名前を取り出す", () => {
    expect(referenceIdOf("videos/e386cce911f2c3b19f1641858fa10352.mp4")).toBe("e386cce911f2c3b19f1641858fa10352");
    expect(referenceIdOf("youtube/abcdefghijk")).toBe("abcdefghijk");
  });

  it("ランキングは、話している項目の数だけ枠を並べ、帯は枠として数えない", () => {
    const built = buildTemplateObjects({ template: ranking, title: "治したほうがいい\n症状ランキング", frameCount: 3 });
    const frames = built.globalShapes.filter((shape) => !shape.decorative);
    expect(frames).toHaveLength(3);
    expect(built.globalShapes.filter((shape) => shape.decorative)).toHaveLength(1);
    // 枠は型の範囲(上端〜下端)に収まり、型の高さの上限を超えない
    for (const frame of frames) {
      expect(frame.heightPercent).toBeLessThanOrEqual(ranking.frames!.maxHeightPercent);
      expect(frame.yPercent - frame.heightPercent / 2).toBeGreaterThanOrEqual(ranking.frames!.topPercent - 0.01);
    }
    expect(built.globalOverlays.map((overlay) => overlay.text)).toEqual(["治したほうがいい", "症状ランキング", "1位", "2位", "3位"]);
    // タイトルの文字は型の色
    expect(built.globalOverlays[0].color).toBe("#FFFFFF");
    expect(built.globalOverlays[0].strokeColor).toBe("#111111");
  });

  it("冒頭に大きく出してから、いつもの位置へ動くタイトル", () => {
    const built = buildTemplateObjects({ template: compare, title: "矯正治療\nどこで受ける?", frameCount: 0 });
    const [introFirst, placedFirst] = built.globalOverlays;
    expect(introFirst.durationInSeconds).toBe(compare.title.intro!.seconds);
    expect(placedFirst.startOffsetSeconds).toBe(compare.title.intro!.seconds);
    expect(placedFirst.moveFrom?.fontSizePx).toBe(introFirst.fontSizePx);
    expect(placedFirst.color).toBe("#1A4A9C");
    expect(built.globalOverlays[3].color).toBe("#262626");
    expect(built.globalShapes).toHaveLength(2);
  });

  it("ランキングの項目名を枠に入れ、入れ直す時は前の物を外す", () => {
    const state = baseState(buildTemplateObjects({ template: ranking, title: "タイトル", frameCount: 3 }));
    const filled = placeTemplateFills(
      { ...state, frameFills: [{ frame: 3, key: "b", sourceSeconds: 2, label: "出っ歯" }] },
      ranking
    );
    const fills = filled.globalOverlays.filter((overlay) => overlay.tag === TEMPLATE_FILL_TAG);
    expect(fills).toHaveLength(1);
    expect(fills[0].startOffsetSeconds).toBe(2);
    expect(fills[0].backgroundColor).toBe("#FFFFFF");
    const again = placeTemplateFills(filled, ranking);
    expect(again.globalOverlays.filter((overlay) => overlay.tag === TEMPLATE_FILL_TAG)).toHaveLength(1);
  });

  it("比べるカードは、名前を下に残し、中身と話題の見出しを入れ替えて出す", () => {
    const state = baseState(buildTemplateObjects({ template: compare, title: "タイトル", frameCount: 0 }));
    const filled = placeTemplateFills(
      {
        ...state,
        frameFills: [
          { frame: 1, key: "a", sourceSeconds: 0, label: "日本" },
          { frame: 2, key: "a", sourceSeconds: 0, label: "韓国" },
          { frame: TOPIC_FRAME, key: "b", sourceSeconds: 2, label: "費用" },
          { frame: 1, key: "b", sourceSeconds: 2, label: "100万円" },
          { frame: TOPIC_FRAME, key: "d", sourceSeconds: 6, label: "期間" },
          { frame: 1, key: "d", sourceSeconds: 6, label: "2年" },
        ],
      },
      compare
    );
    const fills = filled.globalOverlays.filter((overlay) => overlay.tag === TEMPLATE_FILL_TAG);
    const byText = (text: string) => fills.find((overlay) => overlay.text === text)!;
    expect(byText("日本").durationInSeconds).toBeUndefined();
    expect(byText("100万円").durationInSeconds).toBe(4);
    expect(byText("費用").durationInSeconds).toBe(4);
    expect(byText("費用").backgroundColor).toBe("#FFFFFF");
    // 中身は名前より上
    expect(byText("100万円").yPercent).toBeLessThan(byText("日本").yPercent);
  });

  it("顔の大きさが手本と同じでも、手本の位置(右寄り)まで届く倍率で寄せる", () => {
    const framing = framingToMatch({ xPercent: 50, yPercent: 30, widthPercent: 10, heightPercent: 14 }, { xPercent: 68, yPercent: 33, heightPercent: 14 });
    expect(framing?.scale).toBeCloseTo(1.36, 2);
    // 拡大後の顔の位置 = focus + (face - focus) * scale
    expect(framing!.focusXPercent + (50 - framing!.focusXPercent) * framing!.scale).toBeCloseTo(68, 0);
  });
});
