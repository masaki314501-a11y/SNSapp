"use client";

import { useEffect, useRef, useState } from "react";
import {
  estimateWaitSeconds,
  formatApproxDuration,
  formatElapsed,
  recordWaitSeconds,
  type WaitTaskId,
} from "@/lib/waitEstimate";

type Props = {
  task: WaitTaskId;
  /** 見積もりに使う量(動画の秒数・枚数・MBなど。waitEstimate.tsのDEFAULTS参照)。 */
  units: number;
  /** 処理中の間だけtrue。trueになった瞬間から時間を計り、falseに戻った時に実績として記録する。 */
  active: boolean;
  /** 失敗で終わった時はtrueにする(失敗までの時間を実績として記録しないため)。 */
  failed?: boolean;
  /** 進み具合(0〜1)が分かる処理なら渡す。ある程度進んだら、実際の進み方から残り時間を出す。 */
  progress?: number | null;
  className?: string;
};

type Run = { task: WaitTaskId; units: number; startedAt: number };

/**
 * 処理中の操作の開始時刻(操作の種類ごと)。表示している部品が作り直されても(タブ切り替え等)
 * 経過時間を引き継げるよう、部品の外に置く。同じ種類の操作は同時に1つしか走らない前提。
 */
const runningTasks = new Map<WaitTaskId, Run>();
const STALE_RUN_MS = 30 * 60 * 1000;

/** 進捗が少ないうちは進み方からの推定が暴れやすいので、ここまでは目安(初期値・実績)を使う。 */
const MIN_PROGRESS_FOR_ETA = 0.05;

/**
 * 待ち時間のある操作の横に出す「目安 約2分・0:45経過」。待つ人が「あとどれくらいか」「止まって
 * いないか」を判断できるよう、目安と経過時間を常に見える形で出す(titleのような隠れた説明にしない)。
 * 目安を大きく過ぎた時は、壊れたのではなく混んでいるだけかもしれないことを伝える。
 */
export const WaitTime: React.FC<Props> = ({ task, units, active, failed, progress, className }) => {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // 終わった時に記録するため、開始時点の条件を覚えておく(途中でunitsが変わっても開始時の値で記録する)。
  const runRef = useRef<Run | null>(null);

  useEffect(() => {
    if (!active) {
      const run = runRef.current;
      runRef.current = null;
      runningTasks.delete(task);
      // 終わった時に実績として記録する。失敗で終わった時は、失敗までの時間は目安にならないので記録しない。
      // (cleanupの中だとfailedの最新値が見えないため、activeがfalseになった後のこの時点で判定する)
      // この部品が処理中の様子を見ていなかった(終わった後に表示された)場合は記録しない。
      if (run && !failed) recordWaitSeconds(run.task, run.units, (Date.now() - run.startedAt) / 1000);
      return;
    }
    // 同じ処理の途中で段階(変換→アップロード等)が切り替わった時は、前の段階を記録してから計り直す。
    const previous = runRef.current;
    if (previous && previous.task !== task) {
      recordWaitSeconds(previous.task, previous.units, (Date.now() - previous.startedAt) / 1000);
      runningTasks.delete(previous.task);
    }
    // 処理中にタブを切り替えて戻った等で作り直された時は、0から数え直さず最初の開始時刻を引き継ぐ。
    // 表示していない間に終わった処理の開始時刻が残っていることがあるので、極端に古いものは使わない。
    const kept = runningTasks.get(task);
    const run = kept && Date.now() - kept.startedAt < STALE_RUN_MS ? kept : { task, units, startedAt: Date.now() };
    runningTasks.set(task, run);
    runRef.current = run;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 処理が始まった瞬間を記録する
    setStartedAt(run.startedAt);
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
    // unitsは開始時の値だけ使う(処理中に変わっても計り直さない)。failedは終わった時だけ見る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, task]);

  if (!active || startedAt === null) return null;

  const elapsedSeconds = Math.max(0, (now - startedAt) / 1000);
  const estimate = estimateWaitSeconds(task, units);
  const progressEta =
    progress != null && progress >= MIN_PROGRESS_FOR_ETA && progress < 1 && elapsedSeconds > 0
      ? (elapsedSeconds / progress) * (1 - progress)
      : null;

  let text: string;
  if (progressEta !== null) {
    text = `残り${formatApproxDuration(progressEta)}`;
  } else if (elapsedSeconds <= estimate) {
    text = `目安${formatApproxDuration(estimate)}`;
  } else if (elapsedSeconds <= estimate * 2) {
    text = `目安(${formatApproxDuration(estimate)})より少しかかっています。もうすぐ終わるはずです`;
  } else {
    text = `目安(${formatApproxDuration(estimate)})よりかなりかかっています。混み合っているかもしれません`;
  }

  return (
    <span className={`text-xs tabular-nums ${className ?? ""}`} style={{ color: "var(--muted)" }}>
      ⏱ {text}・{formatElapsed(elapsedSeconds)}経過
    </span>
  );
};
