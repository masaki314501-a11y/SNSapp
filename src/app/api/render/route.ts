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
import {
  isTemplateId,
  templateRegistry,
  type TemplateId,
} from "@video/templates/registry";

export const runtime = "nodejs";

const DELAY_RENDER_TIMEOUT_IN_MILLISECONDS = 90000;

/**
 * @remotion/bundler の bundle() はプロセス内で1度だけ public/ をコピーして
 * 静的配信するため(bundle.ts参照)、サーバー起動後にアップロードされた動画は
 * そのスナップショットに存在せず404になる。レンダー時だけは絶対URLに差し替え、
 * 実際に稼働中のNext.jsサーバー(常に最新のpublic/を配信している)から
 * 直接読ませることでこれを回避する。
 */
const resolveUploadedSrc = (origin: string, src?: string): string | undefined => {
  if (!src || src.startsWith("http://") || src.startsWith("https://")) return src;
  return `${origin}/${src}`;
};

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const json = await request.json().catch(() => null);

  if (
    typeof json !== "object" ||
    json === null ||
    !("templateId" in json) ||
    typeof json.templateId !== "string" ||
    !isTemplateId(json.templateId)
  ) {
    return NextResponse.json(
      { error: "templateId が不正です" },
      { status: 400 }
    );
  }

  const templateId: TemplateId = json.templateId;
  const template = templateRegistry[templateId];
  const parsed = template.schema.safeParse("props" in json ? json.props : undefined);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "入力内容が不正です", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const inputProps = {
    ...parsed.data,
    clips: parsed.data.clips.map((clip) => ({
      ...clip,
      src: resolveUploadedSrc(origin, clip.src),
    })),
  };
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
        id: template.compositionId,
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
