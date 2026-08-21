"use client";

import type { RenderState } from "./useRenderJob";

type Props = {
  canRender: boolean;
  renderState: RenderState;
  onRender: () => void;
};

export const RenderPanel: React.FC<Props> = ({ canRender, renderState, onRender }) => {
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onRender}
        disabled={!canRender || renderState.status === "rendering"}
        className="btn-outline flex h-14 items-center justify-center px-6 text-base font-semibold"
      >
        {renderState.status === "rendering"
          ? `レンダー中... ${Math.round(renderState.progress * 100)}%`
          : "動画を書き出す"}
      </button>

      {renderState.status === "rendering" ? (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full"
          style={{ background: "var(--background-elevated-2)" }}
        >
          <div
            className="h-full rounded-full transition-[width]"
            style={{
              width: `${Math.round(renderState.progress * 100)}%`,
              background: "var(--foreground)",
            }}
          />
        </div>
      ) : null}

      {renderState.status === "error" ? (
        <p className="badge-pill danger w-fit">{renderState.message}</p>
      ) : null}

      {renderState.status === "done" ? (
        <div className="panel flex flex-col gap-3 p-5">
          <video
            src={renderState.url}
            controls
            className="w-full max-w-xs self-center rounded-lg"
            style={{ border: "1px solid var(--border-strong)" }}
          />
          <a href={renderState.url} download className="btn-primary flex h-11 items-center justify-center text-sm">
            ダウンロード
          </a>
        </div>
      ) : null}
    </div>
  );
};
