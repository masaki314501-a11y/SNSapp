"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadProject, saveProject, type VideoProject } from "@/lib/videoProject";
import { toFriendlyErrorMessage } from "@/lib/friendlyError";
import { useWakeLock } from "../useWakeLock";
import { EXACT_LAST_STEP, runExactCopy, type ExactProgress } from "@/lib/exactCopy/client";

type RunState = { status: "idle" } | { status: "running"; progress: ExactProgress } | { status: "error"; message: string };

/**
 * 完全模倣の画面。カット動画に、1つ目の見た目の手本を丸ごと真似した編集をかける(中身だけ話している内容に合わせる)。
 * 作る順番は編集マニュアルの手順どおり。チェック項目は行わず、できたら編集画面を開く。
 */
export const ExactCopyScreen: React.FC = () => {
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

  const running = run.status === "running";
  useWakeLock(running);
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  if (!hasCheckedProject) return null;
  const referenceCount = project?.styleReferences?.length ?? 0;
  if (!project || referenceCount === 0) {
    return (
      <main className="flow-main">
        <div className="panel flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm font-medium">真似する手本がありません</p>
          <a href="/create/style" className="btn-primary px-4 py-1.5 text-sm">
            見た目の手本を選ぶ →
          </a>
        </div>
      </main>
    );
  }

  const start = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setRun({ status: "running", progress: { step: 1, title: "" } });
    try {
      await runExactCopy(project, {
        signal: controller.signal,
        onProgress: (progress) => setRun({ status: "running", progress }),
        onStep: (next) => {
          setProject(next);
          saveProject(next);
        },
      });
      setRun({ status: "idle" });
      router.push("/edit");
    } catch (caught) {
      setRun(controller.signal.aborted ? { status: "idle" } : { status: "error", message: toFriendlyErrorMessage(caught, "完全模倣で作れませんでした") });
    } finally {
      abortRef.current = null;
    }
  };

  return (
    <>
      <main className="flow-main">
        <div className="panel flex flex-col gap-1 p-4">
          <span className="text-sm font-bold">手本をそっくり真似して作ります</span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            1つ目の手本の見た目・並べ方・出し方をそのまま真似し、中身だけを話している内容に合わせます。チェック項目は使いません。
            終わったら編集画面が開きます。15分ほどかかります。終わるまで、この画面を開いたままにしてください。
          </span>
        </div>
        {run.status === "running" ? (
          <div className="panel flex flex-col gap-1 p-4">
            <span className="text-sm font-bold">
              作っています…({run.progress.step} / {EXACT_LAST_STEP})
            </span>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              {run.progress.title}
            </span>
          </div>
        ) : null}
        {run.status === "error" ? <p className="badge-pill danger w-fit">{run.message}</p> : null}
      </main>
      <div className="bottom-action-bar">
        <div className="bottom-action-row">
          {running ? (
            <button type="button" className="btn-outline" onClick={() => window.confirm("完全模倣をやめますか?") && abortRef.current?.abort()}>
              やめる
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={() => void start()}>
              完全模倣で作る
            </button>
          )}
        </div>
      </div>
    </>
  );
};
