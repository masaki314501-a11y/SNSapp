import { NextResponse } from "next/server";
import { z } from "zod";
import {
  YOUTUBE_REFERENCE_MIME_TYPE,
  parseYouTubeVideoId,
  youtubeReferencePath,
  youtubeWatchUrl,
} from "@/lib/youtubeReference";

export const runtime = "nodejs";

const requestSchema = z.object({ url: z.string().min(1).max(500) });
const CHECK_TIMEOUT_MS = 10_000;

/**
 * 見た目の手本に、YouTube(ショート)のURLを足すAPI。動画はダウンロードしない。
 * YouTubeの公式の確認窓口(oEmbed)で、公開中の動画かを先に確かめる(限定公開・非公開・消えた動画はAIも読めないため)。
 * 確かめられたら、手本の一覧に残す形(youtube/動画ID)と題名を返す。
 */
export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "URLを入れてください" }, { status: 400 });
  const videoId = parseYouTubeVideoId(parsed.data.url);
  if (!videoId) {
    const isTikTok = /tiktok\.com/i.test(parsed.data.url);
    return NextResponse.json(
      {
        error: isTikTok
          ? "TikTokのURLは使えません。TikTokのアプリの「動画を保存」で保存して、動画ファイルを選んでください"
          : "YouTubeの動画のURLではありません。ショートなら「https://www.youtube.com/shorts/〜」の形です",
      },
      { status: 400 }
    );
  }
  const check = await fetch(
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youtubeWatchUrl(videoId))}`,
    { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) }
  ).catch(() => null);
  if (!check) {
    return NextResponse.json({ error: "YouTubeにつながりませんでした。少し待ってから、もう一度試してください" }, { status: 502 });
  }
  if (!check.ok) {
    return NextResponse.json(
      { error: "この動画は見られません。公開中の動画だけ使えます(限定公開・非公開・削除された動画は使えません)" },
      { status: 400 }
    );
  }
  const info = (await check.json().catch(() => ({}))) as { title?: unknown };
  return NextResponse.json({
    path: youtubeReferencePath(videoId),
    mimeType: YOUTUBE_REFERENCE_MIME_TYPE,
    title: typeof info.title === "string" ? info.title : "",
  });
}
