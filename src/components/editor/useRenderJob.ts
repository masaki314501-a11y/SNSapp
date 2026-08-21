"use client";

import { useState } from "react";
import type { TemplateId } from "@video/templates/registry";

const POLL_INTERVAL_MS = 1000;

export type RenderState =
  | { status: "idle" }
  | { status: "rendering"; progress: number }
  | { status: "done"; url: string }
  | { status: "error"; message: string };

export const useRenderJob = () => {
  const [renderState, setRenderState] = useState<RenderState>({ status: "idle" });

  const pollJob = (jobId: string) => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/render/${jobId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "状態取得に失敗しました");

        if (data.status === "rendering") {
          setRenderState({ status: "rendering", progress: data.progress });
          return;
        }

        clearInterval(timer);
        if (data.status === "done") {
          setRenderState({ status: "done", url: data.url });
        } else {
          setRenderState({
            status: "error",
            message: data.message ?? "レンダーに失敗しました",
          });
        }
      } catch (error) {
        clearInterval(timer);
        setRenderState({
          status: "error",
          message:
            error instanceof Error ? error.message : "状態取得に失敗しました",
        });
      }
    }, POLL_INTERVAL_MS);
  };

  const handleRender = async (templateId: TemplateId, props: unknown) => {
    setRenderState({ status: "rendering", progress: 0 });
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, props }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "レンダーの開始に失敗しました");
      pollJob(data.jobId);
    } catch (error) {
      setRenderState({
        status: "error",
        message:
          error instanceof Error ? error.message : "レンダーの開始に失敗しました",
      });
    }
  };

  const resetRenderState = () => setRenderState({ status: "idle" });

  return { renderState, handleRender, resetRenderState };
};
