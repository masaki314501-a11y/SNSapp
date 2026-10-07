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
import { RestartIcon, UploadIcon } from "@/components/icons";

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
  <main className="flow-main">
      <div className="panel flex flex-col items-center gap-3 p-10 text-center">
        <p className="text-sm font-medium">対象の動画がありません</p>
        <p className="text-xs" style={{ color: "var(--muted-2)" }}>
          まずは動画をアップロードし、使う範囲を選んでください
        </p>
        <a href="/create" className="btn-primary px-4 py-1.5 text-sm">
          動画をアップロードする →
        </a>
      </div>
  </main>
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

  const hasAnyReference = Boolean(styleReference ?? project.styleReference);
  const isBusy = referenceUploading || extractStyleState.status === "processing";

  return (
    <>
      {/*
        以前は見えているファイル選択欄に動画を落として選べたため、画面のどこに落としても選べるようにする
        (受け止めないと、ブラウザがその動画ファイルを開いて画面から離れてしまう)。
      */}
      <main
        className="flow-main"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0] ?? null;
          if (file) void handleReferenceFileChange(file);
        }}
      >
        <span className="badge-pill neutral w-fit">なくてもOK</span>
        <p className="flow-lead">
          まねしたい投稿のスクショや動画を選ぶと、AIが配色・文字・演出をその雰囲気に寄せて編集します。
        </p>

        <input
          id="style-reference-file"
          type="file"
          accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm"
          className="sr-only"
          onChange={(e) => {
            void handleReferenceFileChange(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />

        {/* 動画を選ぶ画面と同じく、未選択の時は選ぶ枠を画面の下まで広げ、選んだら同じ場所にプレビューを出す */}
        {referencePreviewUrl ? (
          <div className="upload-preview">
            {referenceFile?.type.startsWith("video/") ? (
              <video src={referencePreviewUrl} controls muted playsInline aria-label="見た目の手本のプレビュー" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={referencePreviewUrl} alt="見た目の手本のプレビュー" />
            )}
          </div>
        ) : (
          <label
            htmlFor="style-reference-file"
            className="upload-drop upload-drop-fill flex cursor-pointer flex-col items-center justify-center gap-3 p-8 text-center"
          >
            <UploadIcon size={40} />
            <span className="upload-drop-title">手本の画像・動画を選ぶ</span>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              動画なら、文字の出し方の動きも読み取ります
            </span>
          </label>
        )}

        {referenceUploading ? <span className="badge-pill warning w-fit">手本の動画をアップロード中...</span> : null}
        {!referenceUploading && extractStyleState.status === "processing" ? (
          <span className="badge-pill warning w-fit">見た目を読み取り中...</span>
        ) : null}
        {extractStyleState.status === "done" ? (
          <div className="panel flex flex-col gap-2 p-4">
            <span className="text-xs font-bold" style={{ color: "var(--muted)" }}>
              手本から読み取った見た目
            </span>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span
                className="h-6 w-6 rounded-full"
                style={{ background: primaryColor ?? project.primaryColor, border: "1px solid var(--border)" }}
                title={primaryColor ?? project.primaryColor}
              />
              <span>
                配色・フォント・位置・背景({captionStyleLabel(extractStyleState.captionStyle)})・出し方(
                {captionAnimationLabel(extractStyleState.captionAnimation)})を読み取りました
              </span>
            </div>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              次の編集画面でいつでも変えられます
            </span>
          </div>
        ) : null}
        {extractStyleState.status === "error" ? (
          <p className="badge-pill danger w-fit">{extractStyleState.message}</p>
        ) : null}
        {!styleReference && project.styleReference ? (
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            新しい手本を選ばなければ、前回の手本をそのまま使います
          </span>
        ) : null}
      </main>

      <div className="bottom-action-bar">
        {/*
          選び直し・手本なしで進むは白いボタンで、次へ進むボタンと同じ場所(画面の一番下)に並べる。
          「自動編集へ進む」は手本を選ぶまで押せない(手本を選ばない時は「手本なしで進む」を押す)。
        */}
        <div className="bottom-action-row">
          {isBusy ? null : !hasAnyReference ? (
            // 手本を選んでいない(または読み込みに失敗した)時は、手本なしで進めるようにする
            <button type="button" onClick={goToAutoEdit} className="btn-outline">
              手本なしで進む
            </button>
          ) : referencePreviewUrl ? (
            <label htmlFor="style-reference-file" className="btn-outline cursor-pointer">
              <RestartIcon size={18} />
              別の手本にする
            </label>
          ) : null}
          <button type="button" onClick={goToAutoEdit} disabled={isBusy || !hasAnyReference} className="btn-primary">
            自動編集へ進む
          </button>
        </div>
      </div>
    </>
  );
};
