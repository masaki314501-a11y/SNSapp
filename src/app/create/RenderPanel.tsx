"use client";

import type { RenderState } from "./useRenderJob";

type Props = {
  canRender: boolean;
  renderState: RenderState;
  onRender: () => void;
};

export const RenderPanel: React.FC<Props> = ({ canRender, renderState, onRender }) => {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onRender}
        disabled={!canRender || renderState.status === "rendering"}
        className="rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background transition-colors disabled:opacity-40"
      >
        {renderState.status === "rendering"
          ? `レンダー中... ${Math.round(renderState.progress * 100)}%`
          : "動画を書き出す"}
      </button>

      {renderState.status === "rendering" ? (
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-foreground transition-[width]"
            style={{ width: `${Math.round(renderState.progress * 100)}%` }}
          />
        </div>
      ) : null}

      {renderState.status === "error" ? (
        <p className="text-sm text-red-500">{renderState.message}</p>
      ) : null}

      {renderState.status === "done" ? (
        <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <video
            src={renderState.url}
            controls
            className="w-full max-w-xs self-center rounded-lg"
          />
          <a href={renderState.url} download className="text-center text-sm underline">
            ダウンロード
          </a>
        </div>
      ) : null}
    </div>
  );
};
