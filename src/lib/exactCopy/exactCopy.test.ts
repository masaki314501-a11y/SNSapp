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
