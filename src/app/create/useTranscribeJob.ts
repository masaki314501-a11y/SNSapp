"use client";

import { useState } from "react";
import { withGeminiApiKeyHeader } from "@/lib/geminiApiKeyClient";

const POLL_INTERVAL_MS = 1000;

export type TranscribedSegment = {
  startFromSeconds: number;
  durationInSeconds: number;
  caption: string;
};

export type TranscribeJobState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "processing" }
  | { status: "generating" }
  | { status: "done"; segments: TranscribedSegment[] }
  | { status: "error"; message: string };

export const useTranscribeJob = (options?: {
  onDone?: (segments: TranscribedSegment[]) => void;
}) => {
  const [transcribeState, setTranscribeState] = useState<TranscribeJobState>({
    status: "idle",
  });

  const pollJob = (jobId: string) => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/transcribe-captions/${jobId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "状態取得に失敗しました");

        if (data.status === "done" || data.status === "error") {
          clearInterval(timer);
        }
        setTranscribeState(data as TranscribeJobState);
        if (data.status === "done") {
          options?.onDone?.(data.segments as TranscribedSegment[]);
        }
      } catch (error) {
        clearInterval(timer);
        setTranscribeState({
          status: "error",
          message: error instanceof Error ? error.message : "状態取得に失敗しました",
        });
      }
    }, POLL_INTERVAL_MS);
  };

  const handleTranscribe = async (
    videoPath: string,
    videoDurationInSeconds: number
  ) => {
    setTranscribeState({ status: "uploading" });
    try {
      const res = await fetch("/api/transcribe-captions", {
        method: "POST",
        headers: withGeminiApiKeyHeader({ "Content-Type": "application/json" }),
        body: JSON.stringify({ videoPath, videoDurationInSeconds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "文字起こしの開始に失敗しました");
      pollJob(data.jobId);
    } catch (error) {
      setTranscribeState({
        status: "error",
        message:
          error instanceof Error ? error.message : "文字起こしの開始に失敗しました",
      });
    }
  };

  const resetTranscribeState = () => setTranscribeState({ status: "idle" });

  return { transcribeState, handleTranscribe, resetTranscribeState };
};
