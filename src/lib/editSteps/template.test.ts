import { describe, expect, it } from "vitest";
import type { ProjectSegment } from "@/lib/videoProject";
import { framingToMatch, type StepState } from "./logic";
import { buildTemplateObjects, placeTemplateFills, TEMPLATE_FILL_TAG, TOPIC_FRAME, type ReferenceTemplate } from "./template";
import { countCaptionLooks, dominantColors, keepGlow, measureNameCenter, referenceIdOf, snapColor, strokeLooksSwapped, toReferenceTemplate, type ExtractedTemplate } from "./templateExtract";

/** テスト用の型(ランキング)。手本から読み取った形と同じ。 */
const ranking: ReferenceTemplate = {
  name: "見た目の手本",
  referenceIds: ["r"],
  kind: "ranking",
  caption: { topPercent: 50, xPercent: 71, maxWidthPercent: 50, fontSize: "large", fontFamily: "M PLUS Rounded 1c", style: "outline", textColor: "#33ABC4", accentColor: "#FFFFFF" },
  emphasisStyles: [{ role: "話の要点", fontFamily: "M PLUS Rounded 1c", textColor: "#FFFFFF", bandColor: null, strokeColor: "#000000" }],
  title: {
    align: "center",
    xPercent: 50,
    yPercent: 11.7,
    fontSizePx: 48,
    maxWidthPercent: 86,
    lineCount: 2,
    lines: [{ fontFamily: "Noto Sans JP", color: "#FFFFFF", strokeColor: "#111111" }],
    band: { color: "#C0C030", topPercent: 7.9, heightPercent: 7.9 },
  },
  frames: {
    xPercent: 25,
    widthPercent: 34,
    topPercent: 17.5,
    bottomPercent: 90.5,
    gapPercent: 1.5,
    maxHeightPercent: 13.5,
    defaultCount: 5,
    shape: { borderColor: "#111111", borderWidthPx: 8, fillOpacity: 1, cornerRadiusPx: 28 },
    number: {
      format: "{n}位",
      fontSizePx: 48,
      looks: [
        { color: "#C8B464", strokeColor: "#111111" },
        { color: "#A8A8A8", strokeColor: "#111111" },
        { color: "#8C6440", strokeColor: "#111111" },
        { color: "#FFFFFF", strokeColor: "#111111" },
      ],
    },
    content: "image",
    label: { fontSizePx: 52, look: { color: "#111111", bandColor: "#FFFFFF" } },
    popup: { xPercent: 71, yPercent: 73, widthPercent: 48, heightPercent: 19, seconds: 2, name: { fontSizePx: 56, look: { color: "#000000", bandColor: "#FFFFFF" }, yPercent: 86 } },
  },
  cta: { xPercent: 50, yPercent: 50, fontSizePx: 64, look: { color: "#FFE14D", glowColor: "#1F5FC8" }, seconds: 2, maxWidthPercent: 90 },
};

