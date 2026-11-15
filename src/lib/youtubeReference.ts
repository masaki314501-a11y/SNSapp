/**
 * 見た目の手本にYouTube(ショート)のURLを使うための決まり。動画はダウンロードせず、Gemini(AI)に
 * URLをそのまま渡して見せる(Googleが公式に用意している使い方)。TikTokは公式に動画を渡す仕組みが無いので、
 * アプリの「動画を保存」で保存したファイルをアップロードしてもらう。
 * 画面(ブラウザ)とサーバーの両方から使うので、node専用の物は読み込まない。
 */

/** 手本の一覧に残す時の形(youtube/動画ID)。動画IDはYouTubeの11文字。 */
export const YOUTUBE_REFERENCE_PATH_PATTERN = /^youtube\/[A-Za-z0-9_-]{11}$/;
/** 手本の一覧で、YouTubeの手本だと分かるようにする印。 */
export const YOUTUBE_REFERENCE_MIME_TYPE = "video/youtube";

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);

/**
 * 貼られたURLから動画IDを取り出す。ショート(/shorts/ID)・普通の動画(watch?v=ID)・短縮URL(youtu.be/ID)・
 * 埋め込み(/embed/ID)・ライブ(/live/ID)に対応する。YouTubeのURLでなければnull。
 */
export const parseYouTubeVideoId = (input: string): string | null => {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be" || host === "www.youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    const [first, second] = url.pathname.split("/").filter(Boolean);
    if (first === "watch") id = url.searchParams.get("v");
    else if (first === "shorts" || first === "embed" || first === "live") id = second ?? null;
  }
  return id && VIDEO_ID_PATTERN.test(id) ? id : null;
};

export const youtubeReferencePath = (videoId: string): string => `youtube/${videoId}`;
export const videoIdOfYouTubeReference = (referencePath: string): string | null =>
  YOUTUBE_REFERENCE_PATH_PATTERN.test(referencePath) ? referencePath.slice("youtube/".length) : null;
/** AIに渡すURL。 */
export const youtubeWatchUrl = (videoId: string): string => `https://www.youtube.com/watch?v=${videoId}`;
/** 手本の一覧に出す表紙の画像(YouTubeが公開している物)。 */
export const youtubeThumbnailUrl = (videoId: string): string => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
