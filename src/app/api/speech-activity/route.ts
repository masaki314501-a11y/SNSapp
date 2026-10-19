import { NextResponse } from "next/server";
import { VIDEO_PATH_PATTERN, resolveUploadedVideo } from "@/lib/uploadedVideo";
import { analyzeSpeechActivity } from "@/lib/audio/speechActivity";
import { toFriendlyErrorMessage } from "@/lib/friendlyError";

export const runtime = "nodejs";

/**
 * アップロード済みの動画で話している区間(元の動画の秒数)を返す。字幕を話に合わせて見せるのに使う。
 * 自動編集では一緒に調べているが、自動編集を使わずに作ったプロジェクトや、この仕組みより前のプロジェクトのために、
 * 編集画面から足りない時だけ呼ぶ。音の大きさを見るだけで数秒で終わるので、ジョブにはしない。
 */
export async function GET(request: Request) {
  const videoPath = new URL(request.url).searchParams.get("videoPath") ?? "";
  if (!VIDEO_PATH_PATTERN.test(videoPath)) {
    return NextResponse.json({ error: "動画の指定が不正です" }, { status: 400 });
  }
  const video = await resolveUploadedVideo(videoPath);
  if (!video) {
    return NextResponse.json({ error: "動画が見つかりません" }, { status: 404 });
  }
  try {
    const { spans } = await analyzeSpeechActivity(video.absolutePath);
    return NextResponse.json({ spans });
  } catch (error) {
    console.error("[speech-activity] 音を調べられませんでした", error);
    return NextResponse.json({ error: toFriendlyErrorMessage(error, "音を調べられませんでした") }, { status: 500 });
  }
}
