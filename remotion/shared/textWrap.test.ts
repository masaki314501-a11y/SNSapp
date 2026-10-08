import { describe, expect, it } from "vitest";
import { breakIntoLines } from "./textWrap";

describe("breakIntoLines", () => {
  it("収まる文はそのまま1行", () => {
    expect(breakIntoLines("日本の方が安い", 80, 984)).toEqual(["日本の方が安い"]);
  });

  it("長い文は文節の切れ目で、長さのそろった行に分ける(言葉の途中で切らない)", () => {
    const lines = breakIntoLines("韓国の先生を全員知っているわけじゃないから", 74, 984);
    expect(lines.length).toBe(2);
    expect(lines.join("")).toBe("韓国の先生を全員知っているわけじゃないから");
    expect(lines.some((line) => /^[っているわけじゃないから]/.test(line) && line.startsWith("っ"))).toBe(false);
    expect(lines[1].startsWith("知っている")).toBe(true);
  });

  it("明示した改行は守り、行頭に句読点・小さい仮名を置かない", () => {
    const lines = breakIntoLines("歯のお悩みがある方は\nプロフィールのリンクからご予約をお願いします！", 74, 984);
    expect(lines[0]).toBe("歯のお悩みがある方は");
    expect(lines.length).toBe(3);
    for (const line of lines) expect(/^[、。！ーっ]/.test(line)).toBe(false);
  });

  it("強調する語は途中で切らない", () => {
    const lines = breakIntoLines("当院ではマウスピース矯正の保証期間が5年あります", 74, 700, ["保証期間が5年"], 1.25);
    expect(lines.some((line) => line.includes("保証期間が5年"))).toBe(true);
  });
});
