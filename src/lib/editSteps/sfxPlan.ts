/**
 * 工程11: 効果音を、編集チームの完成動画18本のクセ(docs/se-usage-analysis.md)どおりに置く。
 * - 効果音は、画面で何かが起きた瞬間にだけ鳴らす(ふつうの字幕が替わるだけの所では鳴らさない)
 * - 繰り返す出来事(見出し・次の項目・写真・枠に入る・点数・印)は、その動画で決めた同じ音を毎回鳴らす
 * - 強調の字幕は4割ほどだけ鳴らし(どれにするかはAIが選ぶ)、音は使い分ける
 * - 0.7秒以内に続けて鳴らさない・どの10秒をとっても5個まで(完成動画では多くて4〜5個)
 * 音は、いただいた完成動画から切り出した効果音(public/audio/team-sfx)。
 */
import type { ProjectSegment } from "@/lib/videoProject";
import type { StepState } from "./logic";
import { fillStartSeconds, TOPIC_FRAME, type ReferenceTemplate } from "./template";

const team = (file: string) => `exact:audio/team-sfx/${file}`;

/** 繰り返す出来事の音(1本の中で毎回同じ)。 */
export const TEAM_SFX = {
  step: team("step-pikon.wav"),
  photo: team("photo-pon.wav"),
  fill: team("fill-bon.wav"),
  score: team("score-ka.wav"),
  mark: team("mark-pon.wav"),
  ending: team("ending-chime.wav"),
} as const;

/** 強調の字幕で使い分ける音(AIには id と感じを見せる)。 */
export const EMPHASIS_SFX: { id: string; label: string }[] = [
  { id: team("em-bon.wav"), label: "低い「ボン」(どっしり・結論)" },
  { id: team("em-low-pon.wav"), label: "低めの「ポン」(落ち着いた強調)" },
  { id: team("em-pon.wav"), label: "少し雑音まじりの「ポンッ」(判定・言い切り)" },
  { id: team("em-high-pon.wav"), label: "高めの澄んだ「ポン」(軽い・明るい)" },
  { id: team("em-ping.wav"), label: "短い澄んだ「ピン」(気づき・ポイント)" },
  { id: team("em-sparkle.wav"), label: "きらめく音(良さ・称賛)" },
  { id: team("em-bright.wav"), label: "明るい高い音(驚き・ツッコミ)" },
  { id: team("em-long-chime.wav"), label: "長めに伸びる澄んだ音(感心・まとめ)" },
];

export type SfxEventKind = "締め" | "印" | "数字" | "見出し" | "項目" | "写真" | "冒頭" | "強調";
export type SfxEvent = { seconds: number; kind: SfxEventKind; text: string; segmentIndex: number };

/** 同じクリップに出来事が重なった時に、どれの音にするか(先ほど優先)。 */
const PRIORITY: SfxEventKind[] = ["締め", "印", "数字", "見出し", "項目", "写真", "冒頭", "強調"];
export const MIN_GAP_SECONDS = 0.7;
export const MAX_PER_TEN_SECONDS = 5;

const NUMBER_LIKE = /^[0-9０-９.,%％]+(点|位|%|％|割|個|本|万円|円)?$/;

const segmentStarts = (segments: ProjectSegment[]) => {
  const starts: number[] = [];
  let at = 0;
  for (const segment of segments) {
    starts.push(at);
    at += segment.durationInSeconds;
  }
  return { starts, total: at };
};

/** その秒を含むクリップの番号(音はクリップの頭で鳴る)。 */
const segmentAt = (starts: number[], seconds: number) => {
  let index = 0;
  for (let i = 0; i < starts.length; i++) if (starts[i] <= seconds + 0.05) index = i;
  return index;
};

