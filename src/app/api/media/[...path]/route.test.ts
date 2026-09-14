import { describe, expect, it } from "vitest";
import { isValidPathSegment } from "./route";

describe("isValidPathSegment", () => {
  it.each(["24e13241-f565-42e7-99e5-124871396d84.mp4", "generated", "sfx", "tap.mp3", "a..b"])(
    "通常のファイル名/ディレクトリ名 %s は許可する",
    (segment) => {
      expect(isValidPathSegment(segment)).toBe(true);
    }
  );

  it.each([".", "..", "", "a/b", "a\\b", "a\0b"])(
    "パストラバーサルにつながりうる値 %s は拒否する",
    (segment) => {
      expect(isValidPathSegment(segment)).toBe(false);
    }
  );
});
