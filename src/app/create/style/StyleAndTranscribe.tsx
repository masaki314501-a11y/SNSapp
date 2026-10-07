"use client";

import { useEffect, useRef, useState } from "react";
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
import { MAX_STYLE_REFERENCES } from "@/lib/styleReferenceLimits";
import { WaitTime } from "@/components/WaitTime";
import type { WaitTaskId } from "@/lib/waitEstimate";
import { toFriendlyErrorMessage } from "@/lib/friendlyError";
import { PlusIcon, UploadIcon } from "@/components/icons";

/**
 * ラフカット(/create/cut)で絞り込んだ「使う範囲」に対して、参考画像/参考動画からスタイルを
 * 抽出する画面(/create/style)。参考は複数枚渡せ、画像は全部をまとめて見せて共通する癖を抽出する
 * (1枚だけだと、その1枚にたまたま映っていた色や配置まで真似てしまうため)。参考が動画の場合はテロップの出現演出も読み取れるため、
 * captionAnimationにも反映する。渡した参考はサーバーに残し、次の自動編集(/create/auto-edit)が
 * 最優先の手本として直接見る。字幕は以前ここで生成していたが、付けるかどうかを編集画面で
 * 決められるよう、編集画面の「字幕を一括生成」に移した。
 */

const captionStyleLabel = (value: CaptionStyle): string =>
  CAPTION_STYLE_OPTIONS.find((option) => option.value === value)?.label ?? value;