/** テスト用の型(比べる)。 */
const compare: ReferenceTemplate = {
  name: "見た目の手本",
  referenceIds: ["c"],
  kind: "compare",
  caption: { topPercent: 45, bottomPercent: 51, xPercent: 50, maxWidthPercent: 90, fontSize: "xlarge", fontFamily: "Noto Serif JP", style: "outline", textColor: "#FFFFFF", accentColor: "#000000" },
  emphasisStyles: [
    { role: "話の要点", fontFamily: "M PLUS Rounded 1c", textColor: "#30A8C0", bandColor: null, strokeColor: "#FFFFFF" },
    { role: "比べた結果、選ばれた方の名前", fontFamily: "Noto Sans JP", textColor: "#FFFFFF", bandColor: null, strokeColor: "#1860C0" },
  ],
  title: {
    align: "center",
    xPercent: 31,
    yPercent: 12.5,
    fontSizePx: 50,
    maxWidthPercent: 50,
    lineCount: 2,
    lines: [
      { fontFamily: "Noto Sans JP", color: "#FFFFFF", strokeColor: "#1860C0" },
      { fontFamily: "Noto Sans JP", color: "#FFFFFF", strokeColor: "#181818" },
    ],
    intro: { seconds: 2, xPercent: 50, yPercent: 48, fontSizePx: 100 },
  },
  compare: {
    row: { yPercent: 71, heightPercent: 22, leftPercent: 7.5, rightPercent: 92.5, gapPercent: 3 },
    shape: { borderColor: "#A8A8A8", borderWidthPx: 6, fillColor: "#FFFFFF", fillOpacity: 1, cornerRadiusPx: 0 },
    content: "image",
    name: { fontSizePx: 56, look: { color: "#111111" }, fromBottomPercent: 3.2 },
    topic: { xPercent: 50, yPercent: 55.7, fontSizePx: 56, look: { color: "#111111", bandColor: "#FFFFFF" } },
    marker: { color: "#E00000", strokeWidthPx: 10 },
  },
};

