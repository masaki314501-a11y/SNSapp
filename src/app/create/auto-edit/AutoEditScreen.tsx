"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadProject, saveProject, type VideoProject } from "@/lib/videoProject";
import { useAutoEditJob, type AutoEditResult } from "../useAutoEditJob";
import { ChevronRightIcon, EditIcon, InfoIcon, SparkleIcon } from "@/components/icons";
import { EDIT_TEMPLATES, findEditTemplate } from "@/lib/editTemplates";
import { WaitTime } from "@/components/WaitTime";
import { AutoEditProgressList } from "./AutoEditProgressList";
import { cameraRuleForTemplate } from "@/lib/cameraRules";
import {
  DEFAULT_MAX_GENERATED_IMAGES,
  GenerateImagesField,
  MaterialImagesPanel,
  type MaterialImage,
} from "./MaterialImagesPanel";

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

/** 要望・手直しの指示の長さの上限。サーバー(api/auto-edit/route.ts)と合わせる。 */
const MAX_USER_TEXT_LENGTH = 1000;
/** タイトルの長さの上限。サーバーと合わせる。 */
const MAX_TITLE_LENGTH = 40;

/** 完成動画の長さの選択肢(秒)。nullはAIにまかせる。 */
const TARGET_DURATION_OPTIONS: (number | null)[] = [null, 15, 30, 45, 60, 90];


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
  const { autoEditState, lastResult, isRevision: isRevising, handleStart, resumePendingJob } = useAutoEditJob();
  /** 「ここを直して」の指示。直し終わったら空に戻す。 */
  const [revisionText, setRevisionText] = useState("");
  /** 選んだテンプレート。nullならおまかせ。次に開いた時も同じ型を使えるようプロジェクトに保存する。 */
  const [templateId, setTemplateId] = useState<string | null>(null);

  useEffect(() => {
    const loaded = loadProject();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorageからの一度きりの初期ハイドレーション
    setProject(loaded);
    setTemplateId(findEditTemplate(loaded?.editTemplateId)?.id ?? null);
    setHasCheckedProject(true);
    // 待っている間に画面を閉じた・別のアプリへ切り替えて画面が作り直された時は、前に始めた自動編集の続きを見る
    resumePendingJob();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いた時に一度だけ確かめる
  }, []);

  const keepRanges = project
    ? (project.cutKeepRanges ?? project.segments).map((s) => ({
        startFromSeconds: s.startFromSeconds,
        durationInSeconds: s.durationInSeconds,
      }))
    : [];

  const goToEditorWithoutChanges = () => router.push("/edit");

  const handleRun = (revision?: { previousPlan: AutoEditResult["rawPlan"]; instruction: string }) => {
    if (!project) return;
    void handleStart({
      videoPath: project.videoPath,
      videoDurationInSeconds: project.videoDurationInSeconds,
      keepRanges,
      styleReferencePaths: (project.styleReferences ?? []).map((reference) => reference.path),
      templateId,
      materialImages: project.materialImages ?? [],
      generateMissingImages: project.generateMissingImages ?? true,
      maxGeneratedImages: project.maxGeneratedImages ?? DEFAULT_MAX_GENERATED_IMAGES,
      title: project.autoEditTitle ?? "",
      targetDurationSeconds: project.targetDurationSeconds ?? null,
      userRequest: project.autoEditRequest ?? "",
      revision,
    });
  };

  // 手直しに失敗しても、前にできた案はそのまま使えるようにする。
  const result: AutoEditResult | null =
    autoEditState.status === "done" ? autoEditState : autoEditState.status === "error" ? lastResult : null;

  const handleRevise = () => {
    const instruction = revisionText.trim();
    if (!result || !instruction) return;
    handleRun({ previousPlan: result.rawPlan, instruction });
    setRevisionText("");
  };

  const applyPlan = () => {
    if (!project || !result) return;
    const { plan, segments, generatedClips } = result;
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
      fontSize: plan.theme.captionFontSize ?? project.fontSize,
      hook: plan.hook,
      cta: plan.cta,
      globalOverlays: plan.globalOverlays,
      globalImages: plan.globalImages,
      globalShapes: plan.globalShapes,
      framing: plan.framing,
      // 寄りは選んだテンプレートのカメラワークのルールで付けてある。編集画面で付け直す時も同じルールを選んでおく
      cameraRuleId: cameraRuleForTemplate(templateId),
      // クリップの切り方が変わると、以前の効果音・AI音声の秒位置は意味を失うため作り直す(AI音声は自動編集では作らないので外れる)。
      sfx: generatedClips,
    });
    // 次は、強調する字幕を選ぶ画面(自動編集の字幕は強調なしなので、強調は本人がここで選ぶ)
    router.push("/create/emphasis");
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

  const changeGenerate = (generateMissingImages: boolean, maxGeneratedImages: number) => {
    const next = { ...project, generateMissingImages, maxGeneratedImages };
    setProject(next);
    saveProject(next);
  };

  const changeTargetDuration = (targetDurationSeconds: number | null) => {
    const next = { ...project, targetDurationSeconds };
    setProject(next);
    saveProject(next);
  };

  const changeTitle = (autoEditTitle: string) => {
    const next = { ...project, autoEditTitle };
    setProject(next);
    saveProject(next);
  };

  const changeAutoEditRequest = (autoEditRequest: string) => {
    const next = { ...project, autoEditRequest };
    setProject(next);
    saveProject(next);
  };

  const materialImageCount = project.materialImages?.length ?? 0;

  return (
    <>
      <main className="flow-main">
        <div className="panel flex flex-col gap-1 p-4">
          <span className="text-sm font-bold">AIが切り方・タイトル・画像・寄り・効果音までまとめて編集します</span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            数分かかることがあります。字幕の強調は、次の画面で自分で選べます。
          </span>
        </div>

        {/* 処理中の様子と失敗の知らせは、画面を開き直した時にもすぐ目に入るよう、入力欄より上に出す */}
        {isProcessing ? (
          <div className="panel flex flex-col gap-1 p-4">
            <span className="text-sm font-bold">{isRevising ? "AIが手直し中…" : "AIが編集中…"}</span>
            <AutoEditProgressList progress={autoEditState.progress} isRevision={isRevising} />
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              待っている間は、別のアプリに切り替えたり画面を閉じたりしても大丈夫です。この画面を開き直すと、続きから結果が見られます。
            </span>
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

        {autoEditState.status === "error" ? (
          <p className="badge-pill danger w-fit">
            {autoEditState.message}
            {result ? "(前の案はそのまま使えます)" : ""}
          </p>
        ) : null}

        {hasReference ? (
          <span className="badge-pill success w-fit">見た目の手本({referenceCount}個)を最優先の手本にします</span>
        ) : (
          <div
            className="flex gap-2.5 rounded-xl p-3.5"
            style={{ background: "var(--warning-soft)", border: "1px solid var(--warning-text)", color: "var(--foreground)" }}
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

        <div className="panel flex flex-col gap-2 p-4">
          <div className="flex items-center gap-2">
            <label htmlFor="auto-edit-title" className="text-sm font-bold">
              左上のタイトル
            </label>
            <span className="badge-pill neutral">空ならAIが決めます</span>
          </div>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            動画の最初から最後まで、画面の左上に出します。あとから編集画面でも直せます。
          </span>
          <input
            id="auto-edit-title"
            type="text"
            value={project.autoEditTitle ?? ""}
            onChange={(e) => changeTitle(e.target.value)}
            maxLength={MAX_TITLE_LENGTH}
            disabled={isProcessing}
            placeholder="例: 矯正した方がいい歯並びTOP5"
            className="field-input w-full text-sm"
          />
        </div>

        <div className="panel flex flex-col gap-2 p-4">
          <label htmlFor="auto-edit-length" className="text-sm font-bold">
            完成動画の長さ
          </label>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            使う範囲は合計{totalSeconds(keepRanges).toFixed(0)}秒です。短くしたい時は、要点を残して前置きや繰り返しから削ります。
          </span>
          <select
            id="auto-edit-length"
            value={project.targetDurationSeconds ?? ""}
            disabled={isProcessing}
            onChange={(e) => changeTargetDuration(e.target.value ? Number(e.target.value) : null)}
            className="field-input w-full text-sm"
          >
            {TARGET_DURATION_OPTIONS.filter((seconds) => seconds === null || seconds < totalSeconds(keepRanges)).map((seconds) => (
              <option key={seconds ?? "auto"} value={seconds ?? ""}>
                {seconds === null ? "AIにまかせる(間を詰めるだけ)" : `${seconds}秒くらい`}
              </option>
            ))}
          </select>
        </div>

        {/* テンプレート: よく見るバズ編集の型を選ぶと、Geminiがその型に沿って編集する(見た目の手本があればそちらが優先) */}
        <div className="panel flex flex-col gap-2 p-4">
          <span className="text-sm font-bold">動画の型</span>
          {/* スマホで縦に長くならないよう、型は名前だけの小さいボタンを2列に並べ、説明は選んだ型の分だけ下に出す */}
          <div className="grid grid-cols-2 gap-2">
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
                  className="rounded-lg px-2 py-2.5 text-center text-sm font-medium"
                  style={{
                    border: `2px solid ${selected ? "var(--accent)" : "var(--color-neutral-solid-gray-420)"}`,
                    background: selected ? "var(--accent-soft)" : "var(--background-elevated)",
                  }}
                >
                  {template ? template.label : "おまかせ"}
                </button>
              );
            })}
          </div>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {findEditTemplate(templateId)?.description ?? "型を決めず、動画の中身に合わせてAIが自由に編集します"}
            {hasReference ? "(見た目の手本と違う所は手本に合わせます)" : ""}
          </span>
        </div>

        <MaterialImagesPanel
          images={project.materialImages ?? []}
          onChange={changeMaterialImages}
          disabled={isProcessing}
        />

        {/* 普段は触らなくてよい設定は畳んでおく(動画編集に詳しくない人が、どこを触ればいいか迷わないように) */}
        <details className="panel p-4">
          <summary className="cursor-pointer text-sm font-bold">詳しい設定(画像の作り方・AIへの要望)</summary>
          <div className="mt-3 flex flex-col gap-4">
            <GenerateImagesField
              generateMissing={project.generateMissingImages ?? true}
              maxGenerated={project.maxGeneratedImages ?? DEFAULT_MAX_GENERATED_IMAGES}
              onChange={changeGenerate}
              disabled={isProcessing}
            />
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <label htmlFor="auto-edit-request" className="text-sm font-bold">
                  AIへの要望
                </label>
                <span className="badge-pill neutral">なくてもOK</span>
              </div>
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                こうしてほしい所があれば書いてください。手本より優先します。
              </span>
              <textarea
                id="auto-edit-request"
                value={project.autoEditRequest ?? ""}
                onChange={(e) => changeAutoEditRequest(e.target.value)}
                maxLength={MAX_USER_TEXT_LENGTH}
                rows={3}
                disabled={isProcessing}
                placeholder={"例: 保証の話は日本の方に〇を付ける\n例: 強調の文字は黄色を多めに\n例: 最後に「保存してね」を出す"}
                className="field-input w-full text-sm"
              />
            </div>
          </div>
        </details>

        {result ? (
          <div className="panel flex flex-col gap-3 p-4">
            <p className="text-sm">{result.plan.summary}</p>
            {result.plan.referenceNotes ? (
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                参考から読み取った編集の感じ: {result.plan.referenceNotes}
              </p>
            ) : null}
            <ul className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted)" }}>
              <li>
                {keepRanges.length}区間・{totalSeconds(keepRanges).toFixed(1)}秒 → {result.segments.length}
                クリップ・{totalSeconds(result.segments).toFixed(1)}秒
              </li>
              {result.plan.hook ? <li>冒頭の見出し: {result.plan.hook.headline}</li> : null}
              {result.plan.cta ? <li>締めの一言: {result.plan.cta.text}</li> : null}
              {result.plan.globalOverlays.length > 0 ? (
                <li>ずっと出す文字: {result.plan.globalOverlays.map((o) => o.text).join(" / ")}</li>
              ) : null}
              <li>寄り(ズーム): {result.segments.filter((s) => s.zoom).length}か所</li>
              <li>
                強調テキスト: {result.segments.reduce((sum, s) => sum + (s.overlays?.length ?? 0), 0)}個
              </li>
              <li>
                画像:{" "}
                {result.segments.reduce((sum, s) => sum + (s.images?.length ?? 0), 0) +
                  result.plan.globalImages.length}
                か所
                {result.plan.imageSources
                  ? `(あなたの画像${result.plan.imageSources.material}種類・前に作った画像${result.plan.imageSources.library}種類・新しく作った画像${result.plan.imageSources.generated}種類)`
                  : result.plan.generatedImageCount > 0
                    ? `(うちAIで作った画像${result.plan.generatedImageCount}種類)`
                    : ""}
              </li>
              <li>
                効果音: {result.generatedClips.length}個
              </li>
            </ul>
            <p className="text-xs" style={{ color: "var(--muted-2)" }}>
              この案を使うと、クリップ構成と効果音が置き換わり、付けてあったAI音声は外れます(BGMはそのまま)。
            </p>
          </div>
        ) : null}

        {/* 手直し: 全部作り直すと良かった所まで変わるため、前の案を土台に言われた所だけ直させる */}
        {result && !isProcessing ? (
          <div className="panel flex flex-col gap-2 p-4">
            <label htmlFor="auto-edit-revision" className="text-sm font-bold">
              ここを直してほしい
            </label>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              直してほしい所だけを書くと、今の案を土台にその所だけ直します(ほかの所は変えません)。
            </span>
            <textarea
              id="auto-edit-revision"
              value={revisionText}
              onChange={(e) => setRevisionText(e.target.value)}
              maxLength={MAX_USER_TEXT_LENGTH}
              rows={3}
              placeholder={"例: 3位の画像を八重歯のイラストに替えて\n例: 20秒あたりの文字を小さく"}
              className="field-input w-full text-sm"
            />
            <button
              type="button"
              onClick={handleRevise}
              disabled={!revisionText.trim()}
              className="btn-outline flex w-fit items-center gap-1 px-4 py-2 text-sm font-bold"
            >
              <SparkleIcon size={16} />
              この内容で直す
            </button>
          </div>
        ) : null}
      </main>

      <div className="bottom-action-bar">
        {result && !isProcessing ? (
          <>
            <button type="button" onClick={applyPlan} className="btn-primary">
              この案を使う
            </button>
            <button type="button" onClick={() => handleRun()} className="btn-outline">
              別の案を作る
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => handleRun()}
            disabled={isProcessing}
            className="btn-primary"
          >
            <SparkleIcon size={18} />
            {autoEditState.status === "processing"
              ? isRevising
                ? "AIが手直し中…"
                : "AIが編集中…"
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
