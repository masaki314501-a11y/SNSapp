import { describe, expect, it } from "vitest";
import { CAPTION_SURVEY_PROMPT, LOOK_CHECK_PROMPT, TEMPLATE_EXTRACT_PROMPT } from "./extract";
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
      { index: 0, emphasis: 1, animation: "pop", zoom: 1.15, sfx: "pop" },
      { index: 1, emphasis: null, animation: "fade", zoom: null, sfx: null },
      { index: 2, emphasis: null, animation: "pop", zoom: 1.5, sfx: null },
    ]);
  });

  it("手本の字幕の長さの上限は、短い順に並べた8割の所", async () => {
    const { captionLimitOf } = await import("./imitate");
    const event = (text: string) => ({ seconds: 0, kind: "caption" as const, spoken: "", trigger: "", text, look: "", motion: "", scale: null, sound: "" });
    const texts = ["あいうえおかき", "あいうえおかきく", "あいうえおかきくけ", "あいうえおかきくけこ", "あいうえおかきくけこさしす"];
    expect(captionLimitOf({ seconds: 10, measuredChanges: [], events: texts.map(event), rules: { emphasis: "", captions: "", zoom: "", sfx: "", objects: "" } })).toBe(13);
  });
});
