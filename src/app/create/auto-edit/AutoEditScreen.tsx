"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadProject, saveProject, type VideoProject } from "@/lib/videoProject";
import { useAutoEditJob } from "../useAutoEditJob";
import { ChevronRightIcon, EditIcon, InfoIcon, SparkleIcon } from "@/components/icons";
import { EDIT_TEMPLATES, findEditTemplate } from "@/lib/editTemplates";
import { WaitTime } from "@/components/WaitTime";
import { MaterialImagesPanel, type MaterialImage } from "./MaterialImagesPanel";

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

const totalSeconds = (ranges: { durationInSeconds: number }[]): number =>
  ranges.reduce((sum, range) => sum + range.durationInSeconds, 0);

const AI_DECIDES = ["切り方", "寄り(ズーム)", "強調テキスト", "画像", "効果音", "冒頭の見出し", "締めの一言"];

/**
 * カット後・手動編集(/edit)に入る前に割り込む「自動編集(バズる動画)」画面。Geminiに本人の動画・
 * 参考スクショ・編集例・選んだテンプレート(よく見るバズ編集の型)を見せ、切り方から強調テキスト・
 * 効果音まで編集をすべて任せる。
 * 生成結果は「この案を使う」を押すまでプロジェクトに一切書き込まない。ジョブが未完了・
 * 失敗していても「スキップして編集へ」は常に押せる(自動編集がパイプラインを詰まらせない)。
 */