const captionAnimationLabel = (value: CaptionAnimation): string =>
  CAPTION_ANIMATION_OPTIONS.find((option) => option.value === value)?.label ?? value;

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
const isVideoReference = (reference: ProjectStyleReference): boolean => reference.mimeType.startsWith("video/");

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

  const [references, setReferences] = useState<ProjectStyleReference[]>([]);
  /** この画面で選んだファイルのプレビュー用URL(パス→URL)。前に渡した参考はサーバーから表示する。 */
  const [localPreviewUrls, setLocalPreviewUrls] = useState<Record<string, string>>({});
  /** 画面を離れる時にまとめて解放するため、作ったプレビューURLを覚えておく。 */
  const createdPreviewUrlsRef = useRef<string[]>([]);
  const [referenceUploading, setReferenceUploading] = useState(false);
  /** 目安の待ち時間用。アップロード中の動画の合計MBと、抽出の種類(画像何枚か/動画か)。 */
  const [uploadingMegabytes, setUploadingMegabytes] = useState(0);
  const [extractWait, setExtractWait] = useState<{ task: WaitTaskId; units: number }>({
    task: "extract-style-image",
    units: 1,
  });
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
    // 前に渡した参考も一覧に出し、そのまま手本に使う(いらなければ✕で外せる)。
    setReferences(loaded?.styleReferences ?? []);
    setHasCheckedProject(true);
  }, []);

  useEffect(() => {
    // 配列そのものは同じものを使い続ける(中身だけ増える)ので、先に取り出しておいてよい。
    const createdPreviewUrls = createdPreviewUrlsRef.current;
    return () => {
      for (const url of createdPreviewUrls) URL.revokeObjectURL(url);
    };
  }, []);

  const previewUrlOf = (reference: ProjectStyleReference): string =>
    localPreviewUrls[reference.path] ?? `/api/media/${reference.path}`;

  /**
   * 画像は今ある画像と合わせて全部でスタイルを抽出し直す。画像が1枚も無く動画だけのときは、
   * 新しく選んだ動画から抽出する(動画はテロップの動きまで読めるため)。
   */
  const handleAddReferenceFiles = async (selected: File[]) => {
    if (selected.length === 0) return;
    const room = MAX_STYLE_REFERENCES - references.length;
    if (room <= 0) {
      alert(`参考は${MAX_STYLE_REFERENCES}個までです。いらないものを✕で外してから追加してください`);
      return;
    }
    if (selected.length > room) {
      alert(`参考は${MAX_STYLE_REFERENCES}個までのため、最初の${room}個だけ追加します`);
    }
    const files = selected.slice(0, room);
    const videoFiles = files.filter((file) => file.type.startsWith("video/"));
    const imageFiles = files.filter((file) => !file.type.startsWith("video/"));

    const addedVideos: ProjectStyleReference[] = [];
    const addedPreviews: Record<string, string> = {};
    if (videoFiles.length > 0) {
      setUploadingMegabytes(videoFiles.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024);
      setReferenceUploading(true);
      try {
        for (const file of videoFiles) {
          const videoPath = await uploadVideoFile(file);
          addedVideos.push({ path: videoPath, mimeType: file.type });
          addedPreviews[videoPath] = URL.createObjectURL(file);
        }
      } catch (error) {
        alert(toFriendlyErrorMessage(error, "参考動画のアップロードに失敗しました"));
      } finally {
        setReferenceUploading(false);
      }
    }

    const savedImages = references.filter((reference) => !isVideoReference(reference));
    let nextImages = savedImages;
    if (imageFiles.length > 0) {
      setExtractWait({ task: "extract-style-image", units: savedImages.length + imageFiles.length });
      const paths = await handleExtractStyle(
        imageFiles,
        savedImages.map((reference) => reference.path)
      );
      if (paths) {
        // サーバーはsavedPaths→新しい画像の順に返す(消えていた保存済み画像は抜かれる)。
        const newPaths = paths.filter((p) => !savedImages.some((reference) => reference.path === p));
        newPaths.forEach((p, i) => {
          if (imageFiles[i]) addedPreviews[p] = URL.createObjectURL(imageFiles[i]);
        });
        nextImages = paths.map((p) => ({
          path: p,
          mimeType: IMAGE_MIME_BY_EXTENSION[p.split(".").pop()!.toLowerCase()] ?? "image/png",
        }));
      }
    } else if (addedVideos.length > 0 && savedImages.length === 0) {
      setExtractWait({ task: "extract-style-video", units: 1 });
      void handleExtractStyleFromVideo(addedVideos[0].path);
    }

    createdPreviewUrlsRef.current.push(...Object.values(addedPreviews));
    setLocalPreviewUrls((prev) => ({ ...prev, ...addedPreviews }));
    setReferences((prev) => [...prev.filter(isVideoReference), ...addedVideos, ...nextImages]);
  };

  /** 参考を1つ外す。画像が残っていれば、残りの画像だけでスタイルを抽出し直す。 */
  const handleRemoveReference = async (path: string) => {
    const remaining = references.filter((reference) => reference.path !== path);
    setReferences(remaining);
    const removedWasImage = references.some((r) => r.path === path && !isVideoReference(r));
    const remainingImages = remaining.filter((reference) => !isVideoReference(reference));
    if (removedWasImage && remainingImages.length > 0) {
      setExtractWait({ task: "extract-style-image", units: remainingImages.length });
      await handleExtractStyle(
        [],
        remainingImages.map((reference) => reference.path)
      );
    }
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
      styleReferences: references,
      styleReferenceApplied: primaryColor !== null || Boolean(project.styleReferenceApplied),
    });
    router.push("/create/auto-edit");
  };

  if (!hasCheckedProject) return null;
  if (!project || keepRanges.length === 0) return <EmptyState />;

  const isBusy = referenceUploading || extractStyleState.status === "processing";
  const hasAnyReference = references.length > 0;
  const canAddMore = references.length < MAX_STYLE_REFERENCES;

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
          if (isBusy) return;
          void handleAddReferenceFiles(Array.from(e.dataTransfer.files ?? []));
        }}
      >
        <span className="badge-pill neutral w-fit">なくてもOK</span>
        <p className="flow-lead">
          まねしたい投稿のスクショや動画を選ぶと、AIが配色・文字・演出をその雰囲気に寄せて編集します。
        </p>

        <input
          id="style-reference-file"
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm"
          className="sr-only"
          disabled={isBusy || !canAddMore}
          onChange={(e) => {
            const selected = Array.from(e.target.files ?? []);
            // 同じファイルを外した後にもう一度選べるよう、選択状態は毎回空に戻す。
            e.target.value = "";
            void handleAddReferenceFiles(selected);
          }}
        />

        {/* 動画を選ぶ画面と同じく、未選択の時は選ぶ枠を画面の下まで広げ、選んだら同じ場所に一覧を出す */}
        {hasAnyReference ? (
          <div className="panel flex flex-col gap-2 p-4">
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              手本: {references.length}個(✕で外せます。{MAX_STYLE_REFERENCES}個まで)
            </span>
            <div className="flex flex-wrap gap-2">
              {references.map((reference, index) => (
                <div key={reference.path} className="relative">
                  {isVideoReference(reference) ? (
                    <video
                      src={previewUrlOf(reference)}
                      muted
                      playsInline
                      className="h-28 w-auto rounded-lg object-contain"
                      style={{ border: "1px solid var(--border)" }}
                      aria-label={`手本${index + 1}`}
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewUrlOf(reference)}
                      alt={`手本${index + 1}`}
                      className="h-28 w-auto rounded-lg object-contain"
                      style={{ border: "1px solid var(--border)" }}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => void handleRemoveReference(reference.path)}
                    disabled={isBusy}
                    className="absolute right-1 top-1 rounded-full px-1.5 text-xs"
                    style={{ background: "rgba(0,0,0,0.65)", color: "#fff" }}
                    aria-label={`手本${index + 1}を外す`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              同じ人の投稿を何枚か入れると、共通する編集の癖をより正確に読み取れます
            </span>
          </div>
        ) : (
          <label
            htmlFor="style-reference-file"
            className="upload-drop upload-drop-fill flex cursor-pointer flex-col items-center justify-center gap-3 p-8 text-center"
          >
            <UploadIcon size={40} />
            <span className="upload-drop-title">手本の画像・動画を選ぶ</span>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              {MAX_STYLE_REFERENCES}個まで、まとめて選べます。同じ人の投稿を何枚か入れると、共通する編集の癖をより正確に読み取れます。
              動画なら、文字の出し方の動きも読み取ります
            </span>
          </label>
        )}

        {referenceUploading ? <span className="badge-pill warning w-fit">手本の動画をアップロード中...</span> : null}
        <WaitTime task="video-upload" units={uploadingMegabytes} active={referenceUploading} />
        {!referenceUploading && extractStyleState.status === "processing" ? (
          <span className="badge-pill warning w-fit">見た目を読み取り中...</span>
        ) : null}
        <WaitTime
          task={extractWait.task}
          units={extractWait.units}
          active={!referenceUploading && extractStyleState.status === "processing"}
          failed={extractStyleState.status === "error"}
        />
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
      </main>

      <div className="bottom-action-bar">
        {/*
          手本の追加・手本なしで進むは白いボタンで、次へ進むボタンと同じ場所(画面の一番下)に並べる。
          「自動編集へ進む」は手本を選ぶまで押せない(手本を選ばない時は「手本なしで進む」を押す)。
        */}
        <div className="bottom-action-row">
          {isBusy ? null : !hasAnyReference ? (
            // 手本を選んでいない(または読み込みに失敗した)時は、手本なしで進めるようにする
            <button type="button" onClick={goToAutoEdit} className="btn-outline">
              手本なしで進む
            </button>
          ) : canAddMore ? (
            <label htmlFor="style-reference-file" className="btn-outline cursor-pointer">
              <PlusIcon size={18} />
              手本を追加
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
