"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Player } from "@remotion/player";
import { StandardVideo } from "@video/templates/standard/StandardVideo";
import { getStandardVideoDurationInFrames } from "@video/templates/standard/duration";
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "@video/shared/constants";
import { buildStandardVideoProps, loadProject, saveProject, type VideoProject } from "@/lib/videoProject";
import type { EditStepsRecord, StepState } from "@/lib/editSteps/logic";
import { toFriendlyErrorMessage } from "@/lib/friendlyError";
import { ChevronRightIcon } from "@/components/icons";
import { uploadAudioFile } from "@/components/editor/uploadAudioFile";
import { EDIT_STEPS } from "@/lib/editSteps/steps";


/** チェック項目を確かめる工程。 */
const CHECK_STEP = 14;
/** 長さの上限の初期値(秒)。チェック項目: 30秒以内の動画になっているか(お客様の指定があれば変えてよい)。 */
const DEFAULT_TARGET_SECONDS = 30;

const EMPTY_STATE: StepState = { segments: [], framing: null, captionYPercent: null, globalShapes: [], globalOverlays: [] };

/** 工程の状態をプロジェクトに書き込む(プレビュー・この後の画面で使う)。 */
const withState = (project: VideoProject, state: StepState): VideoProject => ({
  ...project,
  segments: state.segments,
  framing: state.framing ?? undefined,
  captionYPercent: state.captionYPercent ?? undefined,
  videoAdjust: state.videoAdjust ?? undefined,
  // 基本テロップの見た目は工程10で決める(それより前は、プロジェクトの設定のまま)
  ...(state.captionLook
    ? { fontFamily: state.captionLook.fontFamily, captionStyle: state.captionLook.captionStyle, primaryColor: state.captionLook.primaryColor }
    : {}),
  // BGMは工程13で入れる(それより前の工程では、前から入っていた物をそのままにする)
  bgm: state.bgm === undefined ? project.bgm : state.bgm,
  globalShapes: state.globalShapes,
  globalOverlays: state.globalOverlays,
  // 工程ごとの編集では、冒頭の見出し・締めの一言・画像は付けない。効果音は強調テロップの物だけ(クリップに付いている)
  hook: null,
  cta: null,
  globalImages: [],
  sfx: [],
});

/**
 * 「工程ごとに編集」画面。編集マニュアルの工程を、1工程=1ページで1つずつ進める(/create/steps/<工程の番号>)。
 * まとめてAIに任せると工程ごとの誤差が大きかったため、工程ごとに結果(何をしたか・その時点の動画)を見て確かめてから次へ進む。
 * 気に入らない工程は、その工程からやり直せる(後ろの工程の結果は消える)。
 * stepが無い時(/create/steps)は、まだ終わっていない最初の工程のページへ移る。
 */
