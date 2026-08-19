import { staticFile } from "remotion";

/**
 * clip.src は public/ 配下の相対パス("videos/xxx.mp4")か、リモートURLのどちらかを許容する。
 * staticFile() はリモートURLを渡すと例外を投げるため、ここで振り分ける。
 */
export const resolveClipSrc = (src: string): string => {
  if (src.startsWith("http://") || src.startsWith("https://")) {
    return src;
  }
  return staticFile(src);
};
