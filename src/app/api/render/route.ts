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
 * <OffthreadVideo>のフレームキャッシュは既定だと空きメモリの半分まで膨らむ。Render無料プラン
 * (512MB)ではヘッドレスChromeと合わせてメモリを使い切り、サーバーごと落ちる原因になるため
 * 上限を小さく固定し、フレーム取り出しのスレッドも1本に抑える(速度より落ちないことを優先)。
 */
const MEMORY_SAVING_OPTIONS = {
  offthreadVideoCacheSizeInBytes: 128 * 1024 * 1024,
  offthreadVideoThreads: 1,
} as const;

/**
 * @remotion/bundler の bundle() はプロセス内で1度だけ public/ をコピーして
 * 静的配信するため(bundle.ts参照)、サーバー起動後にアップロードされた動画は
 * そのスナップショットに存在せず404になる。レンダー時だけは絶対URLに差し替え、
 * 実際に稼働中のNext.jsサーバーから /api/media 経由で直接読ませることでこれを回避する
 * (/api/media はリクエスト都度ファイルシステムを見るため、本番ビルドでも
 * 起動後に増えたファイルを返せる。通常のpublicフォルダ配信はビルド時点の
 * スナップショットしか返さず本番ビルドで404になるため使えない)。
 *
 * ヘッドレスChromium(レンダラー)は常にこのサーバーと同じマシン/コンテナ内から
 * ループバック経由でアクセスするため、常にプレーンHTTPで到達できる。
 * Codespaces等のポート転送プロキシ経由でブラウザからアクセスした場合、
 * リクエストのoriginがhttpsになることがあるが、それをそのままレンダラーに渡すと
 * ローカルのNext.jsサーバー(HTTPのみ)に対してTLSハンドシェイクを試みてしまい
 * 失敗する(EPROTO: packet length too long)ため、常にループバックのHTTP originを使う。
 */
const LOCAL_ORIGIN = `http://127.0.0.1:${process.env.PORT ?? 3000}`;

const resolveUploadedSrc = (src?: string): string | undefined => {
  if (!src || src.startsWith("http://") || src.startsWith("https://")) return src;
  return `${LOCAL_ORIGIN}/api/media/${src}`;
};

export async function POST(request: Request) {
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
    console.error("[render] 入力検証エラー", JSON.stringify(parsed.error.issues));
    return NextResponse.json(
      { error: "入力内容が不正です", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  // clips[].srcだけでなく、sfx[].src・bgm.srcも同じ理由(コメント参照)で絶対URL化が必要。
  // ここが漏れていると、SE/AIナレーション/BGMを使った動画の書き出しがヘッドレスChromeの
  // 相対パス解決先(バンドルの静的配信サーバー、Next.js本体とは別ポート)への404で失敗する。
  const inputProps = {
    ...parsed.data,
    clips: parsed.data.clips.map((clip) => ({
      ...clip,
      src: resolveUploadedSrc(clip.src),
      images: clip.images?.map((image) => ({ ...image, src: resolveUploadedSrc(image.src) ?? image.src })),
    })),
    globalImages: parsed.data.globalImages?.map((image) => ({
      ...image,
      src: resolveUploadedSrc(image.src) ?? image.src,
    })),
    sfx: parsed.data.sfx.map((clip) => ({
      ...clip,
      src: resolveUploadedSrc(clip.src) ?? clip.src,
    })),
    bgm: parsed.data.bgm
      ? { ...parsed.data.bgm, src: resolveUploadedSrc(parsed.data.bgm.src) ?? parsed.data.bgm.src }
      : parsed.data.bgm,
  };
  const jobId = createRenderJob();

  const runRender = async () => {
    updateRenderJob(jobId, { status: "starting", progress: 0, message: "ブラウザを起動中..." });
    const serveUrl = await getServeUrl();
    const puppeteerInstance = await getBrowserInstance();

    updateRenderJob(jobId, { status: "starting", progress: 0, message: "動画の構成を解決中..." });
    const composition = await selectComposition({
      serveUrl,
      id: template.compositionId,
      inputProps,
      puppeteerInstance,
      timeoutInMilliseconds: DELAY_RENDER_TIMEOUT_IN_MILLISECONDS,
      ...MEMORY_SAVING_OPTIONS,
    });

    const outDir = path.join(process.cwd(), "public", "renders");
    await mkdir(outDir, { recursive: true });
    const outputLocation = path.join(outDir, `${jobId}.mp4`);

    updateRenderJob(jobId, { status: "rendering", progress: 0, message: "フレームを描画中..." });
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
      ...MEMORY_SAVING_OPTIONS,
      onProgress: ({ progress }) => {
        updateRenderJob(jobId, { status: "rendering", progress, message: "フレームを描画中..." });
      },
    });

    updateRenderJob(jobId, { status: "rendering", progress: 1, message: "書き出しファイルを保存中..." });

    updateRenderJob(jobId, {
      status: "done",
      progress: 1,
      url: `/api/media/renders/${jobId}.mp4`,
    });
  };

  // レンダーはレスポンス返却後もバックグラウンドで進行させ、進捗はジョブストアを
  // ポーリングして取得する。Next.jsのリクエスト実行コンテキストが終了すると
  // 素の非同期IIFEでは処理が不安定になりうるため after() で確実に継続させる。
  // Node常駐サーバ(next start / next dev)であることが前提。
  after(async () => {
    try {
      await runRender();
    } catch (firstError) {
      // ヘッドレスChromeの起動・DevTools接続には@remotion/renderer内部で25秒の
      // 固定タイムアウトがあり、CPUコアが少ない環境ではdevサーバーの再コンパイル等と
      // 資源を取り合って初回だけ間に合わないことがある(getBrowserInstance()は
      // 失敗時にキャッシュを捨てるため、再試行で新しいブラウザ起動を試せる)。
      // そのため1回だけ自動リトライしてから諦める。
      console.error("レンダー1回目の失敗、リトライします:", firstError);
      updateRenderJob(jobId, {
        status: "starting",
        progress: 0,
        message: "1回目のレンダーに失敗したため再試行しています...",
      });
      try {
        await runRender();
      } catch (secondError) {
        console.error(secondError);
        updateRenderJob(jobId, {
          status: "error",
          progress: 0,
          message:
            secondError instanceof Error
              ? secondError.message
              : "レンダーに失敗しました",
        });
      }
    }
  });

  return NextResponse.json({ jobId });
}
