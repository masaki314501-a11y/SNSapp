"use client";

import { useState } from "react";
import type { CaptionAnimation, CaptionFontFamily, CaptionPosition, CaptionStyle } from "@video/shared/schema";
import { withGeminiApiKeyHeader } from "@/lib/geminiApiKeyClient";

const POLL_INTERVAL_MS = 1000;

export type AutoEditSegmentPlan = {
  key: string;
  captionAnimation?: CaptionAnimation;
  addNarration: boolean;
  sfxPresetId: string | null;
};

export type AutoEditPlan = {
  segments: AutoEditSegmentPlan[];
  theme?: {
    primaryColor?: string;
    fontFamily?: CaptionFontFamily;
    captionPosition?: CaptionPosition;
    captionStyle?: CaptionStyle;
  };
  summary: string;
};

export type AutoEditGeneratedClip = {
  key: string;
  src: string;
  label: string;
  startFromSeconds: number;
  volume: number;
  narrationSegmentKey?: string;
};

export type AutoEditJobState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "done"; plan: AutoEditPlan; generatedClips: AutoEditGeneratedClip[] }
  | { status: "error"; message: string };

export type AutoEditThemeInput = {
  primaryColor: string;
  fontFamily: CaptionFontFamily;
  captionPosition: CaptionPosition;
  captionStyle: CaptionStyle;
  captionAnimation: CaptionAnimation;
};

/** 字幕生成後・手動編集前に割り込む自動編集(バズる動画)機能のジョブ開始+ポーリング。 */
export const useAutoEditJob = () => {
  const [autoEditState, setAutoEditState] = useState<AutoEditJobState>({ status: "idle" });

  const pollJob = (jobId: string) => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/auto-edit/${jobId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "状態取得に失敗しました");

        if (data.status === "done" || data.status === "error") {
          clearInterval(timer);
        }
        setAutoEditState(data as AutoEditJobState);
      } catch (error) {
        clearInterval(timer);
        setAutoEditState({
          status: "error",
          message: error instanceof Error ? error.message : "状態取得に失敗しました",
        });
      }
    }, POLL_INTERVAL_MS);
  };

  const handleStart = async (
    segments: { key: string; caption: string; durationInSeconds: number }[],
    theme: AutoEditThemeInput,
    hasStyleReference: boolean
  ) => {
    setAutoEditState({ status: "processing" });
    try {
      const res = await fetch("/api/auto-edit", {
        method: "POST",
        headers: withGeminiApiKeyHeader({ "Content-Type": "application/json" }),
        body: JSON.stringify({ segments, theme, hasStyleReference }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "自動編集の開始に失敗しました");
      pollJob(data.jobId);
    } catch (error) {
      setAutoEditState({
        status: "error",
        message: error instanceof Error ? error.message : "自動編集の開始に失敗しました",
      });
    }
  };

  return { autoEditState, handleStart };
};
