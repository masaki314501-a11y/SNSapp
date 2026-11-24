/**
 * 完全模倣(EC-3): 手本の出来事の一覧(events.ts)を、新しい動画の字幕ごとに当てはめる。
 * 手本の時刻は写さず、「手本でこういう言葉・瞬間にこういう事をしていた」を、新しい動画の同じ役目の言葉・瞬間に起こす。
 * 量(強調・寄り・効果音の回数)も、手本と同じ割合にする。
 */
import { Type } from "@google/genai";
import { z } from "zod";
import { CAPTION_ANIMATION_OPTIONS, type CaptionAnimation, type ClipZoom } from "@video/shared/schema";
import type { ProjectSegment } from "@/lib/videoProject";
import { STEP_MODEL, askJson } from "./ai";
import type { ReferenceEvents } from "./events";

const ANIMATION_VALUES = CAPTION_ANIMATION_OPTIONS.map((option) => option.value) as [CaptionAnimation, ...CaptionAnimation[]];

/** 字幕ごとの決め事(index は0始まり)。 */
export type ImitationRow = {
  index: number;
  /** 強調の見た目の番号(0始まり。強調しないなら null)。 */
  emphasis: number | null;
  /** 字幕が出る時の動き。 */
  animation: CaptionAnimation;
  /** 寄りの強さ(寄らないなら null)。 */
  zoom: number | null;
  /** 鳴らす効果音のid(鳴らさないなら null)。 */
  sfx: string | null;
};

/** 工程11で付けるために、字幕のクリップのキーごとに覚えておく寄りと効果音。 */
export type ExactEffects = Record<string, { zoom: number | null; sfx: string | null }>;

const fmtEvents = (events: ReferenceEvents) =>
  events.events
    .map((event) => {
      const parts = [`${event.seconds.toFixed(1)}秒 ${event.kind}`];
      if (event.spoken) parts.push(`話していた言葉「${event.spoken}」`);
      if (event.trigger) parts.push(`瞬間: ${event.trigger}`);
      if (event.text) parts.push(`文字「${event.text}」`);
      if (event.look) parts.push(`見た目: ${event.look}`);
      if (event.motion) parts.push(`動き: ${event.motion}`);
      if (event.scale !== null) parts.push(`強さ: ${event.scale}倍`);
      if (event.sound) parts.push(`音: ${event.sound}`);
      return `- ${parts.join(" / ")}`;
    })
    .join("\n");

export const IMITATE_PROMPT = (input: {
  events: ReferenceEvents;
  rows: { text: string; seconds: number }[];
  totalSeconds: number;
  emphasisStyles: { role: string; look: string }[];
  sounds: { id: string; label: string }[];
}) => `
これから編集する動画を、お客様が選んだ手本の動画と「並べたら同じ編集で、話している中身だけ違う」動画にします。
手本の編集は、次のとおりでした(手本の長さは${input.events.seconds.toFixed(1)}秒)。

## 手本で起きていたこと(起きた順)
${fmtEvents(input.events)}

## 手本全体の決まり
- 強調: ${input.events.rules.emphasis}
- 字幕: ${input.events.rules.captions}
- 寄り: ${input.events.rules.zoom}
- 効果音: ${input.events.rules.sfx}
- オブジェクト: ${input.events.rules.objects}

## これから編集する動画の字幕(番号: 字幕 (出ている秒数))。全体の長さは${input.totalSeconds.toFixed(1)}秒
${input.rows.map((row, index) => `${index + 1}: ${row.text.replace(/\n/g, "")} (${row.seconds.toFixed(1)}秒)`).join("\n")}

## やること
手本で「ある役目の言葉・瞬間」(項目の名前を言った・答えを言い切った・強い言葉・話題が変わった・結論 等)に起きていた事を、
この動画の同じ役目の言葉・瞬間に、同じように起こしてください。手本の秒数を写すのではなく、話の中身で対応させます。
量(強調・寄り・効果音の回数)は、手本と同じ割合にします(動画の長さが違えば、その分だけ増減する)。手本で使っていない物は使わない。
字幕ごとに、次を答えてください(すべての字幕について、番号の順に)。
- index: 字幕の番号。
- emphasis: 手本で強調していた役目の字幕なら、強調の見た目の番号。強調しないなら 0。
${input.emphasisStyles.map((style, index) => `  ${index + 1}: ${style.role}(${style.look})`).join("\n")}
- animation: その字幕が出る時の動き。手本のその役目の字幕の動きに一番近い物: ${CAPTION_ANIMATION_OPTIONS.map((option) => `${option.value}(${option.label})`).join(" / ")}
- zoom: 手本でその役目の瞬間に寄っていたなら、その強さ(例 1.15)。寄らないなら 0。
- sfx: 手本でその役目の瞬間に効果音が鳴っていたなら、手本の音に一番近い物のid: ${input.sounds.map((sound) => `${sound.id}(${sound.label})`).join(" / ")}。鳴らさないなら空。
- reason: 手本のどの出来事に対応させたか(短く。対応させなかった字幕は空でよい)。
`.trim();

