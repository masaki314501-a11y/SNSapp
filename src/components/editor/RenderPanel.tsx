"use client";

import type { RenderState } from "./useRenderJob";
import type { WebRenderResult } from "./useWebRender";
import { WaitTime } from "@/components/WaitTime";

type Props = {
  canRender: boolean;
  renderState: RenderState;
  logs: string[];
  /** 書き出す動画の長さ(秒)。進み具合が出るまでの目安の待ち時間に使う。 */
  videoSeconds: number;
  onRender: () => void;
  /** ブラウザ内で書き出した場合の動画本体。iPhoneの共有シートに渡して写真に保存できるようにする。 */
  result?: WebRenderResult | null;
};

/**
 * iPhone/iPadのSafariは<a download>だと「ファイル」アプリに保存され、写真アプリに入らない。
 * 共有シート(Web Share API)にファイルとして渡すと「ビデオを保存」が選べるため、使える環境ではそちらも出す。
 */
const shareVideo = async (result: WebRenderResult) => {
  const file = new File([result.blob], result.fileName, { type: "video/mp4" });
  try {
    await navigator.share({ files: [file] });
  } catch (error) {
    // 共有シートを閉じただけ(AbortError)なら何もしない
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      alert("共有できませんでした。「ダウンロード」から保存してください");
    }
  }
};

const canShareVideo = (result: WebRenderResult | null | undefined): boolean => {
  if (!result || typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  return navigator.canShare({ files: [new File([result.blob], result.fileName, { type: "video/mp4" })] });
};

export const RenderPanel: React.FC<Props> = ({
  canRender,
  renderState,
  logs,
  videoSeconds,
  onRender,
  result,
}) => {
  const isRunning = renderState.status === "starting" || renderState.status === "rendering";
  const progress = renderState.status === "rendering" ? renderState.progress : 0;
  const stageMessage =
    renderState.status === "starting"
      ? renderState.message
      : renderState.status === "rendering"
        ? renderState.message
        : null;

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onRender}
        disabled={!canRender || isRunning}
        className="btn-primary flex h-14 items-center justify-center px-6 text-base"
      >
        {isRunning
          ? renderState.status === "rendering"
            ? `レンダー中... ${Math.round(progress * 100)}%`
            : "準備中..."
          : "動画を書き出す"}
      </button>

      {isRunning ? (
        <div className="flex flex-col gap-2">
          <div className="progress-track">
            <div
              className={`progress-fill${renderState.status === "starting" ? " indeterminate" : ""}`}
              style={renderState.status === "starting" ? undefined : { width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: "var(--muted)" }}>
            <span>{stageMessage}</span>

          </div>
          {logs.length > 0 ? (
            <div className="log-panel">
              {logs.map((line, i) => (
                <span key={i} className={`log-line${i === logs.length - 1 ? " current" : ""}`}>
                  {line}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 進み具合が出るまでは目安(動画の長さと過去の実績から)、出てからは実際の進み方から残り時間を出す。
          終わった時に実績を記録できるよう、書き出し中かどうかに関わらず置いておく(書き出し中だけ表示される) */}
      <WaitTime
        task="render"
        units={videoSeconds}
        active={isRunning}
        failed={renderState.status === "error"}
        progress={renderState.status === "rendering" ? progress : null}
      />

      {renderState.status === "error" ? (
        <div className="flex flex-col gap-2">
          <p className="badge-pill danger w-fit">{renderState.message}</p>
          {logs.length > 0 ? (
            <div className="log-panel">
              {logs.map((line, i) => (
                <span key={i} className={`log-line${i === logs.length - 1 ? " current" : ""}`}>
                  {line}
                </span>
              ))}
            </div>
          ) : null}
          <button type="button" onClick={onRender} disabled={!canRender} className="btn-outline w-fit px-4 py-1.5 text-sm">
            もう一度試す
          </button>
        </div>
      ) : null}

      {renderState.status === "done" ? (
        <div className="panel flex flex-col gap-3 p-5">
          <video
            src={renderState.url}
            controls
            className="w-full max-w-xs self-center rounded-lg"
            style={{ border: "1.5px solid var(--foreground)" }}
          />
          <div className="flex flex-wrap gap-2">
            {result && canShareVideo(result) ? (
              <button
                type="button"
                onClick={() => void shareVideo(result)}
                className="btn-primary flex h-11 flex-1 items-center justify-center text-sm"
              >
                写真に保存・共有
              </button>
            ) : null}
            <a
              href={renderState.url}
              download={result?.fileName ?? true}
              className={`${result && canShareVideo(result) ? "btn-outline" : "btn-primary"} flex h-11 flex-1 items-center justify-center text-sm`}
            >
              ダウンロード
            </a>
            <button type="button" onClick={onRender} className="btn-outline flex h-11 items-center justify-center px-4 text-sm">
              作り直す
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
