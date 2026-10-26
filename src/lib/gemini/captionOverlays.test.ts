import { describe, expect, it } from "vitest";
import type { RawAutoEditPlan } from "./autoEditTypes";
import { isCaptionLike, removeCaptionLikeOverlays, separateCaptionsInBreakdown } from "./captionOverlays";

const plan = (clips: RawAutoEditPlan["clips"]): RawAutoEditPlan => ({ summary: "", theme: null, clips });

describe("isCaptionLike", () => {
  it("話している言葉をそのまま・少し縮めて出した文字は字幕とみなす", () => {
    expect(isCaptionLike("韓国の方が安い", "えー価格は韓国の方が安いですね")).toBe(true);
    expect(isCaptionLike("少しだけ\n歯を削る", "ラミネートは少しだけ歯を削るんですよ")).toBe(true);
  });
  it("短い見出し・話に無い文字は字幕とみなさない", () => {
    expect(isCaptionLike("価格", "価格は韓国の方が安い")).toBe(false);
    expect(isCaptionLike("実は3倍!", "韓国の方が安いですね")).toBe(false);
  });
});

describe("removeCaptionLikeOverlays", () => {
  it("字幕と同じ文言の大きい文字だけを外し、小さいラベル・最後まで残す物は残す", () => {
    const { plan: cleaned, removed } = removeCaptionLikeOverlays(
      plan([
        {
          sourceStartSeconds: 0,
          sourceEndSeconds: 3,
          speech: "槇原敬之さんの歯どうにかできますか",
          overlays: [
            { text: "歯どうにかできますか", fontSizePx: 80 },
            { text: "槇原敬之さん", fontSizePx: 30 },
            { text: "どうにかできますか", fontSizePx: 80, keepUntilEnd: true },
            { text: "価格", fontSizePx: 80 },
          ],
        },
      ])
    );
    expect(removed).toBe(1);
    expect(cleaned.clips[0].overlays?.map((o) => o.text)).toEqual(["槇原敬之さん", "どうにかできますか", "価格"]);
  });
});

describe("separateCaptionsInBreakdown", () => {
  it("字幕を強調テキストとして書いた書き起こしを、字幕ありに直し、位置も決める", () => {
    const clips = ["少しだけ歯を削る", "白さは満点です", "費用は平均くらい"].map((speech, i) => ({
      sourceStartSeconds: i * 2,
      sourceEndSeconds: i * 2 + 2,
      speech,
      overlays: [{ text: speech, fontSizePx: 70, yPercent: 50 }],
    }));
    const fixed = separateCaptionsInBreakdown({ ...plan(clips), showCaptions: false });
    expect(fixed.showCaptions).toBe(true);
    expect(fixed.theme?.captionPosition).toBe("middle");
    expect(fixed.clips.every((clip) => (clip.overlays ?? []).length === 0)).toBe(true);
  });
});
