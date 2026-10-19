"use client";

import { useState } from "react";
import type { CaptionFontFamily, CaptionFontSize, CaptionPosition, CaptionStyle } from "@video/shared/schema";
import type { ProjectSegment, ProjectSfxClip, VideoProject } from "@/lib/videoProject";
import { toFriendlyErrorMessage } from "@/lib/friendlyError";
import type { RawAutoEditPlan } from "@/lib/gemini/autoEditTypes";
import type { AutoEditProgress } from "@/lib/autoEditProgress";

const POLL_INTERVAL_MS = 1000;

export type AutoEditPlanSummary = {
  summary: string;
  /** 参考スクショ/動画から読み取った編集の癖。参考が無ければnull。 */
  referenceNotes: string | null;
  theme: {
    primaryColor?: string;
    fontFamily?: CaptionFontFamily;
    captionPosition?: CaptionPosition;
    captionStyle?: CaptionStyle;
    captionFontSize?: CaptionFontSize;
  };
  hook: VideoProject["hook"];
  cta: VideoProject["cta"];
  globalOverlays: NonNullable<VideoProject["globalOverlays"]>;
  globalImages: NonNullable<VideoProject["globalImages"]>;
  globalShapes: NonNullable<VideoProject["globalShapes"]>;
  framing: VideoProject["framing"];
  /** AIが作って使った画像の枚数(種類)。 */
  generatedImageCount: number;
  /** 使った画像の出どころ(本人の画像・貯めた画像・新しく作った画像)。古いサーバーからの答えには無い。 */
  imageSources?: { material: number; library: number; generated: number };
};

export type AutoEditResult = {
  status: "done";
  plan: AutoEditPlanSummary;
  segments: ProjectSegment[];
  generatedClips: ProjectSfxClip[];
  /** Geminiの生の答え。手直しのときに前回の案として送り返す。 */
  rawPlan: RawAutoEditPlan;
  /** 元の動画で話している区間。字幕を話に合わせて見せるのに使う。古いサーバーからの答えには無い。 */
  speechSpans?: [number, number][] | null;
};

export type AutoEditJobState =
  | { status: "idle" }
  /** usedStyleReferenceCount: サーバー上に見つかって手本にできた参考の数(渡した数より少なければ消えていた分がある)。 */
  /** usedMaterialImageCount: 同じく、サーバー上に見つかって使えた画像の数。 */
  /** progress: 今どの段階か(サーバーから届くまではnull)。 */
  | {
      status: "processing";
      usedStyleReferenceCount: number | null;
      usedMaterialImageCount: number | null;
      progress: AutoEditProgress | null;
    }
  | AutoEditResult
  | { status: "error"; message: string };

export type AutoEditRequest = {
  videoPath: string;
  videoDurationInSeconds: number;
  keepRanges: { startFromSeconds: number; durationInSeconds: number }[];
  styleReferencePaths: string[];
  /** editTemplates.tsのid。nullならテンプレート無し(おまかせ)。 */
  templateId: string | null;
  /** 自動編集で使ってよい画像。 */
  materialImages: { path: string; name: string }[];
  /** 使える画像が足りない所に、AIが作った画像を出してよいか。 */
  generateMissingImages: boolean;
  /** 新しく作ってよい画像の数。 */
  maxGeneratedImages: number;
  /** 左上のタイトル(空ならAIが決める)。 */
  title: string;
  /** 完成動画の長さの目安(秒)。nullならAIにまかせる。 */
  targetDurationSeconds: number | null;
  /** AIへの要望(空ならなし)。 */
  userRequest: string;
  /** 手直し。前回の案と、直してほしいこと。 */
  revision?: { previousPlan: RawAutoEditPlan; instruction: string };
};

/** 自動編集(Geminiに編集をすべて任せる)ジョブの開始+ポーリング。 */
/**
 * 処理中のジョブの番号。スマホで待っている間に別のアプリへ切り替えたり、画面を閉じたり再読み込みしたりしても、
 * 開き直した時に続きから結果を受け取れるよう、ブラウザに覚えておく(終わったら消す)。
 */
const PENDING_JOB_STORAGE_KEY = "sns-app:auto-edit-job:v1";
/** これより古い番号は、サーバー側で結果が消えているので使わない(autoEditJobs.tsのJOB_TTL_MSより短め)。 */
const PENDING_JOB_MAX_AGE_MS = 50 * 60 * 1000;

type PendingJob = { jobId: string; isRevision: boolean; startedAt: number };

const loadPendingJob = (): PendingJob | null => {
  try {
    const raw = window.localStorage.getItem(PENDING_JOB_STORAGE_KEY);
    const job = raw ? (JSON.parse(raw) as PendingJob) : null;
    return job && Date.now() - job.startedAt < PENDING_JOB_MAX_AGE_MS ? job : null;
  } catch {
    return null;
  }
};

