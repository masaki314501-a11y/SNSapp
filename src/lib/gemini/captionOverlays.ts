import type { RawAutoEditPlan } from "./autoEditTypes";

/**
 * 話している言葉をそのまま(または少し縮めて)出している文字を、強調テキスト(overlays)から外す。
 * このアプリは字幕を話に合わせて必ず出すので、同じ文言を強調テキストとしても出すと、同じ文字が二重に出る。
 * - 正解動画の書き起こし: AIが字幕を強調テキストとして書いてしまうことがあり、それを手本に見せると、
 *   自動編集も字幕を強調テキストで書くようになった(1本で59個など)
 * - 自動編集の答え: 上と同じ理由で、字幕と同じ文言の強調テキストが混ざることがある
 * の両方に使う。
 */

/** 比べる前に、空白・改行・記号を外す。 */
const normalize = (text: string): string => text.replace(/[\s\n、。,.!?！？「」『』…・~〜ー\-()（）]/g, "");

/** 2文字ずつの組の重なり(0〜1)。overlayの組のうち、話の中にもある組の割合。 */
const containedRatio = (overlay: string, speech: string): number => {
  if (overlay.length < 2) return speech.includes(overlay) ? 1 : 0;
  const speechPairs = new Set<string>();
  for (let i = 0; i < speech.length - 1; i++) speechPairs.add(speech.slice(i, i + 2));
  let hit = 0;
  for (let i = 0; i < overlay.length - 1; i++) if (speechPairs.has(overlay.slice(i, i + 2))) hit++;
  return hit / (overlay.length - 1);
};

/** 字幕とみなす重なり。言い換え・一部省略を含めるため、ある程度ゆるくする。 */
const CAPTION_LIKE_RATIO = 0.7;
/** これより短い文字(「価格」「1位」など)は、話の中に出てきても見出し・ラベルなので外さない。 */
const MIN_CAPTION_CHARS = 6;
/**
 * これより小さい文字は、話に出てきた言葉でも名前・工程のラベル(「槇原敬之さん」「インプラント埋入」)なので外さない。
 * 字幕は読ませるために大きく出している(手本では60〜90px)。
 */
const MIN_CAPTION_FONT_PX = 45;

export const isCaptionLike = (text: string, nearbySpeech: string): boolean => {
  const overlay = normalize(text);
  if (overlay.length < MIN_CAPTION_CHARS) return false;
  return containedRatio(overlay, normalize(nearbySpeech)) >= CAPTION_LIKE_RATIO;
};

/**
 * 字幕と同じ文言の強調テキストを外した編集案と、外した数を返す。比べる話は、そのクリップと前後1つずつ
 * (字幕の切れ目とクリップの切れ目がずれることがあるため)。
 */
export const removeCaptionLikeOverlays = (plan: RawAutoEditPlan): { plan: RawAutoEditPlan; removed: number; removedYPercents: number[] } => {
  let removed = 0;
  const removedYPercents: number[] = [];
  const clips = plan.clips.map((clip, index) => {
    if (!clip.overlays?.length) return clip;
    const nearby = [plan.clips[index - 1]?.speech, clip.speech, plan.clips[index + 1]?.speech].filter(Boolean).join("");
    if (!nearby) return clip;
    const overlays = clip.overlays.filter((overlay) => {
      // 最後まで残す物・ランキングの枠に入れる物は、話に出てきた言葉でも字幕ではない
      if (overlay.keepUntilEnd || overlay.slotRank) return true;
      if (typeof overlay.fontSizePx === "number" && overlay.fontSizePx < MIN_CAPTION_FONT_PX) return true;
      if (!isCaptionLike(overlay.text, nearby)) return true;
      removed++;
      if (typeof overlay.yPercent === "number") removedYPercents.push(overlay.yPercent);
      return false;
    });
    return overlays.length === clip.overlays.length ? clip : { ...clip, overlays };
  });
  return { plan: removed > 0 ? { ...plan, clips } : plan, removed, removedYPercents };
};

/**
 * 正解動画の書き起こしを、字幕と強調テキストを分けた形に直す。字幕を強調テキストとして書いていた場合は、
 * それを外して字幕あり(showCaptions)にし、字幕の位置が書かれていなければ、外した文字の位置から決める。
 */
export const separateCaptionsInBreakdown = (plan: RawAutoEditPlan): RawAutoEditPlan => {
  const { plan: cleaned, removed, removedYPercents } = removeCaptionLikeOverlays(plan);
  if (removed < 3) return cleaned;
  const sorted = [...removedYPercents].sort((a, b) => a - b);
  const y = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const position = y === null ? undefined : y < 35 ? "top" : y < 65 ? "middle" : "bottom";
  return {
    ...cleaned,
    showCaptions: true,
    theme: {
      ...cleaned.theme,
      captionPosition: cleaned.theme?.captionPosition ?? position,
    },
  };
};
