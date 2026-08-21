// テロップは縦型ショート動画に大きく重ねて表示するため、視認性を優先して短く制限する。
export const CLIP_CAPTION_MAX_CHARS = 18;

export const graphemeLength = (text: string): number => Array.from(text).length;

/**
 * 文字数超過時に句読点や区切りの直後で自然に切れる位置を探して短縮する。
 * 適切な区切りが見つからない場合は上限文字数でそのまま切る。
 */
export const truncateNaturally = (text: string, maxChars: number): string => {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  const breakChars = new Set(["。", "、", "!", "?", "!", "?", " ", "・"]);
  for (let i = maxChars - 1; i > Math.floor(maxChars * 0.6); i--) {
    if (breakChars.has(chars[i])) return chars.slice(0, i + 1).join("");
  }
  return chars.slice(0, maxChars).join("");
};
