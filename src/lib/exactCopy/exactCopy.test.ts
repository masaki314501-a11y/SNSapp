import { describe, expect, it } from "vitest";
import { CAPTION_SURVEY_PROMPT, LOOK_CHECK_PROMPT, TEMPLATE_EXTRACT_PROMPT, innerColorSays } from "./extract";
import { LIBRARY_PICK_PROMPT, TEMPLATE_OBJECTS_NOTE } from "./ai";

/** 試しに使っている手本・動画の中身(完全模倣の指示文に入れると、答えのヒントになる言葉)。 */
const LEAKS = ["水色", "白い字を青い", "表側と裏側", "国旗", "口元", "〇〇ランキング", "選ばれた方の名前", "締めの案内"];

describe("完全模倣 EC-1.1", () => {
  it("指示文の例に、手本や試しの動画の中身を入れない", () => {
    const prompts = [
      TEMPLATE_EXTRACT_PROMPT([0.5]),
      LOOK_CHECK_PROMPT([{ id: "caption", what: "ふつうの字幕" }]),
      CAPTION_SURVEY_PROMPT([1]),
      TEMPLATE_OBJECTS_NOTE({ titleLines: 2, kind: "compare", hasCta: true }),
      LIBRARY_PICK_PROMPT(["a"], [{ name: "n", description: "d" }]),
    ].join("\n");
    for (const word of LEAKS) expect(prompts).not.toContain(word);
  });
});

describe("完全模倣 EC-2 手本の出来事", () => {
  it("人の映っている所が大きく変わった秒を、切り替わりとして拾う(0.3秒以内の続きは1回)", async () => {
    const { changeTimes } = await import("./events");
    const dark = new Uint8Array(4 * 10).fill(0);
    const light = new Uint8Array(4 * 10).fill(200);
    expect(changeTimes([dark, dark, light, dark, dark, dark, dark, light], 4, 10, 10)).toEqual([0.2, 0.7]);
  });
});

describe("完全模倣 EC-3 当てはめ", () => {
  it("AIの答えを使える形に直す(番号・強調の種類・寄りの強さ・音)", async () => {
    const { toRows } = await import("./imitate");
    const rows = toRows(
      [
        { index: 1, emphasis: 2, animation: "pop", zoom: 1.15, sfx: "pop" },
        { index: 2, emphasis: 0, animation: "fade", zoom: 0, sfx: "" },
        { index: 9, emphasis: 1, animation: "pop", zoom: 3, sfx: "pop" },
        { index: 3, emphasis: 5, animation: "pop", zoom: 3, sfx: "なぞの音" },
      ],
      3,
      2,
      new Set(["pop"])
    );
    expect(rows).toEqual([
      { index: 0, emphasis: 1, animation: "pop", zoom: 1.15, sfx: "pop", copyOf: null },
      { index: 1, emphasis: null, animation: "fade", zoom: null, sfx: null, copyOf: null },
      { index: 2, emphasis: null, animation: "pop", zoom: 1.5, sfx: null, copyOf: null },
    ]);
  });

  it("手本の字幕の長さの上限は、短い順に並べた8割の所", async () => {
    const { captionLimitOf } = await import("./imitate");
    const event = (text: string) => ({ seconds: 0, kind: "caption" as const, spoken: "", trigger: "", text, look: "", motion: "", scale: null, sound: "", textColor: null, strokeColor: null });
    const texts = ["あいうえおかき", "あいうえおかきく", "あいうえおかきくけ", "あいうえおかきくけこ", "あいうえおかきくけこさしす"];
    expect(captionLimitOf({ seconds: 10, measuredChanges: [], events: texts.map(event), rules: { emphasis: "", captions: "", zoom: "", sfx: "", objects: "" } })).toBe(13);
  });
});

describe("完全模倣 EC-7 先生の映り方", () => {
  it("顔の大きさも位置も手本と同じなら拡大しない(今までのように必ず1.15倍にはしない)", async () => {
    const { framingExact } = await import("./objects");
    expect(framingExact({ xPercent: 50, yPercent: 30, heightPercent: 20 }, { xPercent: 50, yPercent: 30, heightPercent: 20 })).toBeNull();
  });
  it("顔が手本の半分の大きさなら、2倍に拡大して顔を手本の位置に置く", async () => {
    const { framingExact } = await import("./objects");
    const f = framingExact({ xPercent: 50, yPercent: 40, heightPercent: 10 }, { xPercent: 50, yPercent: 30, heightPercent: 20 })!;
    expect(f.scale).toBe(2);
    expect(f.focusYPercent + (40 - f.focusYPercent) * f.scale).toBeCloseTo(30, 1);
  });
});

describe("完全模倣 E44 字の中と縁の色", () => {
  // 灰色の背景に、細い白の外線・太い青の縁・白い字の中、の3重の「字」(太い棒)を描く
  const draw = (inner: number[], edge: number[], outer: number[]) => {
    const width = 100;
    const height = 100;
    const pixels = new Uint8Array(width * height * 3).fill(90);
    const paint = (x0: number, y0: number, x1: number, y1: number, rgb: number[]) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) pixels.set(rgb, (y * width + x) * 3);
    };
    paint(20, 30, 80, 70, outer);
    paint(22, 32, 78, 68, edge);
    paint(28, 38, 72, 62, inner);
    return { pixels, width, height };
  };
  const box = { xPercent: 50, yPercent: 50, widthPercent: 70, heightPercent: 50 };
  const white = [251, 253, 251];
  const blue = [10, 91, 197];
  it("縁が字の中より太くても、内側にある白を字の中の色とする", () => {
    const { pixels, width, height } = draw(white, blue, white);
    expect(innerColorSays(pixels, width, height, box, "#0A5BC5", "#FBFDFB")).toBe("swap");
    expect(innerColorSays(pixels, width, height, box, "#FBFDFB", "#0A5BC5")).toBe("as-is");
  });
  it("2色が同じに近い時は決めない", () => {
    const { pixels, width, height } = draw(white, blue, white);
    expect(innerColorSays(pixels, width, height, box, "#FBFDFB", "#F0F0F0")).toBeNull();
  });
});
