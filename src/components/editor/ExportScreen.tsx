"use client";

import { useEffect, useRef, useState } from "react";
import { MIN_CLIPS, MAX_CLIPS } from "@video/templates/standard/schema";
import { buildStandardVideoProps, loadProject, type VideoProject } from "@/lib/videoProject";
import { useWebRender } from "./useWebRender";
import { RenderPanel } from "./RenderPanel";

/** 書き出したファイルの名前(元の動画名を元にする)。 */
const exportFileName = (project: VideoProject): string =>
  `${(project.videoFileName ?? "video").replace(/\.[^.]+$/, "")}-edited.mp4`;

/**
 * /edit の「動画を書き出す」から遷移してくる、書き出し専用画面。
 * /edit 側で直前にlocalStorageへ同期保存された編集内容(videoProject.ts)を読み込み、
 * この画面に来た時点で自動的に書き出しを開始する。書き出しは利用者のブラウザ内で行う
 * (サーバーでの書き出しはメモリ不足で落ちるため。useWebRender.ts参照)。
 */
export const ExportScreen: React.FC = () => {
  const [project, setProject] = useState<VideoProject | null>(null);
  const [hasCheckedProject, setHasCheckedProject] = useState(false);
  const { renderState, result, logs, elapsedSeconds, handleRender } = useWebRender();
  const startedRef = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorageからの一度きりの初期ハイドレーション
    setProject(loadProject());
    setHasCheckedProject(true);
  }, []);

  const canRender =
    !!project && project.segments.length >= MIN_CLIPS && project.segments.length <= MAX_CLIPS;

  const startRender = (current: VideoProject) => {
    void handleRender(
      buildStandardVideoProps({
        videoPath: current.videoPath,
        segments: current.segments,
        primaryColor: current.primaryColor,
        captionStyle: current.captionStyle,
        fontFamily: current.fontFamily,
        captionPosition: current.captionPosition,
        fontSize: current.fontSize,
        fadeInOut: current.fadeInOut,
        sfxClips: current.sfx,
        bgm: current.bgm,
        hook: current.hook,
        cta: current.cta,
        globalOverlays: current.globalOverlays,
        globalImages: current.globalImages,
      }),
      exportFileName(current)
    );
  };

  // この画面に来た時点で一度だけ自動的に書き出しを開始する。
  useEffect(() => {
    if (!project || !canRender || startedRef.current) return;
    startedRef.current = true;
    startRender(project);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- projectを読み込んだ直後に一度だけ開始する
  }, [project, canRender]);

  if (!hasCheckedProject) {
    return null;
  }

  if (!project) {
    return (
      <div className="panel flex flex-col items-center gap-3 p-10 text-center">
        <p className="text-sm font-medium">書き出す動画がありません</p>
        <p className="text-xs" style={{ color: "var(--muted-2)" }}>
          まずは動画をアップロードして使う範囲を選んでください
        </p>
        <a href="/create" className="btn-primary px-4 py-1.5 text-sm">
          動画をアップロードする →
        </a>
      </div>
    );
  }

  if (!canRender) {
    return (
      <div className="panel flex flex-col items-center gap-3 p-10 text-center">
        <p className="text-sm font-medium">クリップの数が書き出せる範囲外です</p>
        <p className="text-xs" style={{ color: "var(--muted-2)" }}>
          編集画面でクリップの数を{MIN_CLIPS}〜{MAX_CLIPS}個に調整してください
        </p>
        <a href="/edit" className="btn-primary px-4 py-1.5 text-sm">
          ← 編集に戻る
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <a href="/edit" className="btn-ghost w-fit text-xs">
        ← 編集に戻る
      </a>
      <div className="panel flex flex-col gap-1 p-4">
        <p className="text-sm font-medium">{project.videoFileName ?? "動画"}を書き出しています</p>
        <p className="text-xs" style={{ color: "var(--muted-2)" }}>
          クリップ {project.segments.length}個・このブラウザの中で書き出します。終わるまでこの画面を開いたままにしてください
        </p>
      </div>
      <RenderPanel
        canRender={canRender}
        renderState={renderState}
        logs={logs}
        elapsedSeconds={elapsedSeconds}
        onRender={() => startRender(project)}
        result={result}
      />
    </div>
  );
};
