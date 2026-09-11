"use client";

import type { RenderState } from "./useRenderJob";

type Props = {
  canRender: boolean;
  renderState: RenderState;
  logs: string[];
  elapsedSeconds: number;
  onRender: () => void;
};

export const RenderPanel: React.FC<Props> = ({
  canRender,
  renderState,
  logs,
  elapsedSeconds,
  onRender,
}) => {
  const isRunning = renderState.status === "starting" || renderState.status === "rendering";
  const progress = renderState.status === "rendering" ? renderState.progress : 0;
  const stageMessage =
    renderState.status === "starting"
      ? renderState.message
      : renderState.status === "rendering"
        ? renderState.message
        : null;
  // 進捗が数%進むまでは経過時間からの推定が暴れやすいため、ある程度進んでから表示する。
  const etaSeconds =
    renderState.status === "rendering" && progress > 0.05 && elapsedSeconds > 0
      ? Math.max(0, Math.round((elapsedSeconds / progress) * (1 - progress)))
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
            <span className="tabular-nums">
              {elapsedSeconds}秒経過{etaSeconds !== null ? `・残り約${etaSeconds}秒` : ""}
            </span>
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
            <a
              href={renderState.url}
              download
              className="btn-primary flex h-11 flex-1 items-center justify-center text-sm"
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
