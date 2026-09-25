"use client";

import { useEffect, useRef, useState } from "react";
import { StandardVideo } from "@video/templates/standard/StandardVideo";
import { getStandardVideoDurationInFrames } from "@video/templates/standard/duration";
import type { StandardVideoProps } from "@video/templates/standard/schema";
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "@video/shared/constants";
import type { RenderState } from "./useRenderJob";

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

      setRenderState({ status: "rendering", progress: 0, message: "フレームを描画中..." });
      pushLog("フレームを描画中...(書き出しが終わるまでこの画面を開いたままにしてください)");
      const rendered = await renderMediaOnWeb({
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
        onProgress: ({ progress }) => {
          setRenderState({ status: "rendering", progress, message: "フレームを描画中..." });
        },
      });

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
      const rawMessage = error instanceof Error ? error.message : "書き出しに失敗しました";
      // 変換処理(prepareVideoFile.ts)を入れる前にアップロードされたHEVC等の動画だと、ここで止まる。
      // 英語のままだと何をすればいいか分からないため、やり直し方を案内する。
      const message = rawMessage.includes("could not be decoded")
        ? "元の動画をこのブラウザで読み込めませんでした。お手数ですが、最初の画面から動画をアップロードし直してください(どの端末でも使える形式に自動で変換されます)。"
        : rawMessage;
      pushLog(`エラー: ${message}`);
      setRenderState({ status: "error", message });
    } finally {
      await wakeLock?.release().catch(() => {});
    }
  };

  return { renderState, result, logs, elapsedSeconds, handleRender };
};
