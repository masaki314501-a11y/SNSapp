"use client";

import { stagesFor, type AutoEditProgress } from "@/lib/autoEditProgress";

/**
 * 自動編集の今の段階を、済んだ段階に✓、今の段階に●を付けて並べる。数分かかる間、固まったのではなく
 * 進んでいることが分かるようにする。画像を作っている間は、何枚目かも出す。
 */
export const AutoEditProgressList: React.FC<{ progress: AutoEditProgress | null; isRevision: boolean }> = ({
  progress,
  isRevision,
}) => {
  const stages = stagesFor(isRevision);
  // サーバーから段階が届くまでは、最初の段階にいるものとして出す
  const currentIndex = Math.max(0, stages.findIndex((entry) => entry.stage === progress?.stage));
  return (
    <ol className="my-1 flex flex-col gap-1.5">
      {stages.map((entry, index) => {
        const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "todo";
        const count =
          entry.stage === "images" && state === "current" && progress?.total ? `(${progress.done ?? 0}/${progress.total}枚)` : "";
        return (
          <li
            key={entry.stage}
            className="flex items-center gap-2 text-sm"
            style={{ color: state === "todo" ? "var(--muted-2)" : undefined, fontWeight: state === "current" ? 700 : 400 }}
          >
            <span
              aria-hidden
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs"
              style={{
                background: state === "done" ? "var(--accent)" : state === "current" ? "var(--accent-soft)" : "transparent",
                color: state === "done" ? "#fff" : "var(--accent)",
                border: state === "todo" ? "1px solid var(--border)" : state === "current" ? "2px solid var(--accent)" : "none",
              }}
            >
              {state === "done" ? "✓" : state === "current" ? "●" : ""}
            </span>
            <span>
              {entry.label}
              {count}
            </span>
            <span className="sr-only">{state === "done" ? "(済み)" : state === "current" ? "(実行中)" : ""}</span>
          </li>
        );
      })}
    </ol>
  );
};
