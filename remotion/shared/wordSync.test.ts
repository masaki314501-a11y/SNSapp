import { describe, expect, it } from "vitest";
import { currentPhraseRange } from "./wordSync";

describe("currentPhraseRange", () => {
  const text = "今日は歯並びのランキングを紹介します";

  it("話し始める前はnull、話している間は言葉のかたまりが順に進み、最後は全文の終わりまで届く", () => {
    const spans: [number, number][] = [[0.5, 2.5]];
    expect(currentPhraseRange(text, spans, 3, 0.2)).toBeNull();
    const early = currentPhraseRange(text, spans, 3, 0.6)!;
    const late = currentPhraseRange(text, spans, 3, 2.4)!;
    expect(early.start).toBe(0);
    expect(late.start).toBeGreaterThan(early.start);
    expect(late.end).toBe(text.length);
  });

  it("間(話していない所)では言葉が進まない", () => {
    const spans: [number, number][] = [
      [0, 1],
      [2, 3],
    ];
    expect(currentPhraseRange(text, spans, 3, 1.1)).toEqual(currentPhraseRange(text, spans, 3, 1.9));
  });

  it("話している区間が分からない時は、クリップの長さで割り振る", () => {
    expect(currentPhraseRange(text, [], 3, 0)!.start).toBe(0);
    expect(currentPhraseRange(text, [], 3, 2.9)!.end).toBe(text.length);
  });
});