const segment = (key: string, start: number, duration: number, caption = "字幕"): ProjectSegment => ({
  key,
  caption,
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
  it("手本の保存名から、型を覚えておく名前を取り出す", () => {
    expect(referenceIdOf("videos/e386cce911f2c3b19f1641858fa10352.mp4")).toBe("e386cce911f2c3b19f1641858fa10352");
    expect(referenceIdOf("youtube/abcdefghijk")).toBe("abcdefghijk");
  });

  it("ランキングは、話している項目の数だけ枠を並べ、番号は順位ごとの色(4位から同じ)", () => {
    const built = buildTemplateObjects({ template: ranking, title: "治したほうがいい\n症状ランキング", frameCount: 5 });
    const frames = built.globalShapes.filter((shape) => !shape.decorative);
    expect(frames).toHaveLength(5);
    expect(built.globalShapes.filter((shape) => shape.decorative)).toHaveLength(1);
    const numbers = built.globalOverlays.filter((overlay) => overlay.text.endsWith("位"));
    expect(numbers.map((overlay) => overlay.color)).toEqual(["#C8B464", "#A8A8A8", "#8C6440", "#FFFFFF", "#FFFFFF"]);
  });

  it("冒頭に大きく出してから、いつもの位置へ動くタイトル(行ごとの見た目)", () => {
    const built = buildTemplateObjects({ template: compare, title: "日本と韓国\n矯正治療の違い", frameCount: 2 });
    const [introFirst, placedFirst] = built.globalOverlays;
    expect(introFirst.durationInSeconds).toBe(2);
    expect(placedFirst.startOffsetSeconds).toBe(2);
    expect(placedFirst.moveFrom?.fontSizePx).toBe(introFirst.fontSizePx);
    expect(placedFirst.strokeColor).toBe("#1860C0");
    expect(built.globalOverlays[3].strokeColor).toBe("#181818");
  });

  it("比べるカードの数は話の内容で決まり、手本の並べ方の範囲に等しい幅で並ぶ", () => {
    const two = buildTemplateObjects({ template: compare, title: "タイトル", frameCount: 2 }).globalShapes;
    const three = buildTemplateObjects({ template: compare, title: "タイトル", frameCount: 3 }).globalShapes;
    expect(two).toHaveLength(2);
    expect(three).toHaveLength(3);
    expect(three[0].widthPercent).toBeLessThan(two[0].widthPercent);
    expect(three[0].xPercent - three[0].widthPercent / 2).toBeCloseTo(7.5, 1);
    expect(three[2].xPercent + three[2].widthPercent / 2).toBeCloseTo(92.5, 1);
  });

  it("話の内容が手本の出し方と違う時(kind=none)は、タイトルだけ型どおりに置く", () => {
    const built = buildTemplateObjects({ template: ranking, title: "タイトル", frameCount: 5, kind: "none" });
    expect(built.globalShapes.filter((shape) => !shape.decorative)).toHaveLength(0);
  });

  it("ランキングの項目は、大きく出してから枠へ動いて入る(合う絵が無ければ文字)", () => {
    const state = baseState(buildTemplateObjects({ template: ranking, title: "タイトル", frameCount: 3 }));
    const filled = placeTemplateFills(
      {
        ...state,
        frameFills: [
          { frame: 3, key: "b", sourceSeconds: 2, label: "出っ歯" },
          { frame: 2, key: "c", sourceSeconds: 4, label: "謎の項目" },
        ],
        fillImageSrcs: { 出っ歯: "images/library/x.jpg" },
      },
      ranking
    );
    const [popup, inFrame] = filled.templateImages!;
    expect(popup.startOffsetSeconds).toBe(2);
    expect(popup.durationInSeconds).toBe(2);
    expect(inFrame.startOffsetSeconds).toBe(4);
    expect(inFrame.moveFrom?.xPercent).toBe(71);
    expect(inFrame.fit).toBe("cover");
    const fills = filled.globalOverlays.filter((overlay) => overlay.tag === TEMPLATE_FILL_TAG);
    // 名前は大きく出している間だけ。合う絵が無い項目は、枠に文字
    expect(fills.find((overlay) => overlay.text === "出っ歯")?.durationInSeconds).toBe(2);
    expect(fills.find((overlay) => overlay.text === "謎の項目")?.backgroundColor).toBe("#FFFFFF");
    // 入れ直しても増えない
    const again = placeTemplateFills(filled, ranking);
    expect(again.globalOverlays.filter((overlay) => overlay.tag === TEMPLATE_FILL_TAG)).toHaveLength(fills.length);
    expect(again.templateImages).toHaveLength(2);
  });

  it("比べるカードは、下に名前・上に絵、上に話題の見出し、選ばれた方の絵に丸(言い切った字幕の間だけ)", () => {
    const state = baseState(buildTemplateObjects({ template: compare, title: "タイトル", frameCount: 2 }));
    const filled = placeTemplateFills(
      {
        ...state,
        frameFills: [
          { frame: 1, key: "a", sourceSeconds: 0, label: "日本" },
          { frame: 2, key: "a", sourceSeconds: 0, label: "韓国" },
          { frame: TOPIC_FRAME, key: "b", sourceSeconds: 2, label: "価格" },
          { frame: TOPIC_FRAME, key: "d", sourceSeconds: 6, label: "期間" },
        ],
        fillImageSrcs: { 日本: "images/library/jp.png", 韓国: "images/library/kr.png" },
        templateMarks: [{ frame: 2, key: "c", sourceSeconds: 4 }],
      },
      compare
    );
    const fills = filled.globalOverlays.filter((overlay) => overlay.tag === TEMPLATE_FILL_TAG);
    const byText = (text: string) => fills.find((overlay) => overlay.text === text)!;
    expect(byText("日本").durationInSeconds).toBeUndefined();
    expect(byText("価格").durationInSeconds).toBe(4);
    expect(filled.templateImages).toHaveLength(2);
    // 絵は名前より上
    expect(filled.templateImages![0].yPercent).toBeLessThan(byText("日本").yPercent);
    const [mark] = filled.templateShapes!;
    expect(mark.kind).toBe("circle");
    expect(mark.startOffsetSeconds).toBe(4);
    expect(mark.durationInSeconds).toBe(2);
    expect(mark.xPercent).toBeCloseTo(filled.templateImages![1].xPercent, 1);
  });

  it("最後の一言は、動画の終わりの手本と同じ秒数だけ出す", () => {
    const state = baseState(buildTemplateObjects({ template: ranking, title: "タイトル", frameCount: 2 }));
    const filled = placeTemplateFills({ ...state, templateCta: "プロフィールから\nご予約ください" }, ranking);
    const cta = filled.globalOverlays.filter((overlay) => overlay.tag === TEMPLATE_FILL_TAG);
    expect(cta.map((overlay) => overlay.text)).toEqual(["プロフィールから", "ご予約ください"]);
    expect(cta[0].startOffsetSeconds).toBe(6);
    expect(cta[0].glowColor).toBe("#1F5FC8");
  });

  it("最後の一言と同じ高さの話題の見出しは、最後の一言が出る時に消す(名前は残す)", () => {
    const withCta: ReferenceTemplate = { ...compare, cta: { xPercent: 50, yPercent: 56, fontSizePx: 64, look: { color: "#FFFFFF", strokeColor: "#000000" }, seconds: 1, maxWidthPercent: 90 } };
    const state = baseState(buildTemplateObjects({ template: withCta, title: "タイトル", frameCount: 2 }));
    const filled = placeTemplateFills(
      {
        ...state,
        frameFills: [
          { frame: 1, key: "a", sourceSeconds: 0, label: "日本" },
          { frame: 2, key: "a", sourceSeconds: 0, label: "韓国" },
          { frame: TOPIC_FRAME, key: "b", sourceSeconds: 2, label: "価格" },
          { frame: TOPIC_FRAME, key: "d", sourceSeconds: 6, label: "期間" },
        ],
        templateCta: "プロフィールから予約",
      },
      withCta
    );
    const fills = filled.globalOverlays.filter((overlay) => overlay.tag === TEMPLATE_FILL_TAG);
    const byText = (text: string) => fills.find((overlay) => overlay.text === text)!;
    expect(byText("期間").durationInSeconds).toBe(1);
    expect(byText("価格").durationInSeconds).toBe(4);
    expect(byText("日本").durationInSeconds).toBeUndefined();
    expect(byText("プロフィールから予約").startOffsetSeconds).toBe(7);
  });

  it("顔の大きさが手本と同じでも、手本の位置(右寄り)まで届く倍率で寄せる", () => {
    const framing = framingToMatch({ xPercent: 50, yPercent: 30, widthPercent: 10, heightPercent: 14 }, { xPercent: 68, yPercent: 33, heightPercent: 14 });
    expect(framing?.scale).toBeCloseTo(1.36, 2);
    expect(framing!.focusXPercent + (50 - framing!.focusXPercent) * framing!.scale).toBeCloseTo(68, 0);
  });
});

