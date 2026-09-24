"use client";

import { useEffect, useRef, useState } from "react";
import type { TemplateId } from "@video/templates/registry";

const POLL_INTERVAL_MS = 1000;

/**
 * サーバーがメモリ不足等で落ちて再起動している間は、Render等のホスティング側がJSONではない
 * エラーページを返す。そのままres.json()すると、Safariでは"The string did not match the expected
 * pattern."という何のことか分からないエラーになるため、JSONでなければ状況が分かる言葉に置き換える。
 */
type RenderApiResponse = {
  status?: string;
  message?: string;
  url?: string;
  error?: string;
  jobId?: string;
  issues?: unknown;
};

const readJson = async (res: Response): Promise<RenderApiResponse> => {
  const text = await res.text();
  try {
    return JSON.parse(text) as RenderApiResponse;
  } catch {
    throw new Error(
      `サーバーから正しい応答がありませんでした(HTTP ${res.status})。サーバーが再起動した可能性があるので、少し待ってからもう一度お試しください`
    );
  }
};

export type RenderState =
  | { status: "idle" }
  | { status: "starting"; message: string }
  | { status: "rendering"; progress: number; message: string }
  | { status: "done"; url: string }
  | { status: "error"; message: string };

export const useRenderJob = () => {
  const [renderState, setRenderState] = useState<RenderState>({ status: "idle" });
  /** 進行中のステージメッセージの履歴(直近のものを末尾に追加、簡易ログとして表示する)。 */
  const [logs, setLogs] = useState<string[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const lastMessageRef = useRef<string | null>(null);

  const pushLog = (message: string) => {
    if (lastMessageRef.current === message) return;
    lastMessageRef.current = message;
    setLogs((prev) => [...prev, message].slice(-20));
  };

  useEffect(() => {
    const isRunning = renderState.status === "starting" || renderState.status === "rendering";
    if (!isRunning || startedAt === null) return;
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [renderState.status, startedAt]);

  const pollJob = (jobId: string) => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/render/${jobId}`);
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.error ?? "状態取得に失敗しました");

        if (data.status === "starting" || data.status === "rendering") {
          pushLog(data.message ?? "処理中...");
          setRenderState(data as RenderState);
          return;
        }

        clearInterval(timer);
        if (data.status === "done") {
          pushLog("完了しました");
          setRenderState({ status: "done", url: data.url ?? "" });
        } else {
          const message = data.message ?? "レンダーに失敗しました";
          pushLog(`エラー: ${message}`);
          setRenderState({ status: "error", message });
        }
      } catch (error) {
        clearInterval(timer);
        const message = error instanceof Error ? error.message : "状態取得に失敗しました";
        pushLog(`エラー: ${message}`);
        setRenderState({ status: "error", message });
      }
    }, POLL_INTERVAL_MS);
  };

  const handleRender = async (templateId: TemplateId, props: unknown) => {
    lastMessageRef.current = null;
    setLogs([]);
    setStartedAt(Date.now());
    setElapsedSeconds(0);
    setRenderState({ status: "starting", message: "レンダーを準備中..." });
    pushLog("レンダーを準備中...");
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, props }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        const issues = Array.isArray(data.issues)
          ? data.issues
              .map((issue: { path?: unknown[]; message?: string }) =>
                `${Array.isArray(issue.path) ? issue.path.join(".") : "?"}: ${issue.message ?? ""}`
              )
              .join(" / ")
          : "";
        const baseMessage = data.error ?? "レンダーの開始に失敗しました";
        throw new Error(issues ? `${baseMessage}(${issues})` : baseMessage);
      }
      if (!data.jobId) throw new Error("レンダーの開始に失敗しました");
      pollJob(data.jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "レンダーの開始に失敗しました";
      pushLog(`エラー: ${message}`);
      setRenderState({ status: "error", message });
    }
  };

  const resetRenderState = () => setRenderState({ status: "idle" });

  return { renderState, logs, elapsedSeconds, handleRender, resetRenderState };
};
