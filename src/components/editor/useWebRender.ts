"use client";

import { useEffect, useRef, useState } from "react";
import { StandardVideo } from "@video/templates/standard/StandardVideo";
import { getStandardVideoDurationInFrames } from "@video/templates/standard/duration";
import type { StandardVideoProps } from "@video/templates/standard/schema";
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "@video/shared/constants";
import type { RenderState } from "./useRenderJob";
import { toFriendlyErrorMessage } from "@/lib/friendlyError";

/** 書き出し結果。iPhoneの「ビデオを保存」(共有シート)に渡すためBlobも持っておく。 */
export type WebRenderResult = { blob: Blob; fileName: string };

const ISSUE_LABELS: Record<string, string> = {
  "webcodecs-unavailable": "このブラウザは動画の書き出し機能(WebCodecs)に対応していません",
  "video-codec-unsupported": "このブラウザはMP4(H.264)の書き出しに対応していません",
  "audio-codec-unsupported": "このブラウザは音声(AAC)の書き出しに対応していません",
  "webgl-unsupported": "このブラウザはWebGLが使えません",
  "invalid-dimensions": "動画のサイズが不正です",
};

/**
 * 書き出しに失敗した時に、設定を変えて自動でやり直す順番。ブラウザ内の動画エンコーダー(WebCodecs)は
 * 端末やその時の状態によって途中で止まることがあり(Safariで「Buffer has no frame」
 * 「Encoding task did not complete」)、同じ設定で押し直しても同じ所で止まりやすい。
 * まず端末の動画支援(ハードウェア)を使わない作り方、次にハードウェアを指定して画質を一段落とした作り方、
 * 最後に解像度を少し下げた作り方の順に試す。
 */
const RENDER_FALLBACKS: {
  label: string;
  options: { hardwareAcceleration?: "prefer-software" | "prefer-hardware"; videoBitrate?: "medium"; scale?: number };
}[] = [
  { label: "通常の設定", options: {} },
  { label: "端末の動画支援を使わない設定", options: { hardwareAcceleration: "prefer-software" } },
  { label: "画質を少し落とした設定", options: { hardwareAcceleration: "prefer-hardware", videoBitrate: "medium" } },
  { label: "解像度を少し下げた設定", options: { videoBitrate: "medium", scale: 0.75 } },
];

/** 動画を作る部分(エンコーダー)が止まったエラーか。設定を変えればやり直せる見込みがあるものだけ自動でやり直す。 */
const isEncoderError = (error: unknown): boolean => {
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  return (
    ["EncodingError", "OperationError", "NotSupportedError"].includes(name) ||
    /encod|buffer has no frame|codec|configure/i.test(message)
  );
};

/**
 * 動画の書き出しを、サーバーではなく利用者のブラウザ内で行う(@remotion/web-renderer)。
 * サーバー(Render無料プラン、メモリ512MB)でヘッドレスChromeを使って書き出すと、38秒の動画でも
 * 実メモリが最大約1.5GBになりサーバーごと落ちていた(解像度を下げてもほぼ減らなかった)。
 * ブラウザで書き出せばサーバーのメモリを使わないため、プランを上げずに済む。
 * 戻り値の形はサーバー書き出し(useRenderJob)と揃え、同じRenderPanelで表示できるようにしている。
 */
