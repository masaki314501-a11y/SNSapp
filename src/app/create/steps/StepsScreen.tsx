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

/** 編集マニュアルの工程(番号・名前・中身)。AIを使う工程には印を付ける(料金と待ち時間がかかる)。 */
export const EDIT_STEPS: { step: number; title: string; detail: string; usesAi: boolean }[] = [
  { step: 1, title: "メイン映像を配置する", detail: "使う範囲を選ぶ画面で残した部分を、順に並べます", usesAi: false },
  { step: 2, title: "話し始める前の不要な部分を削除する", detail: "音声から話し始めを見つけて、その前を切ります", usesAi: false },
  { step: 3, title: "言い間違いや言葉に詰まった部分をカットする", detail: "言い直す前の言葉や「えーと」をAIが見つけて切ります", usesAi: true },
  { step: 4, title: "説明の間にある長い無音部分を削除する", detail: "0.5秒以上の無音を、前後に少し余白を残して切ります", usesAi: false },
  { step: 5, title: "話の流れが自然になるように前後の映像をつなぐ", detail: "切れ目を言葉の途切れに合わせ、ちらつく短い切れ端を外します", usesAi: false },
  { step: 6, title: "映像を拡大し、人物の位置を整える", detail: "AIが顔の位置を調べ、顔が中央より少し高めに来るよう拡大します", usesAi: true },
  { step: 7, title: "テロップの位置を決める", detail: "演者の顎より少し下に、演者と被らないよう固定します", usesAi: false },
  { step: 8, title: "必要なオブジェクトを作成する", detail: "左上のタイトルと、ランキングの動画なら枠をAIが決めて作ります", usesAi: true },
  { step: 9, title: "テロップを入力する", detail: "話している言葉をAIが書き起こして入れます(位置は工程7で固定)", usesAi: true },
  { step: 10, title: "強調したい言葉を違うテロップに変換する", detail: "AIが強調したい言葉を選び、強調テロップにします", usesAi: true },
  { step: 11, title: "強調テロップに効果音をつけ、少し人物を拡大する", detail: "強調テロップに効果音と、少しの寄りを付けます", usesAi: false },
  { step: 12, title: "決めた長さに収める(長い時だけ)", detail: "上で決めた長さ(初期は30秒)を超えていたら、AIが前置きや繰り返しの場面を外します", usesAi: true },
  { step: 13, title: "BGMを入れる(なくてもよい)", detail: "選んだ曲を、話し声より小さな音量で頭から入れ、最後に音量を下げて終わらせます", usesAi: false },
  { step: 14, title: "チェック項目を確かめる", detail: "編集時チェック項目を確かめます。光の補正は明るさを測って自動で行い、誤字・脱字はAIが音声と見比べます", usesAi: true },
];

/** チェック項目を確かめる工程。 */
const CHECK_STEP = 14;
/** 長さの上限の初期値(秒)。チェック項目: 30秒以内の動画になっているか(お客様の指定があれば変えてよい)。 */
const DEFAULT_TARGET_SECONDS = 30;

const CHECK_MARK = { ok: "○", ng: "×", review: "目視" } as const;

const EMPTY_STATE: StepState = { segments: [], framing: null, captionYPercent: null, globalShapes: [], globalOverlays: [] };