describe("手本から型を読み取る", () => {
  it("AIの答えた色を、その所で実際に多い色に合わせる(文字と縁取りを取り違えない)", () => {
    // 白い文字(多い)と、青い縁取り
    const width = 10;
    const height = 10;
    const pixels = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      const blue = i % 3 === 0;
      pixels.set(blue ? [24, 72, 160] : [240, 240, 240], i * 3);
    }
    const measured = dominantColors(pixels, width, height, { xPercent: 50, yPercent: 50, widthPercent: 100, heightPercent: 100 });
    expect(measured).toHaveLength(2);
    expect(snapColor("#FFFFFF", measured)).toBe("#F0F0F0");
    expect(snapColor("#1A4A9C", measured, [[240, 240, 240]])).toBe("#1848A0");
    // 近い色が無ければ、AIの答えのまま
    expect(snapColor("#FF0000", measured)).toBe("#FF0000");
  });

  it("字幕の見た目ごとの数を画素から数える(縁の色にすぎない見た目・入れ替わっただけの見た目は数えない)", () => {
    const width = 80;
    const height = 30;
    // 灰色の背景に、文字の色の太い横線を、縁の色(太さ3)で囲み、その外に影の色(太さ2)を付けた切り抜き
    const crop = (fill: number[], edge: number[], shadow: number[] | null) => {
      const pixels = new Uint8Array(width * height * 3);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const inside = (grow: number) => x >= 10 - grow && x < 70 + grow && y >= 12 - grow && y < 18 + grow;
          const rgb = inside(0) ? fill : inside(3) ? edge : shadow && inside(5) ? shadow : [100, 100, 100];
          pixels.set(rgb, (y * width + x) * 3);
        }
      }
      return pixels;
    };
    const CYAN = [55, 180, 195];
    const WHITE = [250, 250, 250];
    const BLACK = [5, 5, 5];
    const crops = new Map<string, Uint8Array>([
      ["0.5", crop(CYAN, WHITE, BLACK)],
      ["1.5", crop(CYAN, WHITE, BLACK)],
      ["2.5", crop(CYAN, WHITE, BLACK)],
      ["3.5", crop(WHITE, BLACK, null)],
      ["4.5", new Uint8Array(width * height * 3).fill(100)],
    ]);
    const counted = countCaptionLooks(
      [
        // AIは白い字幕を多く挙げたが、実際は水色の字幕の方が多い
        { color: "#FFFFFF", edge: "#000000", seconds: 3.5, appearsAt: [0.5, 1.5, 3.5] },
        { color: "#30B0C0", edge: "#FFFFFF", seconds: 0.5, appearsAt: [0.5, 2.5] },
        // 水色の字幕の、文字と縁を入れ替えて答えた物(同じ見た目)
        { color: "#FFFFFF", edge: "#30B0C0", seconds: 1.5, appearsAt: [1.5] },
      ],
      crops,
      width,
      height
    );
    expect(counted.map((entry) => entry.count)).toEqual([1, 3, 0]);
    expect(counted[1].color).toBe("#37B4C3");
  });

  it("カードの中の名前の高さを、カードの下半分の文字の画素から測る", () => {
    // 白いカード(縦20〜80)の縁は灰色。下の方(縦70〜74)に黒い名前の文字、上の方に絵(赤)
    const width = 50;
    const height = 100;
    const pixels = new Uint8Array(width * height * 3).fill(90);
    for (let y = 20; y < 80; y++) {
      for (let x = 5; x < 45; x++) {
        const border = x < 7 || x >= 43 || y < 22 || y >= 78;
        const name = y >= 70 && y < 74 && x >= 15 && x < 35 && x % 3 !== 0;
        const picture = y >= 25 && y < 60 && x >= 10 && x < 40;
        pixels.set(border ? [200, 200, 200] : name ? [2, 2, 2] : picture ? [220, 40, 40] : [255, 255, 255], (y * width + x) * 3);
      }
    }
    expect(measureNameCenter(pixels, width, height, { xPercent: 50, yPercent: 50, widthPercent: 80, heightPercent: 60 }, "#020202")).toBe(72);
  });

  it("文字の周りの光は、実際にあって文字・縁取りと違う色の時だけ残す", () => {
    const measured: [number, number, number][] = [[240, 240, 240], [24, 72, 160], [10, 10, 10]];
    // 文字の色(ほぼ白)と同じような白い光は、無い物として外す
    expect(keepGlow("#FFFFFF", measured, ["#DCDEDF", "#1848A0", null])).toBeNull();
    // 実際にある黒い影は残す
    expect(keepGlow("#000000", measured, ["#F0F0F0", "#1848A0", null])).toBe("#0A0A0A");
    // その所に無い色の光は外す
    expect(keepGlow("#FFFF00", measured, ["#F0F0F0", "#1848A0", null])).toBeNull();
  });

  it("文字の色と縁取りの色が入れ替わっていたら見分ける(縁取りが文字を囲んでいる)", () => {
    // 灰色の背景に、白い縁(太さ4)に囲まれた水色の太い線(縦横に2本)
    const width = 60;
    const height = 40;
    const pixels = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const inBar = (x >= 10 && x < 50 && y >= 16 && y < 24) || (x >= 26 && x < 34 && y >= 6 && y < 34);
        const nearBar = (x >= 6 && x < 54 && y >= 12 && y < 28) || (x >= 22 && x < 38 && y >= 2 && y < 38);
        pixels.set(inBar ? [60, 170, 190] : nearBar ? [250, 250, 250] : [90, 90, 90], (y * width + x) * 3);
      }
    }
    const box = { xPercent: 50, yPercent: 50, widthPercent: 100, heightPercent: 100 };
    expect(strokeLooksSwapped(pixels, width, height, box, "#3CAABE", "#FAFAFA")).toBe(false);
    expect(strokeLooksSwapped(pixels, width, height, box, "#FAFAFA", "#3CAABE")).toBe(true);
  });

  it("縁の外側に文字と同じ色の細い縁がある時も、線の真ん中の色を文字の色とする", () => {
    // 灰色の背景に、白い線(太さ8)・青い縁(太さ4)・外側の白い細い縁(太さ1)
    const width = 70;
    const height = 50;
    const pixels = new Uint8Array(width * height * 3);
    const bar = (x: number, y: number, grow: number) =>
      (x >= 15 - grow && x < 55 + grow && y >= 21 - grow && y < 29 + grow) || (x >= 31 - grow && x < 39 + grow && y >= 9 - grow && y < 41 + grow);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const rgb = bar(x, y, 0) ? [250, 250, 250] : bar(x, y, 4) ? [20, 70, 160] : bar(x, y, 5) ? [250, 250, 250] : [90, 90, 90];
        pixels.set(rgb, (y * width + x) * 3);
      }
    }
    const box = { xPercent: 50, yPercent: 50, widthPercent: 100, heightPercent: 100 };
    expect(strokeLooksSwapped(pixels, width, height, box, "#1446A0", "#FAFAFA")).toBe(true);
    expect(strokeLooksSwapped(pixels, width, height, box, "#FAFAFA", "#1446A0")).toBe(false);
  });

  it("読み取った答えを型にする(下に比べるカードがある時は、字幕の下の端を固定する)", () => {
    const look = { fontFamily: "Noto Sans JP" as const, color: "#ffffff", strokeColor: "#000000", bandColor: null, glowColor: null, seconds: 3, box: { xPercent: 50, yPercent: 50, widthPercent: 50, heightPercent: 5 } };
    const raw: ExtractedTemplate = {
      kind: "compare",
      face: { xPercent: 50, yPercent: 33, heightPercent: 15 },
      caption: { topPercent: 45, xPercent: 50, maxWidthPercent: 90, charHeightPercent: 3.2, style: "outline", look, lines: 1 },
      emphasisStyles: [],
      title: { align: "center", xPercent: 31, yPercent: 12, charHeightPercent: 2.6, maxWidthPercent: 50, lines: [look, look], wording: "1行目に話題、2行目に問いかけ", band: null, intro: null },
      frames: null,
      compare: {
        yPercent: 71,
        heightPercent: 22,
        leftPercent: 7.5,
        rightPercent: 92.5,
        gapPercent: 3,
        borderColor: "#a8a8a8",
        borderWidthPx: 6,
        fillColor: "#ffffff",
        cornerRadiusPx: 0,
        content: "image",
        name: { look, charHeightPercent: 3, fromBottomPercent: 3.2 },
        contentText: null,
        topic: { xPercent: 50, yPercent: 55.7, charHeightPercent: 2.8, look },
        marker: { color: "#e00000", strokeWidthPx: 10, when: "選ばれた方の名前を言った時" },
      },
      cta: null,
      note: "",
    };
    const template = toReferenceTemplate(raw, { name: "見た目の手本", referenceIds: ["c"] });
    expect(template.kind).toBe("compare");
    expect(template.caption.bottomPercent).toBeDefined();
    expect(template.caption.bottomPercent!).toBeLessThan(55.7);
    expect(template.title.lineCount).toBe(2);
    expect(template.compare?.marker?.color).toBe("#E00000");
    expect(template.emphasisStyles.length).toBeGreaterThan(0);
  });
});
