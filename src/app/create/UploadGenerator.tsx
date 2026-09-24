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
 * 参考画像からのスタイル抽出・自動編集・字幕の一括生成は、カットが終わった後の
 * 画面(/create/style → /create/auto-edit → /edit)が担当する(カットで捨てた範囲は対象にしないため)。
 */
const readVideoDurationInSeconds = (file: File): Promise<number> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const videoEl = document.createElement("video");
    videoEl.preload = "metadata";
    const cleanup = () => URL.revokeObjectURL(url);
    const finish = (duration: number) => {
      cleanup();
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error("動画の長さを取得できませんでした"));
        return;
      }
      resolve(duration);
    };
    videoEl.onloadedmetadata = () => {
      // Safari(iOS/iPadOS)は一部のmov/mp4でdurationが最初Infinityのまま
      // 確定しないことがある。末尾付近にシークするとdurationchangeで
      // 実際の長さが取得できるため、その場合だけ追加で待つ。
      if (!Number.isFinite(videoEl.duration)) {
        videoEl.ontimeupdate = () => {
          videoEl.ontimeupdate = null;
          finish(videoEl.duration);
        };
        videoEl.currentTime = Number.MAX_SAFE_INTEGER;
        return;
      }
      finish(videoEl.duration);
    };
    videoEl.onerror = () => {
      cleanup();
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
  const [durationError, setDurationError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const canProceed = Boolean(videoPath) && videoDurationInSeconds !== null && !videoUploading;

  const detectDuration = (file: File) => {
    setDurationError(null);
    readVideoDurationInSeconds(file)
      .then((duration) => setVideoDurationInSeconds(duration))
      .catch((error) => {
        setVideoDurationInSeconds(null);
        setDurationError(error instanceof Error ? error.message : "動画の長さを取得できませんでした");
      });
  };

  const handleVideoFileChange = async (file: File | null) => {
    if (!file) return;
    setVideoUploading(true);
    setVideoUploadPercent(0);
    setVideoFileName(file.name);
    setVideoDurationInSeconds(null);
    setVideoPath("");
    setPendingFile(file);

    detectDuration(file);

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
            <div className="flex flex-col gap-1.5">
              <span className="badge-pill success w-fit">
                {videoFileName}
                {videoDurationInSeconds ? `(${videoDurationInSeconds.toFixed(1)}秒)` : ""}
              </span>
              {durationError ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge-pill danger w-fit">{durationError}(長さが取得できず、次へ進めません)</span>
                  <button
                    type="button"
                    className="btn-outline px-3 py-1 text-xs"
                    onClick={() => pendingFile && detectDuration(pendingFile)}
                  >
                    長さの取得を再試行
                  </button>
                </div>
              ) : null}
            </div>
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