export const StepsScreen: React.FC<{ step?: number }> = ({ step: pageStep }) => {
  const router = useRouter();
  const [project, setProject] = useState<VideoProject | null>(null);
  const [hasChecked, setHasChecked] = useState(false);
  const [running, setRunning] = useState<number | null>(null);
  const [error, setError] = useState<{ step: number; message: string } | null>(null);
  const [bgmUploading, setBgmUploading] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorageからの一度きりの初期ハイドレーション
    setProject(loadProject());
    setHasChecked(true);
  }, []);

  const record: EditStepsRecord = project?.editSteps ?? { results: {}, snapshots: {} };
  const doneCount = EDIT_STEPS.filter(({ step }) => record.results[step]).length;
  const nextStep = EDIT_STEPS.find(({ step }) => !record.results[step])?.step ?? CHECK_STEP;

  // 工程の番号が無い・まだ前の工程が終わっていない工程を開いた時は、進められる工程のページへ移る
  const reachable = (step: number) => step === 1 || Boolean(record.snapshots[step - 1]);
  const redirectTo = hasChecked && project && (pageStep === undefined || !reachable(pageStep)) ? nextStep : null;
  useEffect(() => {
    if (redirectTo !== null) router.replace(`/create/steps/${redirectTo}`);
  }, [redirectTo, router]);

  const props = useMemo(
    () =>
      project && project.segments.length > 0
        ? buildStandardVideoProps({
            videoPath: project.videoPath,
            segments: project.segments,
            primaryColor: project.primaryColor,
            captionStyle: project.captionStyle,
            fontFamily: project.fontFamily,
            captionPosition: project.captionPosition,
            fontSize: project.fontSize,
            fadeInOut: project.fadeInOut,
            sfxClips: project.sfx,
            bgm: project.bgm,
            globalOverlays: project.globalOverlays,
            globalShapes: project.globalShapes,
            framing: project.framing,
            captionTextStyleId: project.captionTextStyleId,
            captionYPercent: project.captionYPercent,
            videoAdjust: project.videoAdjust,
          })
        : null,
    [project]
  );

  if (!hasChecked) return null;
  if (!project) {
    return (
      <main className="flow-main">
        <div className="panel flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm font-medium">対象の動画がありません</p>
          <a href="/create" className="btn-primary px-4 py-1.5 text-sm">
            動画を選ぶ →
          </a>
        </div>
      </main>
    );
  }
  if (redirectTo !== null || pageStep === undefined) return null;

  const current = EDIT_STEPS.find((item) => item.step === pageStep) ?? EDIT_STEPS[0];
  const step = current.step;
  const result = record.results[step];
  const keepRanges = (project.cutKeepRanges ?? project.segments).map((s) => ({
    startFromSeconds: s.startFromSeconds,
    durationInSeconds: s.durationInSeconds,
  }));

  const runStep = async () => {
    const base = step === 1 ? EMPTY_STATE : record.snapshots[step - 1];
    if (!base) return;
    setRunning(step);
    setError(null);
    try {
      const response = await fetch("/api/edit-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step,
          videoPath: project.videoPath,
          videoDurationInSeconds: project.videoDurationInSeconds,
          keepRanges,
          state: base,
          targetSeconds: project.targetDurationSeconds ?? DEFAULT_TARGET_SECONDS,
          bgm: project.stepBgmChoice ?? null,
          zone: project.publishZone ?? "tiktok",
          globalImages: project.globalImages ?? [],
          look: {
            captionStyle: project.captionStyle,
            fontSize: project.fontSize,
            primaryColor: project.primaryColor,
            fontFamily: project.fontFamily,
            captionTextStyleId: project.captionTextStyleId,
            hasBgm: Boolean(project.bgm),
          },
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.state) throw new Error(json?.error ?? "工程を実行できませんでした");
      // この工程より後ろの結果は、土台が変わったので消す
      const results = Object.fromEntries(Object.entries(record.results).filter(([key]) => Number(key) < step));
      const snapshots = Object.fromEntries(Object.entries(record.snapshots).filter(([key]) => Number(key) < step));
      const next: VideoProject = {
        ...withState(project, json.state as StepState),
        // 工程1を始めた時点で、カット画面で残した範囲を覚えておく(工程1はいつもここから並べ直す)
        cutKeepRanges: keepRanges,
        editSteps: {
          results: { ...results, [step]: { note: json.note, details: json.details, checks: json.checks, at: new Date().toISOString() } },
          snapshots: { ...snapshots, [step]: json.state },
          // 中身が変わったので、目で確かめたチェックは付け直してもらう
          reviewed: {},
        },
      };
      setProject(next);
      saveProject(next);
    } catch (caught) {
      setError({ step, message: toFriendlyErrorMessage(caught, "工程を実行できませんでした") });
    } finally {
      setRunning(null);
    }
  };

  const checks = record.results[CHECK_STEP]?.checks ?? [];
  const reviewed = record.reviewed ?? {};
  const ngCount = checks.filter((item) => item.status === "ng").length;
  const toConfirm = checks.filter((item) => item.status !== "ok");
  const unreviewed = checks.filter((item) => item.status === "review" && !reviewed[item.id]).length;
  const canFinish = Boolean(record.results[CHECK_STEP]) && ngCount === 0 && unreviewed === 0 && running === null;
  const finishHint = !record.results[CHECK_STEP]
    ? "「実行」を押して、チェック項目を確かめてください"
    : ngCount > 0
      ? `直す必要がある項目が${ngCount}つあります`
      : unreviewed > 0
        ? `目で確かめる項目があと${unreviewed}つあります`
        : "すべてのチェック項目を満たしました";
  /** 工程の前に決めておく設定(長さの上限・どこに出す動画か・BGMの曲)を変える。 */
  const updateSettings = (patch: Partial<VideoProject>) => {
    const next: VideoProject = { ...project, ...patch };
    setProject(next);
    saveProject(next);
  };
  const chooseBgm = async (file: File | undefined) => {
    if (!file) return;
    setBgmUploading(true);
    try {
      const uploaded = await uploadAudioFile(file);
      updateSettings({ stepBgmChoice: { src: uploaded.path, label: uploaded.fileName } });
    } catch (caught) {
      setError({ step: 13, message: toFriendlyErrorMessage(caught, "曲を読み込めませんでした") });
    } finally {
      setBgmUploading(false);
    }
  };
  const toggleReviewed = (id: string) => {
    const next: VideoProject = { ...project, editSteps: { ...record, reviewed: { ...reviewed, [id]: !reviewed[id] } } };
    setProject(next);
    saveProject(next);
  };
  const goTo = (target: number) => router.push(`/create/steps/${target}`);

  return (
    <main className="flow-main flex flex-col gap-4">
      {/* 工程の進み具合。終わった工程・今の工程の点を押すと、そのページへ移る */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
          工程 {step} / {EDIT_STEPS.length}(完了 {doneCount})
        </span>
        <div className="flex gap-1" role="list" aria-label="工程の進み具合">
          {EDIT_STEPS.map((item) => {
            const done = Boolean(record.results[item.step]);
            const open = reachable(item.step);
            return (
              <button
                key={item.step}
                type="button"
                role="listitem"
                aria-label={`工程${item.step} ${item.title}${done ? "(完了)" : ""}`}
                aria-current={item.step === step ? "step" : undefined}
                disabled={!open}
                onClick={() => goTo(item.step)}
                style={{
                  flex: 1,
                  height: 8,
                  borderRadius: 4,
                  border: item.step === step ? "2px solid var(--accent)" : "none",
                  background: done ? "var(--accent)" : "var(--border)",
                  cursor: open ? "pointer" : "default",
                }}
              />
            );
          })}
        </div>
      </div>

      {props ? (
        <div className="panel p-2">
          <div style={{ height: 320, background: "#000", borderRadius: 8, overflow: "hidden" }}>
            <Player
              component={StandardVideo}
              inputProps={props}
              durationInFrames={Math.max(getStandardVideoDurationInFrames(props), 1)}
              fps={VIDEO_FPS}
              compositionWidth={VIDEO_WIDTH}
              compositionHeight={VIDEO_HEIGHT}
              style={{ width: "100%", height: "100%" }}
              controls
              clickToPlay
            />
          </div>
        </div>
      ) : null}

      <section className="panel flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <span className="step-badge">{step}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-base font-bold">
              {current.title}
              {current.usesAi ? (
                <span className="badge-pill ml-2" style={{ fontSize: 11 }}>
                  AI
                </span>
              ) : null}
            </span>
            <span className="text-sm" style={{ color: "var(--muted)" }}>
              {current.detail}
              {current.usesAi ? "。AIの料金と数十秒の待ち時間がかかります" : ""}
            </span>
          </div>
        </div>

        {step === 12 ? (
          <label className="editor-field">
            <span>長さの上限(秒)。お客様の指定が無ければ30秒のまま</span>
            <input
              type="number"
              min={5}
              max={180}
              value={project.targetDurationSeconds ?? DEFAULT_TARGET_SECONDS}
              onChange={(e) => updateSettings({ targetDurationSeconds: Number(e.target.value) || DEFAULT_TARGET_SECONDS })}
              style={{ width: 90 }}
            />
          </label>
        ) : null}
        {step === 13 ? (
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span>曲:</span>
            <span className="font-semibold">{project.stepBgmChoice?.label ?? "選んでいません"}</span>
            <span className="btn-outline px-3 py-1 text-sm" style={{ cursor: "pointer" }}>
              {bgmUploading ? "読み込み中…" : "曲を選ぶ"}
              <input type="file" accept="audio/*" className="sr-only" onChange={(e) => void chooseBgm(e.target.files?.[0])} />
            </span>
            {project.stepBgmChoice ? (
              <button type="button" className="btn-outline px-3 py-1 text-sm" onClick={() => updateSettings({ stepBgmChoice: null })}>
                外す
              </button>
            ) : null}
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              商用で使ってよい曲を選んでください。入れない時は、曲を選ばずに「実行」を押します
            </span>
          </label>
        ) : null}
        {step === CHECK_STEP ? (
          <label className="editor-field">
            <span>どこに出す動画か(セーフティゾーンが変わります)</span>
            <select
              value={project.publishZone ?? "tiktok"}
              onChange={(e) => updateSettings({ publishZone: e.target.value as "tiktok" | "ad" })}
            >
              <option value="tiktok">TikTok投稿</option>
              <option value="ad">広告</option>
            </select>
          </label>
        ) : null}

        <button
          type="button"
          className={result ? "btn-outline self-start px-4 py-2 text-sm" : "btn-primary self-start px-4 py-2 text-sm"}
          disabled={running !== null}
          onClick={() => void runStep()}
        >
          {running === step ? "実行中…" : result ? "やり直す" : "実行"}
        </button>
        {result ? (
          <div className="flex flex-col gap-1 rounded-md p-3 text-sm" style={{ background: "var(--accent-soft)" }}>
            <span className="font-semibold">✓ {result.note}</span>
            {result.details?.map((line, index) => (
              <span key={index} className="text-xs" style={{ color: "var(--muted)" }}>
                ・{line}
              </span>
            ))}
          </div>
        ) : null}
        {/* 自動で満たしている項目(○)は出さず、確かめてほしい物(目で確かめる項目と、直す必要がある項目)だけを出す */}
        {step === CHECK_STEP && toConfirm.length > 0 ? (
          <ul className="flex flex-col gap-1.5 text-xs">
            <span className="text-sm font-semibold">確かめてほしいこと</span>
            {toConfirm.map((item) => (
              <li key={item.id} className="flex items-start gap-2">
                {item.status === "review" ? (
                  <input
                    type="checkbox"
                    aria-label={`${item.label}を確かめた`}
                    checked={Boolean(reviewed[item.id])}
                    onChange={() => toggleReviewed(item.id)}
                    style={{ marginTop: 2 }}
                  />
                ) : (
                  <span className="font-bold" style={{ color: "var(--danger-text, crimson)", whiteSpace: "nowrap" }}>
                    要修正
                  </span>
                )}
                <span className="flex flex-col">
                  <span className="font-semibold">{item.label}</span>
                  <span style={{ color: "var(--muted)" }}>{item.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {error?.step === step ? <p className="badge-pill danger w-fit">{error.message}</p> : null}
      </section>

      <div className="bottom-action-bar">
        {step === CHECK_STEP ? (
          <>
            <span className="text-xs text-center" style={{ color: "var(--muted)" }}>
              {finishHint}
            </span>
            <button type="button" className="btn-primary" disabled={!canFinish} onClick={() => router.push("/create/emphasis")}>
              生成完了(強調する字幕を確かめる)
              <ChevronRightIcon size={18} />
            </button>
          </>
        ) : (
          <button type="button" className="btn-primary" disabled={!result || running !== null} onClick={() => goTo(step + 1)}>
            {result ? `次の工程へ(工程${step + 1})` : "「実行」を押すと、次の工程へ進めます"}
            <ChevronRightIcon size={18} />
          </button>
        )}
        {step > 1 ? (
          <button type="button" className="btn-outline" disabled={running !== null} onClick={() => goTo(step - 1)}>
            前の工程へ(工程{step - 1})
          </button>
        ) : null}
      </div>
    </main>
  );
};
