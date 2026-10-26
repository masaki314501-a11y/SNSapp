import type { RawAutoEditPlan } from "@/lib/gemini/autoEditTypes";
import { similarityToExamples } from "@/lib/gemini/autoEditPlan";

/**
 * 自動編集の答え(Geminiの生の答え)が、正解動画の書き起こし(editExampleBreakdown.ts)にどれだけ近いかを
 * 0〜100点で出す。質を上げる試行錯誤(scripts/eval/run.ts)の物差し。
 * 要素ごとに「いつ出たか(元の動画の秒数)」で突き合わせ、合った物の位置・大きさ・色も比べる。
 * 正解にもAIの答えにも無い要素は採点しない(両方0個なら満点扱いにはせず、平均から外す)。
 */

type Event = { t: number; x?: number; y?: number; size?: number; color?: string };

const n = (value: number | null | undefined, fallback = 0): number => (typeof value === "number" ? value : fallback);

const clipEvents = (plan: RawAutoEditPlan) => {
  const overlays: Event[] = [];
  const images: Event[] = [];
  const sfx: Event[] = [];
  const zooms: Event[] = [];
  for (const clip of plan.clips) {
    const start = clip.sourceStartSeconds;
    for (const overlay of clip.overlays ?? []) {
      overlays.push({
        t: start + n(overlay.startOffsetSeconds),
        x: n(overlay.xPercent, 50),
        y: n(overlay.yPercent, 50),
        size: n(overlay.fontSizePx, 80),
        color: overlay.color ?? "#FFFFFF",
      });
    }
    for (const image of clip.images ?? []) {
      images.push({ t: start + n(image.startOffsetSeconds), x: n(image.xPercent, 50), y: n(image.yPercent, 50), size: n(image.widthPercent, 50) });
    }
    for (const effect of clip.sfx ?? []) sfx.push({ t: start + n(effect.offsetSeconds) });
    if (clip.zoom && clip.zoom.scale > 1.001) zooms.push({ t: start, size: clip.zoom.scale });
  }
  return { overlays, images, sfx, zooms };
};

/** 時刻の近い物同士を1対1で組にする(近い順に貪欲に)。 */
const matchByTime = (a: Event[], b: Event[], tolerance: number): [Event, Event][] => {
  const pairs: { i: number; j: number; d: number }[] = [];
  a.forEach((ea, i) => b.forEach((eb, j) => {
    const d = Math.abs(ea.t - eb.t);
    if (d <= tolerance) pairs.push({ i, j, d });
  }));
  pairs.sort((p, q) => p.d - q.d);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const result: [Event, Event][] = [];
  for (const { i, j } of pairs) {
    if (usedA.has(i) || usedB.has(j)) continue;
    usedA.add(i);
    usedB.add(j);
    result.push([a[i], b[j]]);
  }
  return result;
};

/** 組になった数のF1(どちらも0個ならnull=採点しない)。 */
const f1 = (matched: number, countA: number, countB: number): number | null =>
  countA + countB === 0 ? null : (2 * matched) / (countA + countB);

const ratio = (a: number, b: number): number | null => (a === 0 && b === 0 ? null : Math.min(a, b) / Math.max(a, b));

const hexToRgb = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const colorCloseness = (a?: string, b?: string): number => {
  const ra = a ? hexToRgb(a) : null;
  const rb = b ? hexToRgb(b) : null;
  if (!ra || !rb) return 0.5;
  const d = Math.hypot(ra[0] - rb[0], ra[1] - rb[1], ra[2] - rb[2]);
  return Math.max(0, 1 - d / 200);
};

/** 組になった物の見た目の近さ(位置・大きさ・色)。 */
const lookCloseness = (pairs: [Event, Event][], useColor: boolean): number | null => {
  if (pairs.length === 0) return null;
  const values = pairs.map(([p, c]) => {
    const pos = Math.max(0, 1 - Math.hypot(n(p.x) - n(c.x), n(p.y) - n(c.y)) / 30);
    const size = p.size && c.size ? Math.min(p.size, c.size) / Math.max(p.size, c.size) : 0.5;
    return useColor ? (pos + size + colorCloseness(p.color, c.color)) / 3 : (pos + size) / 2;
  });
  return values.reduce((s, v) => s + v, 0) / values.length;
};