/** 画面で起きる出来事(効果音を鳴らす候補)を集める。 */
export const collectSfxEvents = (state: StepState, template: ReferenceTemplate | null): SfxEvent[] => {
  const { starts, total } = segmentStarts(state.segments);
  if (state.segments.length === 0) return [];
  const events: SfxEvent[] = [];
  const push = (seconds: number, kind: SfxEventKind, text = "") => {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > total) return;
    events.push({ seconds, kind, text, segmentIndex: segmentAt(starts, seconds) });
  };
  // 冒頭: タイトル・枠が出る動画の頭
  if (state.globalOverlays.length > 0 || state.globalShapes.length > 0) push(0, "冒頭", state.templateTitle ?? "");
  // 枠・カード・見出しに項目が入る
  const startOf = fillStartSeconds(state);
  for (const fill of state.frameFills ?? []) {
    const start = startOf(fill);
    if (start === undefined) continue;
    const kind: SfxEventKind = fill.frame === TOPIC_FRAME ? "見出し" : NUMBER_LIKE.test(fill.label.trim()) ? "数字" : "項目";
    push(start, kind, fill.label);
  }
  // 選ばれた方の丸
  const keyStart = new Map(state.segments.map((segment, i) => [segment.key, starts[i]]));
  for (const mark of state.templateMarks ?? []) {
    const start = keyStart.get(mark.key);
    if (start !== undefined) push(start, "印");
  }
  // 図の部品(写真・イラスト)が後から出る所
  for (const image of state.figureImages ?? []) {
    if ((image.startOffsetSeconds ?? 0) > 0.05) push(image.startOffsetSeconds ?? 0, "写真");
  }
  // 締めの一言
  if (template?.cta && state.templateCta?.trim()) push(Math.max(0, total - template.cta.seconds), "締め", state.templateCta);
  // 強調の字幕(同じ字幕の続きは除く)
  state.segments.forEach((segment, i) => {
    if (segment.captionEmphasis && segment.captionAnimation !== "none" && segment.caption.trim()) push(starts[i], "強調", segment.caption.replace(/\n/g, ""));
  });
  return events.sort((a, b) => a.seconds - b.seconds || PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
};

/** AIに見せる、強調の字幕のどれに鳴らすかを決める指示文(docs/se-usage-analysis.md の指示文から、強調の分だけ)。 */
export const EMPHASIS_SFX_PROMPT = (items: { index: number; seconds: number; text: string; nearStructure: boolean }[], targetCount: number) => `
次は、ショート動画の強調した字幕の一覧です。この編集チームの完成動画18本の決まりに合わせて、効果音を鳴らす字幕を選び、音を決めてください。
- 強調の字幕は全部には鳴らさない。4割ほど(今回は${targetCount}個前後)を選ぶ。驚き・否定・称賛・ツッコミ・結論・数字の言い切りなど、感情や意味の強い言葉を優先する。
- 「近くで別の音が鳴る」と書いた字幕は、見出し・項目・印の音と重なるので、なるべく選ばない。
- 音は、次から言葉の感じに合う物を選ぶ。毎回同じにせず、いろいろな音を使い分ける(同じ音が3回以上続かないように)。
${EMPHASIS_SFX.map((sound, i) => `  ${i + 1}. ${sound.label}`).join("\n")}
字幕:
${items.map((item) => `[${item.index}] ${item.seconds.toFixed(1)}秒「${item.text}」${item.nearStructure ? "(近くで別の音が鳴る)" : ""}`).join("\n")}
選んだ字幕ごとに、index(字幕の番号)と sound(音の番号 1〜${EMPHASIS_SFX.length})を答えてください。
`.trim();

export type EmphasisPick = { index: number; sound: number };

/** AIが答えられなかった時: 1つおきに選び、音を順に替える。 */
export const fallbackEmphasisPicks = (count: number): EmphasisPick[] =>
  Array.from({ length: count }, (_, i) => i)
    .filter((i) => i % 2 === 0)
    .map((index, k) => ({ index, sound: (k % EMPHASIS_SFX.length) + 1 }));

/**
 * 出来事とAIが選んだ強調から、クリップごとの効果音を決める。
 * 1つのクリップには1つの音(重なったら PRIORITY の先の物)。0.7秒以内に続く時は、優先の高い方を残す。
 * どの10秒をとっても5個を超える所は、強調の音から外す。
 */
