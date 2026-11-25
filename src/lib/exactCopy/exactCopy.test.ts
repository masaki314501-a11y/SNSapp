import { describe, expect, it } from "vitest";
import { CAPTION_SURVEY_PROMPT, LOOK_CHECK_PROMPT, TEMPLATE_EXTRACT_PROMPT, groupSeenCaptions, innerColorSays, sameCaption, type SeenCaption } from "./extract";
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

describe("完全模倣 E44 測った所の字幕が同じ物か", () => {
  it("読み違い・空白があっても、同じ字幕は同じとみなす", () => {
    expect(sameCaption("上下裏側(フルリンガル)", "上下裏側 (フルリンガル)")).toBe(true);
    expect(sameCaption("完全オーダーメイ", "完全オーダーメイド")).toBe(true);
  });
  it("別の字幕は別とみなす", () => {
    expect(sameCaption("カウンセリングは無料ですか？", "プロフィールリンクからご予約ください！")).toBe(false);
  });
});

describe("完全模倣 E40 1秒ごとに測った字幕を見た目でまとめる", () => {
  const seen = (seconds: number, fill: string, edge: string | null, extra: Partial<SeenCaption["look"]> = {}, oriented = true): SeenCaption => ({
    seconds,
    text: `字幕${seconds}`,
    role: "",
    look: { fontFamily: "Noto Sans JP", color: fill, strokeColor: edge, bandColor: null, glowColor: null, ...extra },
    box: { xPercent: 50, yPercent: 50, widthPercent: 80, heightPercent: 30 },
    fill,
    edge,
    measured: true,
    oriented,
  });
  it("明朝で光のある字幕は、色が近くてもゴシックの縁取りと別にする", () => {
    const groups = groupSeenCaptions([seen(1, "#FFFFFF", "#1060D0"), seen(2, "#FFFFFF", "#1262CC"), seen(3, "#FFFFFF", "#1060D0", { fontFamily: "Noto Serif JP", glowColor: "#F0E060" })]);
    expect(groups.map((g) => g.length)).toEqual([2, 1]);
  });
  it("字の中と縁の色が逆の字幕は、どちらも向きが分かっていれば別にする", () => {
    expect(groupSeenCaptions([seen(1, "#FFFFFF", "#1060D0"), seen(2, "#1060D0", "#FFFFFF")])).toHaveLength(2);
    expect(groupSeenCaptions([seen(1, "#FFFFFF", "#1060D0"), seen(2, "#1060D0", "#FFFFFF", {}, false)])).toHaveLength(1);
  });
});

describe("完全模倣 A3 最後の一言の間は字幕・見出しを出さない", () => {
  it("最後の一言にかかる字幕からあとを消し、見出し・丸は最後の一言の所で終える", async () => {
    const { clearUnderCta } = await import("./objects");
    const { TEMPLATE_FILL_TAG } = await import("@/lib/editSteps/template");
    const seg = (key: string, seconds: number, caption: string) => ({ key, durationInSeconds: seconds, caption }) as never;
    const text = (t: string, start: number, extra = {}) => ({ text: t, startOffsetSeconds: start, tag: TEMPLATE_FILL_TAG, ...extra }) as never;
    const state = {
      segments: [seg("a", 4, "はじめ"), seg("b", 4, "途中"), seg("c", 3, "最後の字幕")],
      globalOverlays: [text("仕上がり", 2, { color: "#020202", yPercent: 55 }), text("ご予約は", 6.1, { color: "#3FB7F6", yPercent: 50 }), { text: "タイトル" } as never],
      templateImages: [],
      templateShapes: [{ startOffsetSeconds: 1 } as never],
    } as never;
    const template = { cta: { seconds: 5, yPercent: 50, look: { color: "#3fb7f6" } }, compare: { topic: { yPercent: 55 } } } as never;
    const result = clearUnderCta(state, template, 11) as unknown as {
      segments: { caption: string }[];
      globalOverlays: { text: string; startOffsetSeconds?: number; durationInSeconds?: number }[];
      templateShapes: { durationInSeconds?: number }[];
    };
    expect(result.segments.map((s) => s.caption)).toEqual(["はじめ", "", ""]);
    expect(result.globalOverlays.find((o) => o.text === "ご予約は")).toMatchObject({ startOffsetSeconds: 6.1, durationInSeconds: 4.9 });
    expect(result.globalOverlays.find((o) => o.text === "仕上がり")).toMatchObject({ durationInSeconds: 4.1 });
    expect(result.globalOverlays.find((o) => o.text === "タイトル")).toEqual({ text: "タイトル" });
    expect(result.globalOverlays).toHaveLength(3);
    expect(result.templateShapes[0]).toMatchObject({ durationInSeconds: 5.1 });
  });
});

describe("完全模倣 B8 同じ画角が長く続く所に寄りを入れる", () => {
  it("手本のいちばん長い秒数を、測った切り替わりの間から出す", async () => {
    const { longestShotOf } = await import("./imitate");
    expect(longestShotOf([1.8, 8.4, 10.3, 13])).toBeCloseTo(6.6);
    expect(longestShotOf([1])).toBeNull();
  });
  it("寄りの無いまま上限を超える所に、ほかの寄りと同じ強さで寄る", async () => {
    const { breakLongShots } = await import("./imitate");
    const seg = (caption: string, zoom?: number) => ({ key: caption, caption, durationInSeconds: 3, ...(zoom ? { zoom: { scale: zoom, style: "punch" } } : {}) }) as never;
    const out = breakLongShots([seg("a", 1.2), seg("b"), seg("c"), seg("d"), seg("e"), seg("f")], 6.9, 1.15) as unknown as { zoom?: { scale: number } }[];
    expect(out.map((s) => s.zoom?.scale ?? 0)).toEqual([1.2, 0, 0, 1.2, 0, 0]);
  });
});

