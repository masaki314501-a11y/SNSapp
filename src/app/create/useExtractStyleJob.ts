"use client";

import { useState } from "react";
import type { CaptionAnimation, CaptionFontFamily, CaptionPosition, CaptionStyle } from "@video/shared/schema";

const POLL_INTERVAL_MS = 1000;

export type ExtractedStyle = {
  primaryColor: string;
  fontFamily: CaptionFontFamily;
  captionPosition: CaptionPosition;
  captionStyle: CaptionStyle;
  captionAnimation: CaptionAnimation;
};

export type ExtractStyleJobState =
  | { status: "idle" }
  | { status: "processing" }
  | ({ status: "done" } & ExtractedStyle)
  | { status: "error"; message: string };

export const useExtractStyleJob = (options?: { onDone?: (style: ExtractedStyle) => void }) => {
  const [extractStyleState, setExtractStyleState] = useState<ExtractStyleJobState>({
    status: "idle",
  });

  const pollJob = (jobId: string) => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/extract-style/${jobId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "状態取得に失敗しました");

        if (data.status === "done" || data.status === "error") {
          clearInterval(timer);
        }
        setExtractStyleState(data as ExtractStyleJobState);
        if (data.status === "done") {
          options?.onDone?.(data as ExtractedStyle);
        }
      } catch (error) {
        clearInterval(timer);
        setExtractStyleState({
          status: "error",
          message: error instanceof Error ? error.message : "状態取得に失敗しました",
        });
      }
    }, POLL_INTERVAL_MS);
  };

  /** 参考画像からスタイルを抽出する。 */
  const handleExtractStyle = async (file: File) => {
    setExtractStyleState({ status: "processing" });
    try {
      const body = new FormData();
      body.set("image", file);
      const res = await fetch("/api/extract-style", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "スタイル抽出の開始に失敗しました");
      pollJob(data.jobId);
    } catch (error) {
      setExtractStyleState({
        status: "error",
        message: error instanceof Error ? error.message : "スタイル抽出の開始に失敗しました",
      });
    }
  };

  /**
   * 参考動画(アップロード済み・videoPathで参照)からスタイルを抽出する。動画は静止画と違い
   * テロップの出現演出まで観察できるため、captionAnimationの精度が上がる。
   */
  const handleExtractStyleFromVideo = async (videoPath: string) => {
    setExtractStyleState({ status: "processing" });
    try {
      const res = await fetch("/api/extract-style-from-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "スタイル抽出の開始に失敗しました");
      pollJob(data.jobId);
    } catch (error) {
      setExtractStyleState({
        status: "error",
        message: error instanceof Error ? error.message : "スタイル抽出の開始に失敗しました",
      });
    }
  };

  const resetExtractStyleState = () => setExtractStyleState({ status: "idle" });

  return { extractStyleState, handleExtractStyle, handleExtractStyleFromVideo, resetExtractStyleState };
};