export const AutoEditScreen: React.FC = () => {
  const router = useRouter();
  const [project, setProject] = useState<VideoProject | null>(null);
  const [hasCheckedProject, setHasCheckedProject] = useState(false);
  const { autoEditState, handleStart } = useAutoEditJob();
  /** 選んだテンプレート。nullならおまかせ。次に開いた時も同じ型を使えるようプロジェクトに保存する。 */
  const [templateId, setTemplateId] = useState<string | null>(null);

  useEffect(() => {
    const loaded = loadProject();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorageからの一度きりの初期ハイドレーション
    setProject(loaded);
    setTemplateId(findEditTemplate(loaded?.editTemplateId)?.id ?? null);
    setHasCheckedProject(true);
  }, []);

  const keepRanges = project
    ? (project.cutKeepRanges ?? project.segments).map((s) => ({
        startFromSeconds: s.startFromSeconds,
        durationInSeconds: s.durationInSeconds,
      }))
    : [];

  const goToEditorWithoutChanges = () => router.push("/edit");

  const handleRun = () => {
    if (!project) return;
    void handleStart({
      videoPath: project.videoPath,
      videoDurationInSeconds: project.videoDurationInSeconds,
      keepRanges,
      styleReferencePaths: (project.styleReferences ?? []).map((reference) => reference.path),
      templateId,
      materialImages: project.materialImages ?? [],
      generateMissingImages: project.generateMissingImages ?? true,
    });
  };

  const applyPlan = () => {
    if (!project || autoEditState.status !== "done") return;
    const { plan, segments, generatedClips } = autoEditState;
    saveProject({
      ...project,
      editTemplateId: templateId,
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
      globalImages: plan.globalImages,
      globalShapes: plan.globalShapes,
      framing: plan.framing,
      // クリップの切り方が変わると、以前の効果音・AI音声の秒位置は意味を失うため作り直す(AI音声は自動編集では作らないので外れる)。
      sfx: generatedClips,
    });
    router.push("/edit");
  };

  if (!hasCheckedProject) return null;
  if (!project || keepRanges.length === 0) return <EmptyState />;

  const referenceCount = project.styleReferences?.length ?? 0;
  const hasReference = referenceCount > 0;
  const isProcessing = autoEditState.status === "processing";

  const selectTemplate = (id: string | null) => {
    setTemplateId(id);
    // 案を使わずにやり直す場合も選んだ型を覚えておけるよう、選んだ時点で保存する。
    const next = { ...project, editTemplateId: id };
    setProject(next);
    saveProject(next);
  };

  const changeMaterialImages = (materialImages: MaterialImage[]) => {
    // やり直すたびに選び直さなくて済むよう、変えた時点で保存する。
    const next = { ...project, materialImages };
    setProject(next);
    saveProject(next);
  };

  const changeGenerateMissingImages = (generateMissingImages: boolean) => {
    const next = { ...project, generateMissingImages };
    setProject(next);
    saveProject(next);
  };

  const materialImageCount = project.materialImages?.length ?? 0;

  return (
    <>
      <main className="flow-main">
        <div className="panel flex flex-col gap-3 p-4">
          <span className="text-sm font-bold">AIがまとめて決めること</span>
          <div className="flex flex-wrap gap-1.5">
            {AI_DECIDES.map((label) => (
              <span key={label} className="badge-pill neutral" style={{ fontWeight: 400 }}>
                {label}
              </span>
            ))}
          </div>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            数分かかることがあります。字幕は次の編集画面で付けるか決められます。
          </span>
        </div>

        {hasReference ? (
          <span className="badge-pill success w-fit">見た目の手本({referenceCount}個)を最優先の手本にします</span>
        ) : (
          <div
            className="flex gap-2.5 rounded-[14px] p-3.5"
            style={{ background: "var(--warning-soft)", color: "#6b4b00" }}
          >
            <InfoIcon size={20} className="mt-0.5 shrink-0" />
            <div className="flex flex-col gap-1.5 text-sm">
              <span>見た目の手本が未設定です。設定すると、その雰囲気に寄せて編集します。</span>
              <a href="/create/style" className="btn-outline flex w-fit items-center gap-1 px-4 py-2 text-sm font-bold">
                見た目の手本を設定する
                <ChevronRightIcon size={16} />
              </a>
            </div>
          </div>
        )}

        {/* テンプレート: よく見るバズ編集の型を選ぶと、Geminiがその型に沿って編集する(見た目の手本があればそちらが優先) */}
        <div className="panel flex flex-col gap-2 p-4">
          <span className="text-sm font-bold">テンプレート(編集の型)</span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            作りたい動画に近いものを選んでください。文字の言葉やタイミングは、あなたの動画に合わせて作ります
            {hasReference ? "。見た目の手本と違う所は手本に合わせます" : ""}
          </span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[null, ...EDIT_TEMPLATES].map((template) => {
              const id = template?.id ?? null;
              const selected = templateId === id;
              return (
                <button
                  key={id ?? "none"}
                  type="button"
                  disabled={isProcessing}
                  onClick={() => selectTemplate(id)}
                  aria-pressed={selected}
                  className="flex flex-col items-start gap-0.5 rounded-lg p-3 text-left"
                  style={{
                    border: `2px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                    background: selected ? "var(--accent-soft)" : "var(--background-elevated)",
                  }}
                >
                  <span className="text-sm font-medium">
                    {template ? template.label : "おまかせ"}
                  </span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {template ? template.description : "型を決めず、動画の中身に合わせてAIが自由に編集します"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <MaterialImagesPanel
          images={project.materialImages ?? []}
          onChange={changeMaterialImages}
          generateMissing={project.generateMissingImages ?? true}
          onChangeGenerateMissing={changeGenerateMissingImages}
          disabled={isProcessing}
        />

        {isProcessing ? (
          <div className="panel flex flex-col gap-1 p-4">
            <span className="text-sm font-bold">AIが編集中…</span>
            {autoEditState.usedStyleReferenceCount !== null && autoEditState.usedStyleReferenceCount < referenceCount ? (
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                {autoEditState.usedStyleReferenceCount === 0
                  ? "見た目の手本がサーバー上に見つからなかったため、今回は手本無しで編集しています"
                  : `見た目の手本${referenceCount}個のうち${referenceCount - autoEditState.usedStyleReferenceCount}個がサーバー上に見つからなかったため、残りの${autoEditState.usedStyleReferenceCount}個で編集しています`}
                (見た目の手本の画面からもう一度選んでください)
              </span>
            ) : null}
            {autoEditState.usedMaterialImageCount !== null && autoEditState.usedMaterialImageCount < materialImageCount ? (
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                使う画像{materialImageCount}枚のうち{materialImageCount - autoEditState.usedMaterialImageCount}
                枚がサーバー上に見つからなかったため、残りで編集しています(消えた画像は✕で外して選び直してください)
              </span>
            ) : null}
          </div>
        ) : null}

        {/* 終わった時に実績を記録できるよう、処理中かどうかに関わらず置いておく(処理中だけ表示される) */}
        <WaitTime
          task="auto-edit"
          units={totalSeconds(keepRanges)}
          active={isProcessing}
          failed={autoEditState.status === "error"}
        />

        {autoEditState.status === "error" ? <p className="badge-pill danger w-fit">{autoEditState.message}</p> : null}

        {autoEditState.status === "done" ? (
          <div className="panel flex flex-col gap-3 p-4">
            <p className="text-sm">{autoEditState.plan.summary}</p>
            {autoEditState.plan.referenceNotes ? (
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                参考から読み取った編集の感じ: {autoEditState.plan.referenceNotes}
              </p>
            ) : null}
            <ul className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted)" }}>
              <li>
                {keepRanges.length}区間・{totalSeconds(keepRanges).toFixed(1)}秒 → {autoEditState.segments.length}
                クリップ・{totalSeconds(autoEditState.segments).toFixed(1)}秒
              </li>
              {autoEditState.plan.hook ? <li>冒頭の見出し: {autoEditState.plan.hook.headline}</li> : null}
              {autoEditState.plan.cta ? <li>締めの一言: {autoEditState.plan.cta.text}</li> : null}
              {autoEditState.plan.globalOverlays.length > 0 ? (
                <li>ずっと出す文字: {autoEditState.plan.globalOverlays.map((o) => o.text).join(" / ")}</li>
              ) : null}
              <li>寄り(ズーム): {autoEditState.segments.filter((s) => s.zoom).length}か所</li>
              <li>
                強調テキスト: {autoEditState.segments.reduce((sum, s) => sum + (s.overlays?.length ?? 0), 0)}個
              </li>
              <li>
                画像:{" "}
                {autoEditState.segments.reduce((sum, s) => sum + (s.images?.length ?? 0), 0) +
                  autoEditState.plan.globalImages.length}
                か所
                {autoEditState.plan.generatedImageCount > 0
                  ? `(うちAIで作った画像${autoEditState.plan.generatedImageCount}種類)`
                  : ""}
              </li>
              <li>
                効果音: {autoEditState.generatedClips.length}個
              </li>
            </ul>
            <p className="text-xs" style={{ color: "var(--muted-2)" }}>
              この案を使うと、クリップ構成と効果音が置き換わり、付けてあったAI音声は外れます(BGMはそのまま)。
            </p>
          </div>
        ) : null}
      </main>

      <div className="bottom-action-bar">
        {autoEditState.status === "done" ? (
          <>
            <button type="button" onClick={applyPlan} className="btn-primary">
              この案を使う
            </button>
            <button type="button" onClick={handleRun} className="btn-outline">
              別の案を作る
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handleRun}
            disabled={isProcessing}
            className="btn-primary"
          >
            <SparkleIcon size={18} />
            {autoEditState.status === "processing"
              ? "AIが編集中…"
              : autoEditState.status === "error"
                ? "もう一度自動編集する"
                : "AIで自動編集する"}
          </button>
        )}
        <button type="button" onClick={goToEditorWithoutChanges} className="btn-outline">
          <EditIcon size={18} />
          AIを使わず自分で編集する
        </button>
      </div>
    </>
  );
};
