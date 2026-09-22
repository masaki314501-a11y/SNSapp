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
import { isRenderMediaDownloadError, toFriendlyRenderError } from "@/lib/remotion/renderErrors";
import {
  isTemplateId,
  templateRegistry,
  type TemplateId,
} from "@video/templates/registry";

export const runtime = "nodejs";

const DELAY_RENDER_TIMEOUT_IN_MILLISECONDS = 90000;

/**
 * @remotion/bundler の bundle() はプロセス内で1度だけ public/ をコピーして
 * 静的配信するため(bundle.ts参照)、サーバー起動後にアップロードされた動画・SE・
 * AIナレーション音声はそのスナップショットに存在せず404になる。レンダー時だけは絶対URLに差し替え、
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

/** sfx/bgmのsrcは必須フィールドのため、resolveUploadedSrcの`string | undefined`をstringに戻す。 */
const resolveRequiredUploadedSrc = (src: string): string => resolveUploadedSrc(src) ?? src;

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

  const inputProps = {
    ...parsed.data,
    clips: parsed.data.clips.map((clip) => ({
      ...clip,
      src: resolveUploadedSrc(clip.src),
    })),
    // SE・AIナレーション音声(sfxClips、ClipEditor.tsx参照)も同梱プリセット/生成音声の
    // どちらも public/ 配下の相対パスで持っているため、動画クリップと同じ理由で
    // 絶対URLに差し替える必要がある(未対応だとレンダラーが自身のバンドルサーバーの
    // 相対パスとして誤解決し、404になる)。
    sfx: parsed.data.sfx.map((clip) => ({
      ...clip,
      src: resolveRequiredUploadedSrc(clip.src),
    })),
    bgm: parsed.data.bgm
      ? { ...parsed.data.bgm, src: resolveRequiredUploadedSrc(parsed.data.bgm.src) }
      : undefined,
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
      // 素材ファイルが見つからない等の決定的な失敗は、同じプロジェクトのまま
      // 再試行しても直らないため、即座に諦めて分かりやすいメッセージを出す
      // (isRenderMediaDownloadError参照)。
      if (isRenderMediaDownloadError(firstError)) {
        console.error(firstError);
        updateRenderJob(jobId, {
          status: "error",
          progress: 0,
          message: toFriendlyRenderError(firstError),
        });
        return;
      }

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
          message: toFriendlyRenderError(secondError),
        });
      }
    }
  });

  return NextResponse.json({ jobId });
}
