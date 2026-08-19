import { mkdir } from "node:fs/promises";
import path from "node:path";
import { NextResponse, after } from "next/server";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { getServeUrl } from "@/lib/remotion/bundle";
import { getBrowserInstance } from "@/lib/remotion/browser";
import {
  createRenderJob,
  updateRenderJob,
} from "@/lib/remotion/renderJobs";
import { shortVideoSchema } from "@video/compositions/ShortVideo/schema";

export const runtime = "nodejs";

const DELAY_RENDER_TIMEOUT_IN_MILLISECONDS = 90000;

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = shortVideoSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "入力内容が不正です", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const inputProps = parsed.data;
  const jobId = createRenderJob();

  // レンダーはレスポンス返却後もバックグラウンドで進行させ、進捗はジョブストアを
  // ポーリングして取得する。Next.jsのリクエスト実行コンテキストが終了すると
  // 素の非同期IIFEでは処理が不安定になりうるため after() で確実に継続させる。
  // Node常駐サーバ(next start / next dev)であることが前提。
  after(async () => {
    try {
      const serveUrl = await getServeUrl();
      const puppeteerInstance = await getBrowserInstance();

      const composition = await selectComposition({
        serveUrl,
        id: "ShortVideo",
        inputProps,
        puppeteerInstance,
        timeoutInMilliseconds: DELAY_RENDER_TIMEOUT_IN_MILLISECONDS,
      });

      const outDir = path.join(process.cwd(), "public", "renders");
      await mkdir(outDir, { recursive: true });
      const outputLocation = path.join(outDir, `${jobId}.mp4`);

      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        outputLocation,
        inputProps,
        puppeteerInstance,
        // CPUコアが少ない環境では動画フレームの合成処理がイベントループを
        // 占有し、フォントファイル読み込み(delayRender)が既定の30秒
        // タイムアウト内に完了しないことがあったため延長し、あわせて
        // 並列タブによる競合を避けるため並列度も1に抑える。
        concurrency: 1,
        timeoutInMilliseconds: DELAY_RENDER_TIMEOUT_IN_MILLISECONDS,
        onProgress: ({ progress }) => {
          updateRenderJob(jobId, { status: "rendering", progress });
        },
      });

      updateRenderJob(jobId, {
        status: "done",
        progress: 1,
        url: `/renders/${jobId}.mp4`,
      });
    } catch (error) {
      console.error(error);
      updateRenderJob(jobId, {
        status: "error",
        progress: 0,
        message:
          error instanceof Error ? error.message : "レンダーに失敗しました",
      });
    }
  });

  return NextResponse.json({ jobId });
}
