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
import { loadProject, saveProject, type ProjectStyleReference, type VideoProject } from "@/lib/videoProject";
import { useExtractStyleJob } from "../useExtractStyleJob";
import { uploadVideoFile } from "../uploadVideoFile";

/**
 * ラフカット(/create/cut)で絞り込んだ「使う範囲」に対して、参考画像/参考動画からスタイルを
 * 抽出する画面(/create/style)。参考が動画の場合はテロップの出現演出も読み取れるため、
 * captionAnimationにも反映する。渡した参考はサーバーに残し、次の自動編集(/create/auto-edit)が
 * 最優先の手本として直接見る。字幕は以前ここで生成していたが、付けるかどうかを編集画面で
 * 決められるよう、編集画面の「字幕を一括生成」に移した。
 */

const captionStyleLabel = (value: CaptionStyle): string =>
  CAPTION_STYLE_OPTIONS.find((option) => option.value === value)?.label ?? value;
const captionAnimationLabel = (value: CaptionAnimation): string =>
  CAPTION_ANIMATION_OPTIONS.find((option) => option.value === value)?.label ?? value;

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

  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referenceUploading, setReferenceUploading] = useState(false);
  const [styleReference, setStyleReference] = useState<ProjectStyleReference | null>(null);
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
        setStyleReference({ path: videoPath, mimeType: file.type });
        void handleExtractStyleFromVideo(videoPath);
      } catch (error) {
        alert(error instanceof Error ? error.message : "参考動画のアップロードに失敗しました");
      } finally {
        setReferenceUploading(false);
      }
      return;
    }
    const referencePath = await handleExtractStyle(file);
    setStyleReference(referencePath ? { path: referencePath, mimeType: file.type } : null);
  };

  /** カット画面で選んだ「使う範囲」(=カット結果の再生順)。まだテロップは持たない。 */
  const keepRanges = project?.segments ?? [];

  const goToAutoEdit = () => {
    if (!project) return;
    saveProject({
      ...project,
      primaryColor: primaryColor ?? project.primaryColor,
      fontFamily: fontFamily ?? project.fontFamily,
      captionPosition: captionPosition ?? project.captionPosition,
      captionStyle: captionStyle ?? project.captionStyle,
      // 字幕はまだ付けない(編集画面で決める)。演出だけは参考から抽出できていれば反映する。
      segments: captionAnimation ? keepRanges.map((segment) => ({ ...segment, captionAnimation })) : keepRanges,
      cutKeepRanges: keepRanges.map((segment) => ({
        startFromSeconds: segment.startFromSeconds,
        durationInSeconds: segment.durationInSeconds,
      })),
      // 新しい参考を渡さずに進んだ場合は、前回渡した参考をそのまま手本として使い続ける。
      styleReference: styleReference ?? project.styleReference ?? null,
      styleReferenceApplied: primaryColor !== null || Boolean(project.styleReferenceApplied),
    });
    router.push("/create/auto-edit");
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
          <h2 className="text-sm font-semibold">自動編集へ</h2>
          <span className="text-xs" style={{ color: "var(--muted-2)" }}>
            参考スクショを最優先の手本に、Geminiが編集をまとめて行います。字幕は編集画面で付けられます
          </span>
        </div>
        <button
          type="button"
          onClick={goToAutoEdit}
          disabled={referenceUploading || extractStyleState.status === "processing"}
          className="btn-primary self-start px-4 py-2 text-sm"
        >
          自動編集へ進む →
        </button>
        {!styleReference && project.styleReference ? (
          <span className="text-xs" style={{ color: "var(--muted-2)" }}>
            新しい参考を渡さなければ、前回の参考をそのまま手本にします
          </span>
        ) : null}
      </div>
    </div>
  );
};
