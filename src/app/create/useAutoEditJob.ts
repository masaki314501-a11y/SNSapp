"use client";

import { useState } from "react";
import type { CaptionFontFamily, CaptionPosition, CaptionStyle } from "@video/shared/schema";
import type { ProjectSegment, ProjectSfxClip, VideoProject } from "@/lib/videoProject";
import { toFriendlyErrorMessage } from "@/lib/friendlyError";

const POLL_INTERVAL_MS = 1000;

export type AutoEditPlanSummary = {
  summary: string;
  /** 参考スクショ/動画から読み取った編集の癖。参考が無ければnull。 */
  referenceNotes: string | null;
  theme: {
    primaryColor?: string;
    fontFamily?: CaptionFontFamily;
    captionPosition?: CaptionPosition;
    captionStyle?: CaptionStyle;
  };
  hook: VideoProject["hook"];
  cta: VideoProject["cta"];
  globalOverlays: NonNullable<VideoProject["globalOverlays"]>;
  globalImages: NonNullable<VideoProject["globalImages"]>;
  /** AIが作って使った画像の枚数(種類)。 */
  generatedImageCount: number;
};

export type AutoEditJobState =
  | { status: "idle" }
  /** usedStyleReferenceCount: サーバー上に見つかって手本にできた参考の数(渡した数より少なければ消えていた分がある)。 */
  /** usedMaterialImageCount: 同じく、サーバー上に見つかって使えた画像の数。 */
  | { status: "processing"; usedStyleReferenceCount: number | null; usedMaterialImageCount: number | null }
  | { status: "done"; plan: AutoEditPlanSummary; segments: ProjectSegment[]; generatedClips: ProjectSfxClip[] }
  | { status: "error"; message: string };

export type AutoEditRequest = {
  videoPath: string;
  videoDurationInSeconds: number;
  keepRanges: { startFromSeconds: number; durationInSeconds: number }[];
  styleReferencePaths: string[];
  /** editTemplates.tsのid。nullならテンプレート無し(おまかせ)。 */
  templateId: string | null;
  /** 自動編集で使ってよい画像。 */
  materialImages: { path: string; name: string }[];
  /** 使える画像が足りない所に、AIに画像を作らせてよいか。 */
  generateMissingImages: boolean;
};

/** 自動編集(Geminiに編集をすべて任せる)ジョブの開始+ポーリング。 */
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
          setAutoEditState(data as AutoEditJobState);
        }
      } catch (error) {
        clearInterval(timer);
        setAutoEditState({
          status: "error",
          message: toFriendlyErrorMessage(error, "状態取得に失敗しました"),
        });
      }
    }, POLL_INTERVAL_MS);
  };

  const handleStart = async (request: AutoEditRequest) => {
    setAutoEditState({ status: "processing", usedStyleReferenceCount: null, usedMaterialImageCount: null });
    try {
      const res = await fetch("/api/auto-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "自動編集の開始に失敗しました");
      // 参考スクショがサーバー側で見つからなかった(再起動で消えた等)場合は、手本無しで進んでいることを表示する。
      setAutoEditState({
        status: "processing",
        usedStyleReferenceCount: Number(data.usedStyleReferenceCount ?? 0),
        usedMaterialImageCount: Number(data.usedMaterialImageCount ?? 0),
      });
      pollJob(data.jobId);
    } catch (error) {
      setAutoEditState({
        status: "error",
        message: toFriendlyErrorMessage(error, "自動編集の開始に失敗しました"),
      });
    }
  };

  return { autoEditState, handleStart };
};