export const placeSfx = (segments: ProjectSegment[], events: SfxEvent[], picks: EmphasisPick[]): ProjectSegment[] => {
  const emphasisEvents = events.filter((event) => event.kind === "強調");
  const chosenEmphasis = new Map<number, string>();
  for (const pick of picks) {
    const event = emphasisEvents[pick.index];
    const sound = EMPHASIS_SFX[pick.sound - 1];
    if (event && sound) chosenEmphasis.set(event.segmentIndex, sound.id);
  }
  const soundOf = (event: SfxEvent): string | undefined => {
    switch (event.kind) {
      case "締め":
        return TEAM_SFX.ending;
      case "印":
        return TEAM_SFX.mark;
      case "数字":
        return TEAM_SFX.score;
      case "見出し":
      case "項目":
        return TEAM_SFX.step;
      case "写真":
        return TEAM_SFX.photo;
      case "冒頭":
        return TEAM_SFX.step;
      case "強調":
        return chosenEmphasis.get(event.segmentIndex);
    }
  };
  // クリップごとに、いちばん優先の出来事
  const bySegment = new Map<number, SfxEvent>();
  for (const event of events) {
    if (!soundOf(event)) continue;
    const current = bySegment.get(event.segmentIndex);
    if (!current || PRIORITY.indexOf(event.kind) < PRIORITY.indexOf(current.kind)) bySegment.set(event.segmentIndex, event);
  }
  const { starts } = segmentStarts(segments);
  let chosen = [...bySegment.values()].sort((a, b) => starts[a.segmentIndex] - starts[b.segmentIndex]);
  // 0.7秒以内に続く時は、優先の高い方だけ
  const spaced: SfxEvent[] = [];
  for (const event of chosen) {
    const last = spaced[spaced.length - 1];
    if (last && starts[event.segmentIndex] - starts[last.segmentIndex] < MIN_GAP_SECONDS) {
      if (PRIORITY.indexOf(event.kind) < PRIORITY.indexOf(last.kind)) spaced[spaced.length - 1] = event;
      continue;
    }
    spaced.push(event);
  }
  chosen = spaced;
  // どの10秒をとっても5個まで(多い所は、その10秒の中の強調の音から外す)
  const inWindow = (from: number, seconds: number) => seconds >= from && seconds < from + 10;
  for (let guard = 0; guard < chosen.length; guard++) {
    const crowded = chosen.findIndex((event) => chosen.filter((other) => inWindow(starts[event.segmentIndex], starts[other.segmentIndex])).length > MAX_PER_TEN_SECONDS);
    if (crowded < 0) break;
    const from = starts[chosen[crowded].segmentIndex];
    const removable = chosen
      .map((event, i) => ({ event, i }))
      .filter(({ event }) => event.kind === "強調" && inWindow(from, starts[event.segmentIndex]));
    if (removable.length === 0) break;
    chosen = chosen.filter((_, i) => i !== removable[removable.length - 1].i);
  }
  const sounds = new Map(chosen.map((event) => [event.segmentIndex, soundOf(event)]));
  return segments.map((segment, i) => ({ ...segment, emphasisSfxPresetId: sounds.get(i) }));
};

/** AIに、強調の字幕のどれに鳴らすか・どの音にするかを選んでもらう。答えられなければ1つおき。 */
export const pickEmphasisSfx = async (events: SfxEvent[]): Promise<{ picks: EmphasisPick[]; byAi: boolean }> => {
  const emphasis = events.filter((event) => event.kind === "強調");
  if (emphasis.length === 0) return { picks: [], byAi: false };
  const structure = events.filter((event) => event.kind !== "強調");
  const items = emphasis.map((event, index) => ({
    index,
    seconds: event.seconds,
    text: event.text,
    nearStructure: structure.some((other) => Math.abs(other.seconds - event.seconds) < MIN_GAP_SECONDS),
  }));
  const targetCount = Math.max(1, Math.round(emphasis.length * 0.43));
  try {
    const { askJson, STEP_MODEL } = await import("./ai");
    const { Type } = await import("@google/genai");
    const { z } = await import("zod");
    const answer = await askJson({
      model: STEP_MODEL,
      label: "効果音を鳴らす強調",
      parts: [{ text: EMPHASIS_SFX_PROMPT(items, targetCount) }],
      schema: {
        type: Type.OBJECT,
        properties: {
          picks: {
            type: Type.ARRAY,
            items: { type: Type.OBJECT, properties: { index: { type: Type.NUMBER }, sound: { type: Type.NUMBER } }, required: ["index", "sound"] },
          },
        },
        required: ["picks"],
      },
      parse: z.object({ picks: z.array(z.object({ index: z.number().int(), sound: z.number().int() })) }),
    });
    const picks = answer.picks.filter((pick) => pick.index >= 0 && pick.index < emphasis.length && pick.sound >= 1 && pick.sound <= EMPHASIS_SFX.length);
    return { picks, byAi: true };
  } catch (error) {
    console.warn("[sfxPlan] 効果音を鳴らす強調をAIで選べませんでした(1つおきにします)", error);
    return { picks: fallbackEmphasisPicks(emphasis.length), byAi: false };
  }
};
