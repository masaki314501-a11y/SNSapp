"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadProject, saveProject, type VideoProject } from "@/lib/videoProject";
import { ChevronRightIcon, EditIcon, InfoIcon, SparkleIcon } from "@/components/icons";
import { toFriendlyErrorMessage } from "@/lib/friendlyError";
import { EDIT_STEPS } from "@/lib/editSteps/steps";
import { useWakeLock } from "../useWakeLock";
import { CHECK_STEP, MAX_AUTO_RETRIES, resumeStepOf, runAllSteps, runStepsFrom, type AutoRunProgress } from "@/lib/editSteps/client";

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

/** タイトルの長さの上限。サーバー(api/edit-step)と合わせる。 */
const MAX_TITLE_LENGTH = 40;

type RunState =
  | { status: "idle" }
  | { status: "running"; progress: AutoRunProgress }
  | { status: "error"; message: string; step: number | null };

/**
 * 「AIで自動編集する」画面。工程ごとの編集と同じ工程1〜14を、自動で順に流す(編集マニュアルの工程どおり)。
 * 最後の工程14で、工程ごとの編集と同じチェック項目を確かめ、AIの答えのぶれで「要修正」になった項目は、
 * その工程から自動でやり直す(MAX_AUTO_RETRIES回まで)。終わったら工程14のページを開き、
 * 目で確かめる項目にチェックを付ければ「生成完了」になる(工程ごとの編集と同じ終わり方)。
 */