/** 画面全体に出す文字の近さ: 位置が近い物同士を組にして(15%以内)、数と見た目を見る。 */
const globalOverlayScore = (plan: RawAutoEditPlan, correct: RawAutoEditPlan): { match: number | null; look: number | null } => {
  const toEvents = (p: RawAutoEditPlan): Event[] =>
    (p.globalOverlays ?? []).map((o) => ({ t: 0, x: n(o.xPercent, 50), y: n(o.yPercent, 50), size: n(o.fontSizePx, 80), color: o.color ?? "#FFFFFF" }));
  const a = toEvents(plan);
  const b = toEvents(correct);
  const pairs: [Event, Event][] = [];
  const used = new Set<number>();
  for (const ea of a) {
    let best = -1;
    let bestD = 15;
    b.forEach((eb, j) => {
      const d = Math.hypot(n(ea.x) - n(eb.x), n(ea.y) - n(eb.y));
      if (!used.has(j) && d < bestD) {
        bestD = d;
        best = j;
      }
    });
    if (best >= 0) {
      used.add(best);
      pairs.push([ea, b[best]]);
    }
  }
  return { match: f1(pairs.length, a.length, b.length), look: lookCloseness(pairs, true) };
};

const usedSeconds = (plan: RawAutoEditPlan): number =>
  plan.clips.reduce((sum, clip) => sum + Math.max(0, clip.sourceEndSeconds - clip.sourceStartSeconds), 0);

export type ScoreBreakdown = Record<string, number | null> & { total: number };

/** 項目ごとの重み。見た目に効く物(強調の文字・画像・寄り)を重くする。 */
const WEIGHTS: Record<string, number> = {
  overlayTiming: 2,
  overlayLook: 1,
  globalMatch: 1,
  globalLook: 1,
  zoomTiming: 1,
  sfxTiming: 1,
  imageTiming: 1.5,
  imageLook: 0.5,
  shapes: 0.5,
  theme: 1,
  counts: 1,
  cutLength: 0.5,
  clipCount: 0.5,
};

export const scorePlan = (plan: RawAutoEditPlan, correct: RawAutoEditPlan): ScoreBreakdown => {
  const p = clipEvents(plan);
  const c = clipEvents(correct);
  const overlayPairs = matchByTime(p.overlays, c.overlays, 1.0);
  const imagePairs = matchByTime(p.images, c.images, 1.5);
  const global = globalOverlayScore(plan, correct);
  const themeKeys = ["captionPosition", "captionStyle", "captionFontSize"] as const;
  const theme =
    themeKeys.filter((key) => (plan.theme?.[key] ?? null) === (correct.theme?.[key] ?? null)).length / themeKeys.length;

  const parts: Record<string, number | null> = {
    overlayTiming: f1(overlayPairs.length, p.overlays.length, c.overlays.length),
    overlayLook: lookCloseness(overlayPairs, true),
    globalMatch: global.match,
    globalLook: global.look,
    zoomTiming: f1(matchByTime(p.zooms, c.zooms, 1.5).length, p.zooms.length, c.zooms.length),
    sfxTiming: f1(matchByTime(p.sfx, c.sfx, 0.7).length, p.sfx.length, c.sfx.length),
    imageTiming: f1(imagePairs.length, p.images.length, c.images.length),
    imageLook: lookCloseness(imagePairs, false),
    shapes: ratio(plan.globalShapes?.length ?? 0, correct.globalShapes?.length ?? 0),
    theme,
    counts: similarityToExamples(plan, [correct]),
    cutLength: ratio(usedSeconds(plan), usedSeconds(correct)),
    clipCount: ratio(plan.clips.length, correct.clips.length),
  };
  let sum = 0;
  let weight = 0;
  for (const [key, value] of Object.entries(parts)) {
    if (value === null) continue;
    sum += value * WEIGHTS[key];
    weight += WEIGHTS[key];
  }
  return { ...parts, total: weight > 0 ? Math.round((sum / weight) * 1000) / 10 : 0 };
};
