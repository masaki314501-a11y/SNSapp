"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CAPTION_ANIMATION_OPTIONS } from "@video/shared/schema";
import { loadProject, saveProject, type ProjectSfxClip, type VideoProject } from "@/lib/videoProject";
import { useAutoEditJob } from "../useAutoEditJob";

const captionAnimationLabel = (value: string): string =>
  CAPTION_ANIMATION_OPTIONS.find((option) => option.value === value)?.label ?? value;

const EmptyState: React.FC = () => (
  <div className="panel flex flex-col items-center gap-3 p-10 text-center">
    <p className="text-sm font-medium">対象の動画がありません</p>
    <p className="text-xs" style={{ color: "var(--muted-2)" }}>
      まずは動画をアップロードし、字幕生成まで進めてください
    </p>
    <a href="/create" className="btn-primary px-4 py-1.5 text-sm">
      動画をアップロードする →
    </a>
  </div>
);

/**
 * 字幕生成が終わった後・手動編集(/edit)に入る前に割り込む「自動編集(バズる動画)」画面。
 * 生成結果は「この案を使う」を押すまでプロジェクトに一切書き込まない。ジョブが未完了・
 * 失敗していても「スキップして編集へ」は常に押せる(自動編集がパイプラインを詰まらせない)。
 */
export const AutoEditScreen: React.FC = () => {
  const router = useRouter();
  const [project, setProject] = useState<VideoProject | null>(null);
  const [hasCheckedProject, setHasCheckedProject] = useState(false);
  const { autoEditState, handleStart } = useAutoEditJob();

  useEffect(() => {
    const loaded = loadProject();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorageからの一度きりの初期ハイドレーション
    setProject(loaded);
    setHasCheckedProject(true);
  }, []);

  const goToEditorWithoutChanges = () => router.push("/edit");

  const handleRun = () => {
    if (!project) return;
    void handleStart(
      project.segments.map((s) => ({ key: s.key, caption: s.caption, durationInSeconds: s.durationInSeconds })),
      {
        primaryColor: project.primaryColor,
        fontFamily: project.fontFamily,
        captionPosition: project.captionPosition,
        captionStyle: project.captionStyle,
        captionAnimation: project.segments[0]?.captionAnimation ?? "slide-up",
      },
      project.styleReferenceApplied ?? false
    );
  };

  const applyPlan = () => {
    if (!project || autoEditState.status !== "done") return;
    const { plan, generatedClips } = autoEditState;

    const segments = project.segments.map((segment) => {
      const decision = plan.segments.find((s) => s.key === segment.key);
      return decision?.captionAnimation ? { ...segment, captionAnimation: decision.captionAnimation } : segment;
    });

    const newClips: ProjectSfxClip[] = generatedClips.map((clip) => ({ ...clip }));

    saveProject({
      ...project,
      segments,
      primaryColor: plan.theme?.primaryColor ?? project.primaryColor,
      fontFamily: plan.theme?.fontFamily ?? project.fontFamily,
      captionPosition: plan.theme?.captionPosition ?? project.captionPosition,
      captionStyle: plan.theme?.captionStyle ?? project.captionStyle,
      sfx: [...project.sfx, ...newClips],
    });
    router.push("/edit");
  };

  if (!hasCheckedProject) return null;
  if (!project || project.segments.length === 0) return <EmptyState />;

  return (
    <div className="panel flex flex-col gap-4 p-5">
      <p className="text-xs" style={{ color: "var(--muted-2)" }}>
        クリップの並び替え・トリミングは含みません。演出の上書き・AIナレーション・
        効果音の提案のみ行います。数十秒〜数分かかることがあります。
      </p>

      {autoEditState.status === "idle" ? (
        <button type="button" onClick={handleRun} className="btn-primary self-start px-4 py-2 text-sm">
          🪄 自動編集する
        </button>
      ) : null}

      {autoEditState.status === "processing" ? (
        <span className="badge-pill warning w-fit">編集案を検討中...</span>
      ) : null}

      {autoEditState.status === "error" ? (
        <p className="badge-pill danger w-fit">{autoEditState.message}</p>
      ) : null}

      {autoEditState.status === "done" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">{autoEditState.plan.summary}</p>
          <ul className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted)" }}>
            {autoEditState.plan.segments
              .filter((s) => s.captionAnimation || s.addNarration || s.sfxPresetId)
              .map((s, i) => (
                <li key={i}>
                  {[
                    s.captionAnimation ? `演出→${captionAnimationLabel(s.captionAnimation)}` : null,
                    s.addNarration ? "🎙 ナレーション追加" : null,
                    s.sfxPresetId ? `🔊 ${s.sfxPresetId}` : null,
                  ]
                    .filter(Boolean)
                    .join(" / ")}
                </li>
              ))}
          </ul>
          <button type="button" onClick={applyPlan} className="btn-primary self-start px-4 py-2 text-sm">
            この案を使う →
          </button>
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
        <button type="button" onClick={goToEditorWithoutChanges} className="btn-outline px-4 py-1.5 text-sm">
          スキップして編集へ進む →
        </button>
      </div>
    </div>
  );
};
