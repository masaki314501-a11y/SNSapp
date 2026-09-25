"use client";

import { useState } from "react";
import type { EditableState, ReviseEditResult } from "@/lib/gemini/reviseEdit";

const POLL_INTERVAL_MS = 1000;

type ReviseState =
  | { status: "idle" }
  | { status: "processing" }
  | ({ status: "done" } & ReviseEditResult)
  | { status: "error"; message: string };

type Props = {
  /** 送信時点の編集内容。クリップ・効果音のidは今の並び順の番号。 */
  buildState: () => EditableState;
  videoDurationInSeconds: number;
  /** 選択中クリップの番号(0始まり)と、その字幕の一部(依頼欄に表示する)。 */
  selectedClip: { id: number; label: string } | null;
  onApply: (result: ReviseEditResult) => void;
  canUndo: boolean;
  onUndo: () => void;
};

/**
 * 編集画面の「AIに修正を頼む」欄。「3つ目の強調テキストをもっと大きく」「冒頭をもっと煽って」の
 * ような文章の依頼をGeminiに渡し、直した編集内容と変更点の一覧を受け取る。勝手に書き換えず、
 * 変更点を見てから「反映する」を押した時だけ反映する(反映後も1回ぶん元に戻せる)。
 */
export const AiRevisePanel: React.FC<Props> = ({
  buildState,
  videoDurationInSeconds,
  selectedClip,
  onApply,
  canUndo,
  onUndo,
}) => {
  const [instruction, setInstruction] = useState("");
  const [aboutSelected, setAboutSelected] = useState(true);
  const [state, setState] = useState<ReviseState>({ status: "idle" });

  const poll = (jobId: string) => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/revise-edit/${jobId}`);
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) throw new Error(data?.error ?? "状態の取得に失敗しました");
        if (data.status === "processing") return;
        clearInterval(timer);
        setState(data as ReviseState);
      } catch (error) {
        clearInterval(timer);
        setState({ status: "error", message: error instanceof Error ? error.message : "状態の取得に失敗しました" });
      }
    }, POLL_INTERVAL_MS);
  };

  const submit = async () => {
    if (!instruction.trim()) return;
    setState({ status: "processing" });
    try {
      const res = await fetch("/api/revise-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: instruction.trim(),
          selectedClipId: aboutSelected && selectedClip ? selectedClip.id : null,
          videoDurationInSeconds,
          state: buildState(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.jobId) throw new Error(data?.error ?? "AIへの依頼に失敗しました");
      poll(data.jobId);
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "AIへの依頼に失敗しました" });
    }
  };

  return (
    <div className="panel flex flex-col gap-2 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">🤖 AIに頼む(演出を足す・直す)</h2>
        {canUndo ? (
          <button type="button" className="editor-toolbar-btn" onClick={onUndo}>
            直前のAI修正を元に戻す
          </button>
        ) : null}
      </div>
      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        rows={2}
        placeholder="例: 2つ目のクリップに「ここ重要!」って大きく出して / 3つ目の強調テキストをもっと大きく赤に / 冒頭の見出しをもっと煽って / 効果音を半分に減らして"
        className="w-full rounded-lg p-2 text-sm"
        style={{ border: "1.5px solid var(--border-strong)", background: "var(--background-elevated-2)" }}
      />
      <div className="flex flex-wrap items-center gap-3">
        {selectedClip ? (
          <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--muted)" }}>
            <input type="checkbox" checked={aboutSelected} onChange={(e) => setAboutSelected(e.target.checked)} />
            選択中のクリップ{selectedClip.id + 1}({selectedClip.label})についての依頼として送る
          </label>
        ) : null}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!instruction.trim() || state.status === "processing"}
          className="btn-primary px-4 py-1.5 text-sm"
        >
          {state.status === "processing" ? "AIが修正中..." : "頼む"}
        </button>
      </div>

      {state.status === "error" ? <p className="badge-pill danger w-fit">{state.message}</p> : null}

      {state.status === "done" ? (
        <div className="flex flex-col gap-2 rounded-lg p-3" style={{ border: "1px solid var(--border)" }}>
          <p className="text-xs font-semibold">AIの修正案</p>
          <ul className="flex list-disc flex-col gap-0.5 pl-5 text-xs" style={{ color: "var(--muted)" }}>
            {state.changes.length > 0 ? state.changes.map((change, i) => <li key={i}>{change}</li>) : <li>(変更点の説明なし)</li>}
          </ul>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary px-4 py-1.5 text-sm"
              onClick={() => {
                onApply(state);
                setState({ status: "idle" });
                setInstruction("");
              }}
            >
              反映する
            </button>
            <button type="button" className="btn-outline px-4 py-1.5 text-sm" onClick={() => setState({ status: "idle" })}>
              やめる
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