export const useWebRender = () => {
  const [renderState, setRenderState] = useState<RenderState>({ status: "idle" });
  const [result, setResult] = useState<WebRenderResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const pushLog = (message: string) =>
    setLogs((prev) => (prev[prev.length - 1] === message ? prev : [...prev, message].slice(-20)));

  useEffect(() => {
    const isRunning = renderState.status === "starting" || renderState.status === "rendering";
    if (!isRunning || startedAt === null) return;
    const timer = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [renderState.status, startedAt]);

  // 画面を離れたら書き出しを止め、作った動画のURLも解放する。
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    []
  );

  const handleRender = async (props: StandardVideoProps, fileName: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setResult(null);
    setLogs([]);
    setStartedAt(Date.now());
    setElapsedSeconds(0);
    setRenderState({ status: "starting", message: "このブラウザで書き出せるか確認中..." });
    pushLog("このブラウザで書き出せるか確認中...");

    // 書き出しは端末の中で進むため、iPhone等で画面が暗くなって止まらないようにする(対応ブラウザのみ)。
    let wakeLock: { release: () => Promise<void> } | null = null;
    try {
      wakeLock = await (navigator as Navigator & {
        wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
      }).wakeLock?.request("screen") ?? null;
    } catch {
      // 画面ロック防止が使えなくても書き出し自体はできる
    }

    try {
      // 書き出し用ライブラリ(WebCodecs・音声エンコーダー一式)は大きいため、画面を開いた時点では
      // 読み込まず、実際に書き出す時にだけ読み込む(書き出し画面の表示を軽くするため)。
      const { canRenderMediaOnWeb, renderMediaOnWeb } = await import("@remotion/web-renderer");
      const check = await canRenderMediaOnWeb({
        container: "mp4",
        videoCodec: "h264",
        audioCodec: "aac",
        width: VIDEO_WIDTH,
        height: VIDEO_HEIGHT,
      });
      if (!check.canRender) {
        const reasons = check.issues
          .filter((issue) => issue.severity === "error")
          .map((issue) => ISSUE_LABELS[issue.type] ?? issue.message);
        throw new Error(
          `${reasons.join(" / ") || "このブラウザでは書き出せません"}。最新のSafariかChromeでお試しください`
        );
      }

      let rendered: Awaited<ReturnType<typeof renderMediaOnWeb>> | null = null;
      for (const [index, fallback] of RENDER_FALLBACKS.entries()) {
        const attemptLabel =
          index === 0 ? "フレームを描画中..." : `${fallback.label}でもう一度書き出し中...(${index + 1}/${RENDER_FALLBACKS.length})`;
        setRenderState({ status: "rendering", progress: 0, message: attemptLabel });
        pushLog(
          index === 0
            ? "フレームを描画中...(書き出しが終わるまでこの画面を開いたままにしてください)"
            : `うまく書き出せなかったため、${fallback.label}で自動的にやり直しています(${index + 1}/${RENDER_FALLBACKS.length})`
        );
        try {
          rendered = await renderMediaOnWeb({
            composition: {
              component: StandardVideo,
              id: "Standard",
              width: VIDEO_WIDTH,
              height: VIDEO_HEIGHT,
              fps: VIDEO_FPS,
              durationInFrames: getStandardVideoDurationInFrames(props),
              defaultProps: props,
            },
            inputProps: props,
            container: "mp4",
            videoCodec: "h264",
            audioCodec: check.resolvedAudioCodec ?? "aac",
            signal: controller.signal,
            // Remotionの無料ライセンス(個人・少人数の会社)の対象なら "free-license" を、
            // 会社ライセンスを持っていればそのキーを環境変数で渡す(未設定でも書き出しはできる)。
            licenseKey: process.env.NEXT_PUBLIC_REMOTION_LICENSE_KEY || null,
            ...fallback.options,
            onProgress: ({ progress }) => {
              setRenderState({ status: "rendering", progress, message: attemptLabel });
            },
          });
          break;
        } catch (error) {
          if (controller.signal.aborted) throw error;
          // 設定を変えても直らない種類のエラー(元の動画が読めない等)や、最後の設定でも失敗した時はやり直さない。
          if (!isEncoderError(error) || index === RENDER_FALLBACKS.length - 1) throw error;
          console.warn(`[useWebRender] ${fallback.label}で書き出しに失敗したため、設定を変えてやり直します`, error);
        }
      }
      if (!rendered) throw new Error("書き出しに失敗しました");

      pushLog("書き出したファイルをまとめています...");
      const blob = await rendered.getBlob();
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      setResult({ blob, fileName });
      pushLog("完了しました");
      setRenderState({ status: "done", url });
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error("[useWebRender] 書き出しに失敗しました", error);
      const rawMessage = error instanceof Error ? error.message : "";
      // 英語のエラーをそのまま出しても何をすればいいか分からないため、起きたことと、やり直し方を案内する
      // (元のエラーは上でconsoleに残している)。
      const message = rawMessage.includes("could not be decoded")
        ? // 変換処理(prepareVideoFile.ts)を入れる前にアップロードされたHEVC等の動画だと、ここで止まる。
          "元の動画をこのブラウザで読み込めませんでした。お手数ですが、最初の画面から動画をアップロードし直してください(どの端末でも使える形式に自動で変換されます)。"
        : isEncoderError(error)
          ? "この端末では動画をうまく作れませんでした(設定を変えて何度かやり直しましたが、だめでした)。ほかのアプリやタブを閉じてからもう一度お試しいただくか、パソコンのChromeでお試しください。"
          : toFriendlyErrorMessage(
              error,
              "書き出しの途中で問題が起きました。この画面を開き直して、もう一度お試しください。"
            );
      pushLog(`エラー: ${message}`);
      setRenderState({ status: "error", message });
    } finally {
      await wakeLock?.release().catch(() => {});
    }
  };

  return { renderState, result, logs, elapsedSeconds, handleRender };
};