const savePendingJob = (job: PendingJob | null) => {
  try {
    if (job) window.localStorage.setItem(PENDING_JOB_STORAGE_KEY, JSON.stringify(job));
    else window.localStorage.removeItem(PENDING_JOB_STORAGE_KEY);
  } catch {
    // 覚えておけなくても、画面を開いている間はそのまま進む
  }
};

/** 終わったことを知らせる。別のタブ・アプリにいる時は、タブの名前を変えて気づけるようにする(対応端末は振動も)。 */
const notifyFinished = (succeeded: boolean) => {
  try {
    navigator.vibrate?.(succeeded ? [120, 80, 120] : 300);
  } catch {
    // 振動できない端末(iPhone等)は何もしない
  }
  if (!document.hidden) return;
  const originalTitle = document.title;
  document.title = succeeded ? "✓ 自動編集ができました" : "自動編集が止まりました";
  const restore = () => {
    if (document.hidden) return;
    document.title = originalTitle;
    document.removeEventListener("visibilitychange", restore);
  };
  document.addEventListener("visibilitychange", restore);
};

/** 自動編集(Geminiに編集をすべて任せる)ジョブの開始+ポーリング。 */
export const useAutoEditJob = () => {
  const [autoEditState, setAutoEditState] = useState<AutoEditJobState>({ status: "idle" });
  /** 最後にできた案。手直しに失敗しても、前の案に戻って使えるように覚えておく。 */
  const [lastResult, setLastResult] = useState<AutoEditResult | null>(null);
  /** 今動いている(最後に動かした)のが手直しか。 */
  const [isRevision, setIsRevision] = useState(false);

  const pollJob = (jobId: string) => {
    let finished = false;
    const tick = async () => {
      if (finished) return;
      try {
        const res = await fetch(`/api/auto-edit/${jobId}`);
        const data = await res.json();
        if (res.status === 404) {
          throw new Error("サーバーが入れ替わったため、編集の結果を受け取れませんでした。お手数ですが、もう一度自動編集してください");
        }
        if (!res.ok) throw new Error(data.error ?? "状態取得に失敗しました");
        if (finished) return;

        if (data.status === "done" || data.status === "error") {
          stop();
          savePendingJob(null);
          setAutoEditState(data as AutoEditJobState);
          if (data.status === "done") setLastResult(data as AutoEditResult);
          notifyFinished(data.status === "done");
        } else {
          setAutoEditState((prev) =>
            prev.status === "processing"
              ? { ...prev, progress: data.stage ? { stage: data.stage, done: data.done, total: data.total } : prev.progress }
              : prev
          );
        }
      } catch (error) {
        stop();
        savePendingJob(null);
        setAutoEditState({
          status: "error",
          message: toFriendlyErrorMessage(error, "状態取得に失敗しました"),
        });
      }
    };
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    // 別のアプリから戻ってきた時は、間引かれていた確認をすぐ行う(スマホは裏にある画面のタイマーを止めるため)
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    const stop = () => {
      finished = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  };

  /** 前に始めて、まだ結果を受け取っていないジョブがあれば、続きから見る。あればtrue。 */
  const resumePendingJob = (): boolean => {
    const pending = loadPendingJob();
    if (!pending) {
      savePendingJob(null);
      return false;
    }
    setIsRevision(pending.isRevision);
    setAutoEditState({ status: "processing", usedStyleReferenceCount: null, usedMaterialImageCount: null, progress: null });
    pollJob(pending.jobId);
    return true;
  };

  const handleStart = async (request: AutoEditRequest) => {
    setIsRevision(Boolean(request.revision));
    setAutoEditState({ status: "processing", usedStyleReferenceCount: null, usedMaterialImageCount: null, progress: null });
    try {
      const res = await fetch("/api/auto-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "自動編集の開始に失敗しました");
      savePendingJob({ jobId: data.jobId, isRevision: Boolean(request.revision), startedAt: Date.now() });
      // 参考スクショがサーバー側で見つからなかった(再起動で消えた等)場合は、手本無しで進んでいることを表示する。
      setAutoEditState({
        status: "processing",
        usedStyleReferenceCount: Number(data.usedStyleReferenceCount ?? 0),
        usedMaterialImageCount: Number(data.usedMaterialImageCount ?? 0),
        progress: null,
      });
      pollJob(data.jobId);
    } catch (error) {
      setAutoEditState({
        status: "error",
        message: toFriendlyErrorMessage(error, "自動編集の開始に失敗しました"),
      });
    }
  };

  return { autoEditState, lastResult, isRevision, handleStart, resumePendingJob };
};
