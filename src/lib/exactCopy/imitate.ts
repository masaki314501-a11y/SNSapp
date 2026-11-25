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
  /** 見た目を写す、手本の強調(手本の強調の出来事の番号。0始まり。無ければ null)。EC-8 */
  copyOf: number | null;
};

/** 工程11で付けるために、字幕のクリップのキーごとに覚えておく寄りと効果音。 */
export type ExactEffects = Record<string, { zoom: number | null; sfx: string | null }>;

/** 手本の強調の出来事(番号を付けてAIに見せ、見た目を写す元にする)。 */
export const emphasisEvents = (events: ReferenceEvents) => events.events.filter((event) => event.kind === "emphasis");

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

/** 手本の、ふつうの字幕の出来事の数。 */
const captionEventCount = (events: ReferenceEvents) => events.events.filter((event) => event.kind === "caption").length;

export const IMITATE_PROMPT = (input: {
  events: ReferenceEvents;
  rows: { text: string; seconds: number; objects?: string[] }[];
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

## これから編集する動画の字幕(番号: 字幕 (出ている秒数) [その時に画面に出る物])。全体の長さは${input.totalSeconds.toFixed(1)}秒
${input.rows.map((row, index) => `${index + 1}: ${row.text.replace(/\n/g, "")} (${row.seconds.toFixed(1)}秒)${row.objects && row.objects.length > 0 ? ` [${row.objects.join("・")}]` : ""}`).join("\n")}

## やること
手本で「ある役目の言葉・瞬間」(項目の名前を言った・答えを言い切った・強い言葉・話題が変わった・結論 等)に起きていた事を、
この動画の同じ役目の言葉・瞬間に、同じように起こしてください。手本の秒数を写すのではなく、話の中身で対応させます。
手本で、丸・絵・名前などの物が出る瞬間に、強調・寄り・効果音が一緒に起きていたら、この動画でも、同じ物が出る字幕([ ]の中)に同じ組み合わせで起こしてください。
量(強調・寄り・効果音の回数)は、手本と同じ割合にします(動画の長さが違えば、その分だけ増減する)。手本で使っていない物は使わない。
強調の数の目安: 手本は、字幕${captionEventCount(input.events) + emphasisEvents(input.events).length}個のうち${emphasisEvents(input.events).length}個を強調していた。この動画の字幕は${input.rows.length}個なので、およそ${Math.max(1, Math.round((input.rows.length * emphasisEvents(input.events).length) / Math.max(1, captionEventCount(input.events) + emphasisEvents(input.events).length)))}個を強調する(話題ごとに偏らせず、どの話題にも手本と同じくらい入れる)。
字幕ごとに、次を答えてください(すべての字幕について、番号の順に)。
- index: 字幕の番号。
- emphasis: 手本で強調していた役目の字幕なら、強調の見た目の番号。強調しないなら 0。
- copyOf: 強調する字幕は、手本の強調のうち、役目が一番近い物の番号(下の一覧)。その字の色・縁の色を写す。手本が強調ごとに色を変えている時は、手本と同じ順に色が変わるように選ぶ。強調しないなら 0。
${emphasisEvents(input.events).map((event, index) => `  ${index + 1}: 「${event.text || event.spoken}」(${event.trigger}。${event.look})`).join("\n")}
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
              copyOf: { type: Type.INTEGER },
              reason: { type: Type.STRING },
            },
            required: ["index", "emphasis", "animation", "zoom", "sfx", "copyOf", "reason"],
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
          copyOf: z.number().int().catch(0),
          reason: z.string().catch(""),
        })
      ),
    }),
  });
  return toRows(result.rows, input.rows.length, input.emphasisStyles.length, new Set(input.sounds.map((sound) => sound.id)), emphasisEvents(input.events).length);
};

/** AIの答えを、使える形に直す(範囲外の番号・知らない音は外す。寄りは1.05〜1.5倍)。 */
export const toRows = (
  raw: { index: number; emphasis: number; animation: CaptionAnimation; zoom: number; sfx: string; copyOf?: number }[],
  rowCount: number,
  styleCount: number,
  sounds: Set<string>,
  referenceEmphasisCount = 0
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
      copyOf: row.copyOf && row.copyOf >= 1 && row.copyOf <= referenceEmphasisCount && row.emphasis >= 1 ? row.copyOf - 1 : null,
    });
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
};

/** 完全模倣の工程11: 覚えておいた寄りと効果音を、その字幕のクリップに付ける(ほかのクリップの寄り・効果音は外す)。 */
export const applyExactEffects = (segments: ProjectSegment[], effects: ExactEffects): ProjectSegment[] =>
  segments.map((segment, i) => {
    const effect = effects[segment.key];
    // 同じ字幕の続き(カットの切れ目の後)は、もう一度鳴らさない。続きかどうかは、前のクリップと字幕の文が同じかで見分ける
    // (手本の字幕が「ぱっと出る」時は、出方を「動きなし(none)」にするので、出方では見分けられない)
    const continued = i > 0 && segments[i - 1].caption.trim() !== "" && segments[i - 1].caption === segment.caption;
    if (!effect || continued) return { ...segment, zoom: undefined, emphasisSfxPresetId: undefined };
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

/** 手本で、画面が切り替わらずに続いたいちばん長い秒数(測った切り替わりの秒の間)。測れていなければ null。 */
export const longestShotOf = (changes: number[]): number | null => {
  if (changes.length < 3) return null;
  const sorted = [...changes].sort((a, b) => a - b);
  return Math.max(...sorted.slice(1).map((value, i) => value - sorted[i]));
};

/**
 * 完全模倣(B8 同じ画角が続く長さ): 寄りも切り替わりも無いまま、手本のいちばん長い秒数より長く続く所に、
 * 手本と同じ「ぱっと寄る」を入れて区切る(手本では、どの画角も6.9秒以内に、寄るか切り替わっていた)。
 * 寄る強さは、この動画でほかに寄っている所と同じ(無ければ scale)。字幕の続き(カットの切れ目の後)には入れない。
 */
export const breakLongShots = (segments: ProjectSegment[], limitSeconds: number, scale: number): ProjectSegment[] => {
  const used = segments.find((segment) => segment.zoom)?.zoom?.scale ?? scale;
  const result = [...segments];
  let lastChange = 0;
  let at = 0;
  result.forEach((segment, i) => {
    const start = at;
    const end = at + segment.durationInSeconds;
    at = end;
    if (segment.zoom) {
      lastChange = end;
      return;
    }
    const continued = i > 0 && result[i - 1].caption.trim() !== "" && result[i - 1].caption === segment.caption;
    const neighborZoomed = Boolean(result[i - 1]?.zoom || result[i + 1]?.zoom);
    if (end - lastChange > limitSeconds && start - lastChange >= 1 && !continued && !neighborZoomed) {
      result[i] = {
        ...segment,
        zoom: { scale: used, style: "punch", focusXPercent: segment.faceBox?.xPercent ?? 50, focusYPercent: segment.faceBox?.yPercent ?? 40 },
      };
      lastChange = end;
    }
  });
  return result;
};
