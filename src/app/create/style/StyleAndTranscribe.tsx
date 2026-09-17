"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CAPTION_ANIMATION_OPTIONS,
  CAPTION_STYLE_OPTIONS,
  type CaptionAnimation,
  type CaptionFontFamily,
  type CaptionPosition,
  type CaptionStyle,
} from "@video/shared/schema";
import {
  DEFAULT_CAPTION_ANIMATION,
  DEFAULT_CLIP_VOLUME,
  loadProject,
  saveProject,
  type ProjectSegment,
  type VideoProject,
} from "@/lib/videoProject";
import { clipTranscribedToKeepRanges } from "@/components/editor/timelineUtils";
import { useTranscribeJob, type TranscribedSegment } from "../useTranscribeJob";
import { useExtractStyleJob } from "../useExtractStyleJob";
import { uploadVideoFile } from "../uploadVideoFile";
import { MicIcon } from "@/components/icons";

/**
 * ラフカット(/create/cut)で絞り込んだ「使う範囲」に対して、参考画像/参考動画からスタイルを
 * 抽出し、音声から字幕を生成する画面(/create/style)。参考が動画の場合はテロップの出現演出も
 * 読み取れるため、captionAnimationにも反映する。文字起こし自体は動画全体を対象に行うが、
 * 結果は使う範囲だけに切り詰めてから編集画面(/edit)へ渡す(捨てた範囲の発話は字幕にしない)。
 */
const transcribePhaseLabel: Record<"uploading" | "processing" | "generating", string> = {
  uploading: "動画をアップロード中",
  processing: "動画を処理中",
  generating: "字幕を生成中",
};

const captionStyleLabel = (value: CaptionStyle): string =>
  CAPTION_STYLE_OPTIONS.find((option) => option.value === value)?.label ?? value;
const captionAnimationLabel = (value: CaptionAnimation): string =>
  CAPTION_ANIMATION_OPTIONS.find((option) => option.value === value)?.label ?? value;

const toProjectSegments = (segments: TranscribedSegment[], captionAnimation: CaptionAnimation): ProjectSegment[] =>
  segments.map((segment) => ({
    key: crypto.randomUUID(),
    caption: segment.caption,
    startFromSeconds: segment.startFromSeconds,
    durationInSeconds: segment.durationInSeconds,
    captionAnimation,
    volume: DEFAULT_CLIP_VOLUME,
  }));

const EmptyState: React.FC = () => (
  <div className="panel flex flex-col items-center gap-3 p-10 text-center">
    <p className="text-sm font-medium">対象の動画がありません</p>
    <p className="text-xs" style={{ color: "var(--muted-2)" }}>
      まずは動画をアップロードし、使う範囲を選んでください
    </p>
    <a href="/create" className="btn-primary px-4 py-1.5 text-sm">
      動画をアップロードする →
    </a>
  </div>
);

