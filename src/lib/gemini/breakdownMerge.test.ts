import { describe, expect, it } from "vitest";
import type { RawAutoEditPlan } from "./autoEditTypes";
import { mergeBreakdowns } from "./breakdownMerge";

const plan = (clips: RawAutoEditPlan["clips"]): RawAutoEditPlan => ({ summary: "", theme: null, clips });

describe("mergeBreakdowns", () => {
  it("2回以上の書き起こしに出てくる物だけを残し、土台に無い物はその時刻のクリップへ足す", () => {
    const a = plan([
      { sourceStartSeconds: 0, sourceEndSeconds: 5, overlays: [{ text: "八重歯", startOffsetSeconds: 2 }, { text: "幻", startOffsetSeconds: 4 }] },
      { sourceStartSeconds: 5, sourceEndSeconds: 10 },
    ]);
    const b = plan([
      { sourceStartSeconds: 0, sourceEndSeconds: 3, overlays: [{ text: "八重歯", startOffsetSeconds: 2.3 }] },
      { sourceStartSeconds: 3, sourceEndSeconds: 10, overlays: [{ text: "出っ歯", startOffsetSeconds: 4 }], sfx: [{ presetId: "pop", offsetSeconds: 4 }] },
    ]);
    const c = plan([
      { sourceStartSeconds: 0, sourceEndSeconds: 10, overlays: [{ text: "出っ歯", startOffsetSeconds: 7.2 }], sfx: [{ presetId: "pop", offsetSeconds: 7.1 }] },
    ]);
    const merged = mergeBreakdowns([a, b, c]);
    expect(merged.clips).toHaveLength(2);
    expect(merged.clips[0].overlays?.map((o) => o.text)).toEqual(["八重歯"]);
    expect(merged.clips[1].overlays?.map((o) => [o.text, o.startOffsetSeconds])).toEqual([["出っ歯", 2]]);
    expect(merged.clips[1].sfx).toHaveLength(1);
  });
});