export const AutoEditScreen: React.FC = () => {
  const router = useRouter();
  const [project, setProject] = useState<VideoProject | null>(null);
  const [hasCheckedProject, setHasCheckedProject] = useState(false);
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorageからの一度きりの初期ハイドレーション
    setProject(loadProject());
    setHasCheckedProject(true);
  }, []);

  // 流している間に画面を閉じると止まるので、閉じようとしたら確かめる
  const running = run.status === "running";
  // 待っている間にスマホの画面が消えて止まらないよう、流している間は画面を消さない
  useWakeLock(running);
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  if (!hasCheckedProject) return null;
  const keepCount = project ? (project.cutKeepRanges ?? project.segments).length : 0;
  if (!project || keepCount === 0) return <EmptyState />;

  const referenceCount = project.styleReferences?.length ?? 0;
  const update = (patch: Partial<VideoProject>) => {
    const next = { ...project, ...patch };
    setProject(next);
    saveProject(next);
  };

  // 前回の自動編集が途中で止まっている時(画面を閉じた・通信が切れた等)は、続きの工程から進められる
  const resumeFrom = resumeStepOf(project);

  /** from を渡すと、その工程から続きを進める(渡さなければ工程1から作り直す)。 */
  const start = async (from?: number) => {
    if (!from && project.editSteps?.results[1] && !window.confirm("今までの工程の結果を消して、工程1から作り直しますか?")) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const first = from ?? 1;
    setRun({ status: "running", progress: { step: first, title: EDIT_STEPS[first - 1].title, attempt: 0 } });
    let lastStep: number | null = null;
    try {
      const options = {
        signal: controller.signal,
        onProgress: (progress: AutoRunProgress) => {
          lastStep = progress.step;
          setRun({ status: "running", progress });
        },
        // 1工程ごとに保存する(途中で止まっても、工程ごとの編集の画面から続きができる)
        onStep: (next: VideoProject) => {
          setProject(next);
          saveProject(next);
        },
      };
      await (from ? runStepsFrom(project, from, options) : runAllSteps(project, options));
      setRun({ status: "idle" });
      router.push(`/create/steps/${CHECK_STEP}`);
    } catch (caught) {
      if (controller.signal.aborted) {
        setRun({ status: "idle" });
        return;
      }
      setRun({ status: "error", message: toFriendlyErrorMessage(caught, "自動編集できませんでした"), step: lastStep });
    } finally {
      abortRef.current = null;
    }
  };

  const cancel = () => {
    if (window.confirm("自動編集をやめますか?(終わった工程までは残ります。工程ごとの編集の画面から続きができます)")) {
      abortRef.current?.abort();
    }
  };

  const progress = run.status === "running" ? run.progress : null;

  return (
    <>
      <main className="flow-main">
        <div className="panel flex flex-col gap-1 p-4">
          <span className="text-sm font-bold">AIが編集マニュアルの工程1〜14を、自動で順に進めます</span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            工程ごとの編集と同じ工程・同じチェック項目で作ります。チェックで直す所が見つかったら、その工程から自動でやり直します。
            終わったら、目で確かめる項目にチェックを付けると完成です。5分ほどかかります。
          </span>
        </div>

        {progress ? (
          <div className="panel flex flex-col gap-2 p-4">
            <span className="text-sm font-bold">
              AIが編集中…(工程 {progress.step} / {EDIT_STEPS.length})
            </span>
            {progress.attempt > 0 ? (
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                チェックで直す所が見つかったので、やり直しています({progress.attempt}回目 / 最大{MAX_AUTO_RETRIES}回)
              </span>
            ) : null}
            <ol className="flex flex-col gap-1 text-sm">
              {EDIT_STEPS.map((item) => {
                const state = item.step < progress.step ? "done" : item.step === progress.step ? "now" : "wait";
                return (
                  <li key={item.step} className="flex items-center gap-2" style={{ color: state === "wait" ? "var(--muted-2)" : undefined }}>
                    <span style={{ width: 18, textAlign: "center" }}>{state === "done" ? "✓" : state === "now" ? "▶" : "・"}</span>
                    <span className={state === "now" ? "font-bold" : undefined}>
                      工程{item.step} {item.title}
                    </span>
                  </li>
                );
              })}
            </ol>
            <span className="text-xs font-semibold" style={{ color: "var(--warning-text, #9a6700)" }}>
              終わるまで、この画面を開いたままにしてください(閉じたり、別のアプリに切り替えたりすると止まります)。この間は、画面が自動で消えないようにしています。
            </span>
          </div>
        ) : null}

        {run.status === "error" ? (
          <div className="flex flex-col gap-2">
            <p className="badge-pill danger w-fit">
              {run.step ? `工程${run.step}で止まりました: ` : ""}
              {run.message}
            </p>
            {run.step && run.step > 1 ? (
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                終わった工程は残っています。下の「続きから自動で進める」で、止まった工程から進められます。
              </span>
            ) : null}
          </div>
        ) : null}

        {progress ? null : (
          <>
            {resumeFrom ? (
              <div className="panel flex flex-col gap-2 p-4" style={{ border: "2px solid var(--accent)" }}>
                <span className="text-sm font-bold">前回の自動編集は、工程{resumeFrom - 1}まで終わっています</span>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  途中で止まった所から、続きを自動で進められます。終わった工程はやり直さないので、早く終わります。
                </span>
                <button type="button" className="btn-primary self-start px-4 py-2 text-sm" onClick={() => void start(resumeFrom)}>
                  続きから自動で進める(工程{resumeFrom}から)
                </button>
              </div>
            ) : null}

            {referenceCount > 0 ? (
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
                onChange={(e) => update({ autoEditTitle: e.target.value })}
                maxLength={MAX_TITLE_LENGTH}
                placeholder="例: 知っておきたい〇〇5選"
                className="field-input w-full text-sm"
              />
            </div>

            <div className="panel flex flex-col gap-2 p-4">
              <label htmlFor="auto-edit-length" className="text-sm font-bold">
                長さの上限(秒)
              </label>
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                短くしたい時だけ入れます。空なら動画の長さのままです。入れた時は、超えた分をAIが前置きや繰り返しの場面から外します(工程12)。
              </span>
              <input
                id="auto-edit-length"
                type="number"
                min={5}
                max={180}
                value={project.targetDurationSeconds ?? ""}
                placeholder="例: 30"
                onChange={(e) => update({ targetDurationSeconds: Number(e.target.value) || null })}
                className="field-input text-sm"
                style={{ width: 100 }}
              />
            </div>

            <div className="panel flex flex-col gap-2 p-4">
              <label htmlFor="auto-edit-zone" className="text-sm font-bold">
                どこに出す動画か
              </label>
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                文字が隠れない範囲(セーフティゾーン)のチェックが変わります。広告の方が狭くなります。
              </span>
              <select
                id="auto-edit-zone"
                value={project.publishZone ?? "tiktok"}
                onChange={(e) => update({ publishZone: e.target.value as "tiktok" | "ad" })}
                className="field-input w-full text-sm"
              >
                <option value="tiktok">TikTok投稿</option>
                <option value="ad">広告</option>
              </select>
            </div>

            <div className="panel flex flex-col gap-2 p-4">
              <span className="text-sm font-bold">工程ごとに編集する</span>
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                同じ工程1〜14を、1つずつボタンで進めます。工程ごとに結果を確かめながら作りたい時に使います。
              </span>
              <button type="button" className="btn-outline self-start px-4 py-2 text-sm" onClick={() => router.push("/create/steps")}>
                工程ごとに編集する →
              </button>
            </div>
          </>
        )}
      </main>

      <div className="bottom-action-bar">
        {progress ? (
          <button type="button" onClick={cancel} className="btn-outline">
            自動編集をやめる
          </button>
        ) : (
          <>
            <button type="button" onClick={() => void start()} className="btn-primary">
              <SparkleIcon size={18} />
              {resumeFrom ? "はじめから自動編集する" : run.status === "error" ? "もう一度自動編集する" : "AIで自動編集する"}
            </button>
            <button type="button" onClick={() => router.push("/edit")} className="btn-outline">
              <EditIcon size={18} />
              AIを使わず自分で編集する
            </button>
          </>
        )}
      </div>
    </>
  );
};
