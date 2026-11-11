/**
 * clip.src は public/ 配下の相対パス("videos/xxx.mp4")か、リモートURLのどちらかを許容する。
 * public/videos, public/audio はサーバー起動後にアップロード/生成されたファイルを置く場所であり、
 * Next.jsの静的public配信はビルド時点のスナップショットしか返さないため(本番ビルドで404になる)、
 * 起動後もファイルシステムを見て配信する /api/media 経由で参照する。
 */
export const resolveClipSrc = (src: string): string => {
  // AIが描いた図(工程8・10)は、絵をそのまま data: のURLで持っている
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
    return src;
  }
  return `/api/media/${src}`;
};
