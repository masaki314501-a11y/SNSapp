"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_CAPTION_ANIMATION,
  DEFAULT_CAPTION_FONT_FAMILY,
  DEFAULT_CAPTION_FONT_SIZE,
  DEFAULT_CAPTION_POSITION,
  DEFAULT_CAPTION_STYLE,
  DEFAULT_CLIP_VOLUME,
  DEFAULT_FADE_IN_OUT,
  DEFAULT_PRIMARY_COLOR,
  clearProject,
  loadProject,
  saveProject,
  type VideoProject,
} from "@/lib/videoProject";
import { uploadVideoFile } from "./uploadVideoFile";

/**
 * 動画をアップロードする画面(/create)。アップロードが終わると、動画全体を1つの
 * 「使う範囲」としたプロジェクトを保存し、ラフカット画面(/create/cut)へ遷移する。
 * 参考画像からのスタイル抽出・音声からの字幕生成は、カットが終わった後の
 * /create/style が担当する(カットで捨てた範囲は文字起こし対象にしないため)。
 */
const readVideoDurationInSeconds = (file: File): Promise<number> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const videoEl = document.createElement("video");
    videoEl.preload = "metadata";
    videoEl.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(videoEl.duration);
    };
    videoEl.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("動画の長さを取得できませんでした"));
    };
    videoEl.src = url;
  });

export const UploadGenerator: React.FC = () => {
  const router = useRouter();
  /** localStorageに残っていた前回のプロジェクト(あれば編集の再開を案内する)。 */
  const [existingProject] = useState<VideoProject | null>(() => loadProject());

  const [videoPath, setVideoPath] = useState("");
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoUploadPercent, setVideoUploadPercent] = useState(0);
  const [videoDurationInSeconds, setVideoDurationInSeconds] = useState<number | null>(null);

  const canProceed = Boolean(videoPath) && videoDurationInSeconds !== null && !videoUploading;

  const handleVideoFileChange = async (file: File | null) => {
    if (!file) return;
    setVideoUploading(true);
    setVideoUploadPercent(0);
    setVideoFileName(file.name);
    setVideoDurationInSeconds(null);
    setVideoPath("");

    readVideoDurationInSeconds(file)
      .then((duration) => setVideoDurationInSeconds(duration))
      .catch(() => setVideoDurationInSeconds(null));

    try {
      const path = await uploadVideoFile(file, setVideoUploadPercent);
      setVideoPath(path);
    } catch (error) {
      alert(error instanceof Error ? error.message : "アップロードに失敗しました");
    } finally {
      setVideoUploading(false);
    }
  };

  const handleDiscardExisting = () => {
    clearProject();
    window.location.reload();
  };

  const handleGoToCut = () => {
    if (!canProceed || videoDurationInSeconds === null) return;
    saveProject({
      videoPath,
      videoFileName,
      videoDurationInSeconds,
      primaryColor: DEFAULT_PRIMARY_COLOR,
      captionStyle: DEFAULT_CAPTION_STYLE,
      fontFamily: DEFAULT_CAPTION_FONT_FAMILY,
      captionPosition: DEFAULT_CAPTION_POSITION,
      fontSize: DEFAULT_CAPTION_FONT_SIZE,
      fadeInOut: DEFAULT_FADE_IN_OUT,
      // 最初は動画全体を1つの「使う範囲」として渡す。ラフカット画面で分割・削除して絞り込む。
      segments: [
        {
          key: crypto.randomUUID(),
          caption: "",
          startFromSeconds: 0,
          durationInSeconds: videoDurationInSeconds,
          captionAnimation: DEFAULT_CAPTION_ANIMATION,
          volume: DEFAULT_CLIP_VOLUME,
        },
      ],
      sfx: [],
      bgm: null,
    });
    router.push("/create/cut");
  };

  return (
    <div className="flex flex-col gap-4">
      {existingProject ? (
        <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">前回の編集内容が残っています</span>
            <span className="text-xs" style={{ color: "var(--muted-2)" }}>
              {existingProject.videoFileName ?? "動画"}・クリップ{existingProject.segments.length}
              個・{existingProject.videoDurationInSeconds.toFixed(1)}秒
            </span>
          </div>
          <div className="flex gap-2">
            <a href="/edit" className="btn-primary px-4 py-1.5 text-sm">
              編集を再開する →
            </a>
            <button type="button" onClick={handleDiscardExisting} className="btn-ghost text-sm">
              破棄して新しくはじめる
            </button>
          </div>
        </div>
      ) : null}

      <div className="panel flex flex-col gap-3 p-5">
        <div className="flex items-baseline gap-2.5">
          <span className="step-badge">1</span>
          <h2 className="text-sm font-semibold">動画をアップロード</h2>
          <span className="text-xs" style={{ color: "var(--muted-2)" }}>
            1本のみ
          </span>
        </div>
        <label className="upload-drop flex flex-col gap-2 p-4">
          <span className="field-label">編集する動画ファイル(実際の長さを自動検出)</span>
          <input
            type="file"
            accept="video/*"
            onChange={(e) => handleVideoFileChange(e.target.files?.[0] ?? null)}
          />
          {videoUploading ? (
            <div className="flex flex-col gap-1.5">
              <span className="badge-pill warning w-fit">
                {videoUploadPercent < 100 ? `アップロード中... ${videoUploadPercent}%` : "保存中..."}
              </span>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${videoUploadPercent}%` }} />
              </div>
            </div>
          ) : videoFileName ? (
            <span className="badge-pill success w-fit">
              {videoFileName}
              {videoDurationInSeconds ? `(${videoDurationInSeconds.toFixed(1)}秒)` : ""}
            </span>
          ) : (
            <span className="text-xs" style={{ color: "var(--muted-2)" }}>
              未アップロード
            </span>
          )}
        </label>
        <button
          type="button"
          onClick={handleGoToCut}
          disabled={!canProceed}
          className="btn-primary self-start px-4 py-2 text-sm"
        >
          使う範囲を選ぶ(カット)へ進む →
        </button>
      </div>
    </div>
  );
};
