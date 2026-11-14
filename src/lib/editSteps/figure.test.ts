import { describe, expect, it } from "vitest";
import type { ProjectSegment } from "@/lib/videoProject";
import { figureArea, figureImageColors, figureViewBoxHeight, isFigureImage, placeFigure, sanitizeSvgFragment, type FigureDraft } from "./figure";

const seg = (start: number, end: number, key: string) =>
  ({ key, startFromSeconds: start, durationInSeconds: end - start, caption: key }) as unknown as ProjectSegment;

describe("AIが描いた図", () => {
  it("SVGは絵を描く要素と属性だけ残し、スクリプト・読み込み・文字は捨てる", () => {
    const svg = sanitizeSvgFragment(
      '<script>alert(1)</script><g onclick="x()"><circle cx="500" cy="200" r="150" fill="#FF3366"/><text x="1">あ</text>' +
        '<image href="https://example.com/a.png"/><rect x="0" y="0" width="10" height="10" fill="url(#g)" stroke="#000000"/></g>'
    );
    expect(svg).toBe('<g><circle cx="500" cy="200" r="150" fill="#FF3366"/><rect x="0" y="0" width="10" height="10" stroke="#000000"/></g>');
  });

  it("閉じ忘れたgは閉じ、開いていない閉じタグは捨てる", () => {
    expect(sanitizeSvgFragment('</g><g><path d="M0 0 L10 10"></path>')).toBe('<g><path d="M0 0 L10 10"/></g>');
  });

  it("字幕が顎の下にあれば、字幕の下の空いた所に置く", () => {
    const box = figureArea({ captionTopPercent: 45, captionBottomPercent: 52, faceBottomPercent: 40 });
    expect(box).not.toBeNull();
    expect(box!.yPercent - box!.heightPercent / 2).toBeCloseTo(54, 5);
    expect(box!.yPercent + box!.heightPercent / 2).toBeLessThanOrEqual(77.01);
    expect(box!.xPercent - box!.widthPercent / 2).toBeGreaterThanOrEqual(7);
    expect(box!.xPercent + box!.widthPercent / 2).toBeLessThanOrEqual(86);
  });

  it("字幕が画面の下なら、顔と字幕の間に置き、狭すぎれば置かない", () => {
    const box = figureArea({ captionTopPercent: 82, faceBottomPercent: 45 });
    expect(box!.yPercent - box!.heightPercent / 2).toBeGreaterThanOrEqual(46);
    expect(box!.yPercent + box!.heightPercent / 2).toBeLessThanOrEqual(77.01);
    expect(figureArea({ captionTopPercent: 70, faceBottomPercent: 62 })).toBeNull();
  });

  it("土台は最初の部品と一緒に、部品はその話を始めるクリップから出し、場面を外したら時刻を合わせ直す", () => {
    const box = { xPercent: 46.5, yPercent: 65, widthPercent: 79, heightPercent: 20 };
    const figure: FigureDraft = {
      box,
      viewBoxHeight: figureViewBoxHeight(box),
      idea: "職業の割合の円グラフ",
      base: { svg: '<circle cx="500" cy="240" r="200" fill="#FFFFFF" stroke="#20B2AA"/>', texts: [] },
      parts: [
        { key: "b", sourceSeconds: 2, label: "学生40%", svg: '<path d="M500 240 L500 40 A200 200 0 0 1 690 302 Z" fill="#20B2AA"/>', texts: [{ text: "学生 40%", x: 650, y: 150, size: 50, color: "#000000", strokeColor: null }] },
      ],
    };
    const placed = placeFigure({ segments: [seg(0, 2, "a"), seg(2, 5, "b")], figure });
    expect(placed.figureImages.map((image) => image.startOffsetSeconds)).toEqual([2, 2]);
    expect(placed.figureImages.every((image) => isFigureImage(image.src))).toBe(true);
    expect(placed.figureTexts.map((text) => [text.text, text.startOffsetSeconds])).toEqual([["学生 40%", 2]]);
    // 文字は図の座標から画面の%へ(横650/1000 → 箱の左7% + 79%×0.65)
    expect(placed.figureTexts[0].xPercent).toBeCloseTo(7 + 79 * 0.65, 1);
    expect(figureImageColors(placed.figureImages[1].src)).toEqual(["#20B2AA"]);
    const again = placeFigure({ ...placed, segments: [seg(2, 5, "b")] });
    expect(again.figureImages.map((image) => image.startOffsetSeconds)).toEqual([0, 0]);
  });

  it("同じ場所に後から次の文字が出たら、前の文字はそこで消す(別の場所の文字は残す)", () => {
    const box = { xPercent: 46.5, yPercent: 65, widthPercent: 79, heightPercent: 20 };
    const score = (key: string, sourceSeconds: number, text: string, x: number) => ({
      key, sourceSeconds, label: text, svg: "", texts: [{ text, x, y: 100, size: 60, color: "#000000", strokeColor: null }],
    });
    const figure: FigureDraft = {
      box,
      viewBoxHeight: figureViewBoxHeight(box),
      idea: "採点表",
      base: { svg: '<rect x="0" y="0" width="300" height="200" fill="#FFFFFF"/>', texts: [{ text: "白さ", x: 150, y: 30, size: 40, color: "#000000", strokeColor: null }] },
      parts: [score("a", 0, "20", 150), score("b", 2, "10", 500), score("c", 5, "15", 152)],
    };
    const placed = placeFigure({ segments: [seg(0, 2, "a"), seg(2, 5, "b"), seg(5, 9, "c")], figure });
    const byText = Object.fromEntries(placed.figureTexts.map((text) => [text.text, text.durationInSeconds]));
    expect(byText).toEqual({ 白さ: undefined, "20": 5, "10": undefined, "15": undefined });
  });

  it("図が無ければ、何も置かない", () => {
    expect(placeFigure({ segments: [], figure: null })).toMatchObject({ figureImages: [], figureTexts: [] });
  });
});