describe("完全模倣 A3・J91・J92 締めの段", () => {
  it("手本の段の順番・長さで終わりに並べ、最後の段にこの動画の最後の一言を入れる", async () => {
    const { placeCtaStages, CTA_STAGE_TAG } = await import("./objects");
    const look = (color: string) => ({ color, fontFamily: "Noto Sans JP" });
    const template = {
      cta: { xPercent: 50, yPercent: 50, fontSizePx: 80, maxWidthPercent: 90, seconds: 4, look: look("#FBFCFB") },
      ctaStages: [
        { text: "カウンセリングは\n無料ですか？", look: look("#010101"), yPercent: 50, seconds: 1.5 },
        { text: "カウンセリングは\n無料実施中！", look: look("#FBFCFB"), yPercent: 50, seconds: 0.7 },
        { text: "プロフィールリンクから\nご予約ください！", look: look("#3FB7F6"), yPercent: 49, seconds: 3.2 },
      ],
    } as never;
    const state = { segments: [], globalOverlays: [{ text: "古い一言", tag: "template-fill", startOffsetSeconds: 16, color: "#FBFCFB", yPercent: 50 }] } as never;
    const out = placeCtaStages(state, template, 20, "ご予約は\nプロフィールから！") as unknown as { globalOverlays: { text: string; startOffsetSeconds: number; durationInSeconds: number; tag?: string }[] };
    const stages = out.globalOverlays.filter((o) => o.tag === CTA_STAGE_TAG);
    expect(out.globalOverlays.some((o) => o.text === "古い一言")).toBe(false);
    expect(stages.map((o) => [o.text, o.startOffsetSeconds])).toEqual([
      ["カウンセリングは", 14.6],
      ["無料ですか？", 14.6],
      ["カウンセリングは", 16.1],
      ["無料実施中！", 16.1],
      ["ご予約は", 16.8],
      ["プロフィールから！", 16.8],
    ]);
    expect(stages.at(-1)?.durationInSeconds).toBe(3.2);
  });
});

describe("完全模倣 C13 寄りの倍率を画面から測る", () => {
  it("寄った所(1.04〜1.4倍)の真ん中の値を使い、引いた所・切り替わりは数えない", async () => {
    const { zoomScaleOf } = await import("./measureZoom");
    expect(zoomScaleOf([1.126, 0.903, 1.114, 0.921, 1.145, 0.836, 1.09, 1.011, 1.271, 0.773, 1.115, 0.899])).toBe(1.13);
    expect(zoomScaleOf([0.9, 1.01])).toBeNull();
  });
});

describe("完全模倣 締めの段の行", () => {
  it("改行が無く1行に収まらない時は、真ん中に近い助詞の後ろで2行に分ける", async () => {
    const { linesOf } = await import("./objects");
    const tooLong = () => false;
    expect(linesOf("カウンセリングは無料ですか?", tooLong)).toEqual(["カウンセリングは", "無料ですか?"]);
    expect(linesOf("プロフィールリンクからご予約ください!", tooLong)).toEqual(["プロフィールリンクから", "ご予約ください!"]);
    expect(linesOf("ご予約は\nプロフィールから!", tooLong)).toEqual(["ご予約は", "プロフィールから!"]);
    expect(linesOf("短い", () => true)).toEqual(["短い"]);
  });
});

describe("完全模倣 グループ2 出る時の動きを測る", () => {
  it("手本の3つの出方(ぱっと・弾む拡大・ぼかし)を見分ける", async () => {
    const { motionOf } = await import("./measureMotion");
    const f = (count: number, spread: number) => ({ count, spread });
    // ふつうの字幕: 0.1秒で全部出る
    expect(motionOf([f(0, 0), f(0, 0), f(1000, 0.8), f(1000, 0.8), f(1000, 0.8)])).toBe("none");
    // 黄色い強調(手本の実測): 8.4秒から 0.24→0.81→0.66→0.74→0.78
    expect(motionOf([f(0, 0), f(100, 0.24), f(4544, 0.81), f(2765, 0.66), f(3710, 0.74), f(4303, 0.78), f(4300, 0.78)])).toBe("pop");
    // 青い光の強調(手本の実測): 前の字幕の白 → ぼやけた白が広がって増え、続けて減ってくっきり
    expect(motionOf([f(5932, 0.82), f(5999, 0.61), f(14185, 0.76), f(21726, 0.89), f(18866, 0.89), f(14154, 0.89), f(6678, 0.88), f(5436, 0.88), f(5476, 0.88)])).toBe("blur-in");
    // 長い字幕から短い字幕へ、いきなり替わる
    expect(motionOf([f(9000, 0.9), f(9000, 0.9), f(5000, 0.82), f(5000, 0.82)])).toBe("none");
    expect(motionOf([f(0, 0), f(10, 0)])).toBeNull();
  });
});
