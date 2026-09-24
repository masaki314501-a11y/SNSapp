"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadProject, saveProject, type VideoProject } from "@/lib/videoProject";
import { useAutoEditJob } from "../useAutoEditJob";

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

const totalSeconds = (ranges: { durationInSeconds: number }[]): number =>
  ranges.reduce((sum, range) => sum + range.durationInSeconds, 0);

/**
 * カット後・手動編集(/edit)に入る前に割り込む「自動編集(バズる動画)」画面。Geminiに本人の動画・
 * 参考スクショ・編集例を見せ、切り方から強調テキスト・効果音まで編集をすべて任せる。
 * 生成結果は「この案を使う」を押すまでプロジェクトに一切書き込まない。ジョブが未完了・
 * 失敗していても「スキップして編集へ」は常に押せる(自動編集がパイプラインを詰まらせない)。
 */
export const AutoEditScreen: React.FC = () => {
  const router = useRouter();
  const [project, setProject] = useState<VideoProject | null>(null);
  const [hasCheckedProject, setHasCheckedProject] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const { autoEditState, handleStart } = useAutoEditJob();

  useEffect(() => {
    const loaded = loadProject();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorageからの一度きりの初期ハイドレーション
    setProject(loaded);
    setHasCheckedProject(true);
  }, []);

  useEffect(() => {
    if (autoEditState.status !== "processing" || startedAt === null) return;
    const timer = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [autoEditState.status, startedAt]);

  const keepRanges = project
    ? (project.cutKeepRanges ?? project.segments).map((s) => ({
        startFromSeconds: s.startFromSeconds,
        durationInSeconds: s.durationInSeconds,
      }))
    : [];

  const goToEditorWithoutChanges = () => router.push("/edit");

  const handleRun = () => {
    if (!project) return;
    setElapsedSeconds(0);
    setStartedAt(Date.now());
    void handleStart({
      videoPath: project.videoPath,
      videoDurationInSeconds: project.videoDurationInSeconds,
      keepRanges,
      styleReferencePath: project.styleReference?.path ?? null,
    });
  };

  const applyPlan = () => {
    if (!project || autoEditState.status !== "done") return;
    const { plan, segments, generatedClips } = autoEditState;
    saveProject({
      ...project,
      // 次に自動編集をやり直すときも、カット画面で残した元の範囲から切り直せるようにする。
      cutKeepRanges: keepRanges,
      segments,
      primaryColor: plan.theme.primaryColor ?? project.primaryColor,
      fontFamily: plan.theme.fontFamily ?? project.fontFamily,
      captionPosition: plan.theme.captionPosition ?? project.captionPosition,
      captionStyle: plan.theme.captionStyle ?? project.captionStyle,
      hook: plan.hook,
      cta: plan.cta,
      globalOverlays: plan.globalOverlays,
      // クリップの切り方が変わると、以前の効果音・ナレーションの秒位置は意味を失うため作り直す。
      sfx: generatedClips,
    });
    router.push("/edit");
  };

  if (!hasCheckedProject) return null;
  if (!project || keepRanges.length === 0) return <EmptyState />;

  const hasReference = Boolean(project.styleReference);

  return (
    <div className="panel flex flex-col gap-4 p-5">
      <p className="text-xs" style={{ color: "var(--muted-2)" }}>
        Geminiが動画を見て、切り方・寄り(ズーム)・強調テキスト・効果音・ナレーション・冒頭の見出し・締めの一言まで
        すべて決めます。字幕は次の編集画面で付けるか決められます。数分かかることがあります。
      </p>

      {hasReference ? (
        <span className="badge-pill success w-fit">参考スクショ/動画を最優先の手本にします</span>
      ) : (
        <p className="badge-pill warning w-fit">
          参考スクショが未設定です。
          <a href="/create/style" className="underline">
            見た目の設定
          </a>
          で渡すと、その編集の感じを最優先で再現します
        </p>
      )}

      {autoEditState.status === "idle" || autoEditState.status === "error" ? (
        <button type="button" onClick={handleRun} className="btn-primary self-start px-4 py-2 text-sm">
          🪄 {autoEditState.status === "error" ? "もう一度自動編集する" : "自動編集する"}
        </button>
      ) : null}

      {autoEditState.status === "processing" ? (
        <div className="flex flex-col gap-1">
          <span className="badge-pill warning w-fit">Geminiが編集中...({elapsedSeconds}秒経過)</span>
          {hasReference && !autoEditState.usedStyleReference ? (
            <span className="text-xs" style={{ color: "var(--muted-2)" }}>
              参考スクショがサーバー上に見つからなかったため、今回は手本無しで編集しています(見た目の設定からもう一度渡してください)
            </span>
          ) : null}
        </div>
      ) : null}

      {autoEditState.status === "error" ? <p className="badge-pill danger w-fit">{autoEditState.message}</p> : null}

      {autoEditState.status === "done" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">{autoEditState.plan.summary}</p>
          {autoEditState.plan.referenceNotes ? (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              参考から読み取った編集の感じ: {autoEditState.plan.referenceNotes}
            </p>
          ) : null}
          <ul className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted)" }}>
            <li>
              ✂️ {keepRanges.length}区間・{totalSeconds(keepRanges).toFixed(1)}秒 → {autoEditState.segments.length}
              クリップ・{totalSeconds(autoEditState.segments).toFixed(1)}秒
            </li>
            {autoEditState.plan.hook ? <li>🪝 冒頭の見出し: {autoEditState.plan.hook.headline}</li> : null}
            {autoEditState.plan.cta ? <li>📣 締めの一言: {autoEditState.plan.cta.text}</li> : null}
            {autoEditState.plan.globalOverlays.length > 0 ? (
              <li>📌 ずっと出す文字: {autoEditState.plan.globalOverlays.map((o) => o.text).join(" / ")}</li>
            ) : null}
            <li>🔍 寄り(ズーム): {autoEditState.segments.filter((s) => s.zoom).length}か所</li>
            <li>
              💬 強調テキスト: {autoEditState.segments.reduce((sum, s) => sum + (s.overlays?.length ?? 0), 0)}個
            </li>
            <li>
              🔊 効果音: {autoEditState.generatedClips.filter((c) => !c.narrationSegmentKey).length}個 / 🎙 ナレーション:{" "}
              {autoEditState.generatedClips.filter((c) => c.narrationSegmentKey).length}個
            </li>
          </ul>
          <p className="text-xs" style={{ color: "var(--muted-2)" }}>
            この案を使うと、クリップ構成・効果音・ナレーションが置き換わります(BGMはそのまま)。
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={applyPlan} className="btn-primary px-4 py-2 text-sm">
              この案を使う →
            </button>
            <button type="button" onClick={handleRun} className="btn-outline px-4 py-2 text-sm">
              別の案を作る
            </button>
          </div>
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
