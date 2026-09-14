import { describe, expect, it } from "vitest";
import { graphemeLength, truncateNaturally } from "./textUtils";

describe("graphemeLength", () => {
  it("通常の文字列はJS文字列lengthと一致する", () => {
    expect(graphemeLength("hello")).toBe(5);
  });

  it("サロゲートペア(絵文字)は1文字として数える", () => {
    // "😀".length は2(UTF-16コードユニット数)だが、書記素としては1文字。
    expect("😀".length).toBe(2);
    expect(graphemeLength("😀")).toBe(1);
  });
});

describe("truncateNaturally", () => {
  it("上限以下の文字列はそのまま返す", () => {
    expect(truncateNaturally("短い文", 10)).toBe("短い文");
  });

  it("区切り文字が許容範囲内にあれば、その直後で切る", () => {
    // chars: A B C D E F G 。 H I J K L (13文字)、maxChars=10
    // 探索範囲(index 9〜7)の中で index7の「。」が見つかる
    const text = "ABCDEFG。HIJKL";
    expect(truncateNaturally(text, 10)).toBe("ABCDEFG。");
  });

  it("区切り文字が見つからなければ上限文字数でそのまま切る", () => {
    const text = "ABCDEFGHIJKLM";
    expect(truncateNaturally(text, 10)).toBe("ABCDEFGHIJ");
  });
});