export const StyleAndTranscribe: React.FC = () => {
  const router = useRouter();
  const [project, setProject] = useState<VideoProject | null>(null);
  const [hasCheckedProject, setHasCheckedProject] = useState(false);
  const [transcribeStartedAt, setTranscribeStartedAt] = useState<number | null>(null);
  const [transcribeElapsedSeconds, setTranscribeElapsedSeconds] = useState(0);

  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referenceUploading, setReferenceUploading] = useState(false);
  const [primaryColor, setPrimaryColor] = useState<string | null>(null);
  const [fontFamily, setFontFamily] = useState<CaptionFontFamily | null>(null);
  const [captionPosition, setCaptionPosition] = useState<CaptionPosition | null>(null);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle | null>(null);
  const [captionAnimation, setCaptionAnimation] = useState<CaptionAnimation | null>(null);
  const { extractStyleState, handleExtractStyle, handleExtractStyleFromVideo } = useExtractStyleJob({
    onDone: (style) => {
      setPrimaryColor(style.primaryColor);
      setFontFamily(style.fontFamily);
      setCaptionPosition(style.captionPosition);
      setCaptionStyle(style.captionStyle);
      setCaptionAnimation(style.captionAnimation);
    },
  });

  useEffect(() => {
    const loaded = loadProject();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorageからの一度きりの初期ハイドレーション
    setProject(loaded);
    setHasCheckedProject(true);
  }, []);

  const referencePreviewUrl = useMemo(
    () => (referenceFile ? URL.createObjectURL(referenceFile) : null),
    [referenceFile]
  );
  useEffect(() => {
    return () => {
      if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
    };
  }, [referencePreviewUrl]);

  const handleReferenceFileChange = async (file: File | null) => {
    setReferenceFile(file);
    if (!file) return;
    if (file.type.startsWith("video/")) {
      setReferenceUploading(true);
      try {
        const videoPath = await uploadVideoFile(file);
        void handleExtractStyleFromVideo(videoPath);
      } catch (error) {
        alert(error instanceof Error ? error.message : "参考動画のアップロードに失敗しました");
      } finally {
        setReferenceUploading(false);
      }
      return;
    }
    void handleExtractStyle(file);
  };

  /** カット画面で選んだ「使う範囲」(=カット結果の再生順)。まだテロップは持たない。 */
  const keepRanges = project?.segments ?? [];

  const goToEditor = (segments: ProjectSegment[]) => {
    if (!project) return;
    saveProject({
      ...project,
      primaryColor: primaryColor ?? project.primaryColor,
      fontFamily: fontFamily ?? project.fontFamily,
      captionPosition: captionPosition ?? project.captionPosition,
      captionStyle: captionStyle ?? project.captionStyle,
      segments,
      // 自動編集(/create/auto-edit)が「参考画像/動画から既にスタイルが決まっているか」を
      // 判断するのに使う。ここで決まらなければ自動編集自身が配色等を提案する。
      styleReferenceApplied: primaryColor !== null,
    });
    router.push("/create/auto-edit");
  };

  const { transcribeState, handleTranscribe: startTranscribe } = useTranscribeJob({
    onDone: (segments) => {
      const clipped = clipTranscribedToKeepRanges(segments, keepRanges);
      goToEditor(
        toProjectSegments(clipped.length > 0 ? clipped : segments, captionAnimation ?? DEFAULT_CAPTION_ANIMATION)
      );
    },
  });

  const isTranscribing =
    transcribeState.status === "uploading" ||
    transcribeState.status === "processing" ||
    transcribeState.status === "generating";

  useEffect(() => {
    if (!isTranscribing || transcribeStartedAt === null) return;
    const timer = setInterval(() => {
      setTranscribeElapsedSeconds(Math.floor((Date.now() - transcribeStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isTranscribing, transcribeStartedAt]);

  const canTranscribe = Boolean(project?.videoPath) && !isTranscribing;

  const handleTranscribe = () => {
    if (!project || !canTranscribe) return;
    setTranscribeElapsedSeconds(0);
    setTranscribeStartedAt(Date.now());
    startTranscribe(project.videoPath, project.videoDurationInSeconds);
  };

  const handleSkip = () => {
    // 字幕生成をスキップする場合は、カットで選んだ範囲をテロップなしのままクリップとして使う
    // (演出だけは参考から抽出できていれば反映する)。
    const segments = captionAnimation
      ? keepRanges.map((segment) => ({ ...segment, captionAnimation }))
      : keepRanges;
    goToEditor(segments);
  };

  if (!hasCheckedProject) return null;
  if (!project || keepRanges.length === 0) return <EmptyState />;

  return (
    <div className="panel flex flex-col divide-y">
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-baseline gap-2.5">
          <span className="step-badge">2</span>
          <h2 className="text-sm font-semibold">参考画像・動画から見た目を設定</h2>
          <span className="text-xs" style={{ color: "var(--muted-2)" }}>
            任意・配色/フォント/位置/背景/演出をまとめて抽出します
          </span>
        </div>
        <label className="upload-drop flex flex-col gap-2 p-4">
          <span className="field-label">
            参考にする画像または動画(競合の投稿・スクリーンショット等。動画なら演出の動きも学習します)
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm"
            onChange={(e) => handleReferenceFileChange(e.target.files?.[0] ?? null)}
          />
        </label>
        {referencePreviewUrl ? (
          referenceFile?.type.startsWith("video/") ? (
            <video
              src={referencePreviewUrl}
              controls
              muted
              className="max-h-56 self-start rounded-lg object-contain"
              style={{ border: "1px solid var(--border)" }}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={referencePreviewUrl}
              alt="参考画像のプレビュー"
              className="max-h-40 self-start rounded-lg object-contain"
              style={{ border: "1px solid var(--border)" }}
            />
          )
        ) : null}
        {referenceUploading ? <span className="badge-pill warning w-fit">参考動画をアップロード中...</span> : null}
        {!referenceUploading && extractStyleState.status === "processing" ? (
          <span className="badge-pill warning w-fit">スタイルを抽出中...</span>
        ) : null}
        {extractStyleState.status === "done" ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge-pill success w-fit">
              配色・フォント・位置・背景({captionStyleLabel(extractStyleState.captionStyle)})・演出(
              {captionAnimationLabel(extractStyleState.captionAnimation)})を抽出しました
            </span>
            <span
              className="h-6 w-6 rounded-full"
              style={{ background: primaryColor ?? project.primaryColor, border: "1px solid var(--border)" }}
              title={primaryColor ?? project.primaryColor}
            />
          </div>
        ) : null}
        {extractStyleState.status === "error" ? (
          <p className="badge-pill danger w-fit">{extractStyleState.message}</p>
        ) : null}
        <span className="text-xs" style={{ color: "var(--muted-2)" }}>
          抽出したスタイルは次の編集画面で確認・変更できます
        </span>
      </div>

      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-baseline gap-2.5">
          <span className="step-badge">3</span>
          <h2 className="text-sm font-semibold">音声から字幕を生成</h2>
          <span className="text-xs" style={{ color: "var(--muted-2)" }}>
            発話の区切りごとに漏れなく字幕化・完了すると編集画面に移動します
          </span>
        </div>
        <button
          type="button"
          onClick={handleTranscribe}
          disabled={!canTranscribe}
          className="btn-primary self-start px-4 py-2 text-sm"
        >
          {isTranscribing ? (
            "字幕を生成中..."
          ) : (
            <>
              <MicIcon size={15} className="mr-1.5 inline-block align-[-2px]" />
              音声から字幕を生成
            </>
          )}
        </button>
        {isTranscribing ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
              {(["uploading", "processing", "generating"] as const).map((phase, i) => {
                const phaseOrder = ["uploading", "processing", "generating"] as const;
                const currentIndex = phaseOrder.indexOf(transcribeState.status as (typeof phaseOrder)[number]);
                const state = i < currentIndex ? "done" : i === currentIndex ? "active" : "pending";
                return (
                  <span key={phase} className="flex items-center gap-2">
                    {i > 0 ? <span style={{ opacity: 0.5 }}>→</span> : null}
                    <span
                      className={state === "active" ? "badge-pill warning" : "badge-pill neutral"}
                      style={state === "pending" ? { opacity: 0.5 } : undefined}
                    >
                      {state === "done" ? "✓ " : ""}
                      {transcribePhaseLabel[phase]}
                    </span>
                  </span>
                );
              })}
            </div>
            <span className="text-xs" style={{ color: "var(--muted-2)" }}>
              {transcribeElapsedSeconds}秒経過(動画の長さによっては2分ほどかかることがあります)
            </span>
          </div>
        ) : null}
        {transcribeState.status === "error" ? <p className="badge-pill danger w-fit">{transcribeState.message}</p> : null}

        <div className="mt-2 flex items-center gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <button type="button" onClick={handleSkip} className="btn-outline px-4 py-1.5 text-sm">
            字幕生成をスキップして編集へ進む →
          </button>
        </div>
      </div>
    </div>
  );
};
