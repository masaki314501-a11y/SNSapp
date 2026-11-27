import { describe, expect, it } from "vitest";
import type { ProjectSegment } from "@/lib/videoProject";
import { EMPHASIS_SFX, fallbackEmphasisPicks, placeSfx, TEAM_SFX, type SfxEvent } from "./sfxPlan";

const seg = (key: string, seconds: number): ProjectSegment => ({ key, durationInSeconds: seconds, caption: key } as unknown as ProjectSegment);
const segments = Array.from({ length: 12 }, (_, i) => seg(`s${i}`, 1));
const ev = (segmentIndex: number, kind: SfxEvent["kind"]): SfxEvent => ({ seconds: segmentIndex, kind, text: "", segmentIndex });

describe("工程11の効果音の置き方", () => {
  it("見出し・項目は毎回同じ音、強調はAIが選んだ物だけ・選んだ音", () => {
    const events = [ev(0, "冒頭"), ev(2, "見出し"), ev(4, "強調"), ev(6, "項目"), ev(8, "強調"), ev(10, "締め")];
    const result = placeSfx(segments, events, [{ index: 1, sound: 3 }]);
    expect(result[0].emphasisSfxPresetId).toBe(TEAM_SFX.step);
    expect(result[2].emphasisSfxPresetId).toBe(TEAM_SFX.step);
    expect(result[6].emphasisSfxPresetId).toBe(TEAM_SFX.step);
    expect(result[4].emphasisSfxPresetId).toBeUndefined();
    expect(result[8].emphasisSfxPresetId).toBe(EMPHASIS_SFX[2].id);
    expect(result[10].emphasisSfxPresetId).toBe(TEAM_SFX.ending);
  });

  it("同じクリップに重なったら優先の高い方(印は強調より先)", () => {
    const result = placeSfx(segments, [ev(3, "強調"), ev(3, "印")], [{ index: 0, sound: 1 }]);
    expect(result[3].emphasisSfxPresetId).toBe(TEAM_SFX.mark);
  });

  it("0.7秒以内に続く時は、優先の高い方だけ鳴らす", () => {
    const short = [seg("a", 0.5), seg("b", 0.5), seg("c", 1)];
    const result = placeSfx(short, [ev(0, "強調"), ev(1, "見出し")], [{ index: 0, sound: 1 }]);
    expect(result[0].emphasisSfxPresetId).toBeUndefined();
    expect(result[1].emphasisSfxPresetId).toBe(TEAM_SFX.step);
  });

  it("どの10秒でも5個を超える所は、強調の音から外す", () => {
    const events = [ev(0, "見出し"), ev(1, "強調"), ev(2, "強調"), ev(3, "強調"), ev(4, "項目"), ev(5, "強調"), ev(6, "強調")];
    const result = placeSfx(segments, events, [0, 1, 2, 3, 4].map((index) => ({ index, sound: index + 1 })));
    const sounded = result.filter((segment) => segment.emphasisSfxPresetId).length;
    expect(sounded).toBeLessThanOrEqual(5);
    expect(result[0].emphasisSfxPresetId).toBe(TEAM_SFX.step);
    expect(result[4].emphasisSfxPresetId).toBe(TEAM_SFX.step);
  });

  it("AIが答えられない時は1つおきに選び、音を替える", () => {
    expect(fallbackEmphasisPicks(5)).toEqual([{ index: 0, sound: 1 }, { index: 2, sound: 2 }, { index: 4, sound: 3 }]);
  });
});