/** 手本の出来事の一覧に沿って、字幕ごとの強調・出方・寄り・効果音をAIに決めてもらう。 */
export const planImitation = async (input: Parameters<typeof IMITATE_PROMPT>[0]): Promise<ImitationRow[]> => {
  const result = await askJson({
    model: STEP_MODEL,
    label: "手本の当てはめ",
    timeoutMs: 6 * 60 * 1000,
    parts: [{ text: IMITATE_PROMPT(input) }],
    schema: {
      type: Type.OBJECT,
      properties: {
        rows: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              index: { type: Type.INTEGER },
              emphasis: { type: Type.INTEGER },
              animation: { type: Type.STRING, format: "enum", enum: [...ANIMATION_VALUES] },
              zoom: { type: Type.NUMBER },
              sfx: { type: Type.STRING },
              reason: { type: Type.STRING },
            },
            required: ["index", "emphasis", "animation", "zoom", "sfx", "reason"],
          },
        },
      },
      required: ["rows"],
    },
    parse: z.object({
      rows: z.array(
        z.object({
          index: z.number().int(),
          emphasis: z.number().int(),
          animation: z.enum(ANIMATION_VALUES).catch("pop"),
          zoom: z.number().catch(0),
          sfx: z.string().catch(""),
          reason: z.string().catch(""),
        })
      ),
    }),
  });
  return toRows(result.rows, input.rows.length, input.emphasisStyles.length, new Set(input.sounds.map((sound) => sound.id)));
};

/** AIの答えを、使える形に直す(範囲外の番号・知らない音は外す。寄りは1.05〜1.5倍)。 */
export const toRows = (
  raw: { index: number; emphasis: number; animation: CaptionAnimation; zoom: number; sfx: string }[],
  rowCount: number,
  styleCount: number,
  sounds: Set<string>
): ImitationRow[] => {
  const byIndex = new Map<number, ImitationRow>();
  for (const row of raw) {
    const index = row.index - 1;
    if (index < 0 || index >= rowCount || byIndex.has(index)) continue;
    byIndex.set(index, {
      index,
      emphasis: row.emphasis >= 1 && row.emphasis <= styleCount ? row.emphasis - 1 : null,
      animation: row.animation,
      zoom: row.zoom >= 1.03 ? Math.min(1.5, Math.max(1.05, row.zoom)) : null,
      sfx: sounds.has(row.sfx) ? row.sfx : null,
    });
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
};

/** 完全模倣の工程11: 覚えておいた寄りと効果音を、その字幕のクリップに付ける(ほかのクリップの寄り・効果音は外す)。 */
export const applyExactEffects = (segments: ProjectSegment[], effects: ExactEffects): ProjectSegment[] =>
  segments.map((segment) => {
    const effect = effects[segment.key];
    // 同じ字幕の続き(カットの切れ目の後)は、もう一度鳴らさない・寄りもそのまま続けない
    if (!effect || segment.captionAnimation === "none") return { ...segment, zoom: undefined, emphasisSfxPresetId: undefined };
    const zoom: ClipZoom | undefined = effect.zoom
      ? { scale: effect.zoom, style: "punch", focusXPercent: segment.faceBox?.xPercent ?? 50, focusYPercent: segment.faceBox?.yPercent ?? 40 }
      : undefined;
    return { ...segment, zoom, emphasisSfxPresetId: effect.sfx ?? undefined };
  });

/**
 * 手本の字幕の長さの上限(EC-3: 字幕の長さを手本に合わせる)。手本の字幕の文字数を短い順に並べ、8割の所の長さにする。
 * 手本の字幕が読めていなければ null(今まで通り)。
 */
export const captionLimitOf = (events: ReferenceEvents): number | null => {
  const lengths = events.events
    .filter((event) => event.kind === "caption" && event.text.trim())
    .map((event) => [...event.text.replace(/\s/g, "")].length)
    .sort((a, b) => a - b);
  if (lengths.length < 3) return null;
  return Math.max(6, lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * 0.8))]);
};