/** 工程の状態をプロジェクトに書き込む(プレビュー・この後の画面で使う)。 */
const withState = (project: VideoProject, state: StepState): VideoProject => ({
  ...project,
  segments: state.segments,
  framing: state.framing ?? undefined,
  captionYPercent: state.captionYPercent ?? undefined,
  videoAdjust: state.videoAdjust ?? undefined,
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
 * 「工程ごとに編集」画面。編集マニュアルの工程1〜11を、工程ごとのボタンで1つずつ進める。
 * まとめてAIに任せると工程ごとの誤差が大きかったため、工程ごとに結果(何をしたか・その時点の動画)を見て確かめてから次へ進む。
 * 気に入らない工程は、その工程からやり直せる(後ろの工程の結果は消える)。
 */
export const StepsScreen: React.FC = () => {
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
  const nextStep = EDIT_STEPS.find(({ step }) => !record.results[step])?.step ?? null;

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

  const keepRanges = (project.cutKeepRanges ?? project.segments).map((s) => ({
    startFromSeconds: s.startFromSeconds,
    durationInSeconds: s.durationInSeconds,
  }));

  const runStep = async (step: number) => {
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
  const unreviewed = checks.filter((item) => item.status === "review" && !reviewed[item.id]).length;
  const canFinish = Boolean(record.results[CHECK_STEP]) && ngCount === 0 && unreviewed === 0 && running === null;
  const finishHint = !record.results[CHECK_STEP]
    ? `工程${CHECK_STEP}までを終えると、生成完了にできます`
    : ngCount > 0
      ? `満たしていない項目(×)が${ngCount}つあります`
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

  return (
    <main className="flow-main flex flex-col gap-4">
      <div className="panel flex flex-col gap-1 p-4">
        <span className="text-sm font-bold">編集マニュアルの工程を、1つずつ進めます</span>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          工程ごとに「実行」を押し、結果と下の動画を確かめてから次へ進んでください。気に入らない工程は「やり直す」で、その工程から作り直せます(後ろの工程はやり直しになります)。「AI」の印がある工程は、AIの料金と数十秒の待ち時間がかかります。
        </span>
        <span className="text-xs font-semibold">
          {doneCount} / {EDIT_STEPS.length} 工程が完了
        </span>
        <div className="mt-2 flex flex-wrap gap-3">
          <label className="editor-field">
            <span>どこに出す動画か</span>
            <select
              value={project.publishZone ?? "tiktok"}
              onChange={(e) => updateSettings({ publishZone: e.target.value as "tiktok" | "ad" })}
            >
              <option value="tiktok">TikTok投稿</option>
              <option value="ad">広告</option>
            </select>
          </label>
          <label className="editor-field">
            <span>長さの上限(秒)</span>
            <input
              type="number"
              min={5}
              max={180}
              value={project.targetDurationSeconds ?? DEFAULT_TARGET_SECONDS}
              onChange={(e) => updateSettings({ targetDurationSeconds: Number(e.target.value) || DEFAULT_TARGET_SECONDS })}
              style={{ width: 90 }}
            />
          </label>
        </div>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          長さの上限は、お客様の指定が無ければ30秒のままにしてください。広告に出す時は、チェックのセーフティゾーンが広告用になります。
        </span>
      </div>

      {props ? (
        <div className="panel p-2" style={{ position: "sticky", top: 0, zIndex: 5 }}>
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

      <ol className="flex flex-col gap-3">
        {EDIT_STEPS.map(({ step, title, detail, usesAi }) => {
          const result = record.results[step];
          const canRun = running === null && (step === 1 || Boolean(record.snapshots[step - 1]));
          const isNext = step === nextStep;
          return (
            <li
              key={step}
              className="panel flex flex-col gap-2 p-4"
              style={{ borderColor: isNext ? "var(--accent)" : undefined, opacity: canRun || result ? 1 : 0.6 }}
            >
              <div className="flex items-start gap-3">
                <span className="step-badge">{step}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-sm font-bold">
                    {title}
                    {usesAi ? (
                      <span className="badge-pill ml-2" style={{ fontSize: 11 }}>
                        AI
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {detail}
                  </span>
                </div>
                <button
                  type="button"
                  className={result ? "btn-outline px-3 py-1.5 text-sm" : "btn-primary px-3 py-1.5 text-sm"}
                  disabled={!canRun}
                  onClick={() => void runStep(step)}
                >
                  {running === step ? "実行中…" : result ? "やり直す" : "実行"}
                </button>
              </div>
              {result ? (
                <div className="flex flex-col gap-1 rounded-md p-2 text-xs" style={{ background: "var(--accent-soft)" }}>
                  <span className="font-semibold">✓ {result.note}</span>
                  {result.details?.map((line, index) => (
                    <span key={index} style={{ color: "var(--muted)" }}>
                      ・{line}
                    </span>
                  ))}
                </div>
              ) : null}
              {step === 13 ? (
                <label className="flex flex-wrap items-center gap-2 text-xs">
                  <span>曲:</span>
                  <span className="font-semibold">{project.stepBgmChoice?.label ?? "選んでいません"}</span>
                  <span className="btn-outline px-3 py-1 text-xs" style={{ cursor: "pointer" }}>
                    {bgmUploading ? "読み込み中…" : "曲を選ぶ"}
                    <input
                      type="file"
                      accept="audio/*"
                      className="sr-only"
                      onChange={(e) => void chooseBgm(e.target.files?.[0])}
                    />
                  </span>
                  {project.stepBgmChoice ? (
                    <button type="button" className="btn-outline px-3 py-1 text-xs" onClick={() => updateSettings({ stepBgmChoice: null })}>
                      外す
                    </button>
                  ) : null}
                  <span style={{ color: "var(--muted)" }}>商用で使ってよい曲を選んでください。選び直した時は「やり直す」を押します</span>
                </label>
              ) : null}
              {step === CHECK_STEP && checks.length > 0 ? (
                <ul className="flex flex-col gap-1.5 text-xs">
                  {checks.map((item) => (
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
                        <span
                          className="font-bold"
                          style={{ color: item.status === "ok" ? "var(--success-text, green)" : "var(--danger-text, crimson)", minWidth: 13 }}
                        >
                          {CHECK_MARK[item.status]}
                        </span>
                      )}
                      <span className="flex flex-col">
                        <span className="font-semibold">
                          [{item.group}] {item.label}
                          {item.status === "review" ? "(目で確かめてチェック)" : ""}
                        </span>
                        <span style={{ color: "var(--muted)" }}>{item.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {error?.step === step ? <p className="badge-pill danger w-fit">{error.message}</p> : null}
            </li>
          );
        })}
      </ol>

      <div className="bottom-action-bar">
        <span className="text-xs text-center" style={{ color: "var(--muted)" }}>
          {finishHint}
        </span>
        <button type="button" className="btn-primary" disabled={!canFinish} onClick={() => router.push("/create/emphasis")}>
          生成完了(強調する字幕を確かめる)
          <ChevronRightIcon size={18} />
        </button>
      </div>
    </main>
  );
};
