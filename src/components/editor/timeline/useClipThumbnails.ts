"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * クリップのフィルムストリップ用サムネイルを、隠しvideo要素+canvasでクライアント側生成する。
 * サーバー側にffmpeg等の動画処理基盤が無いため(public/videos/配下の静的URLをブラウザで
 * 直接デコードする構成)、この方式が最も既存構成に馴染む。
 *
 * - 動画1本につき共有のvideo/canvas要素を1組だけ使い回す(クリップごとに専用デコーダを
 *   作ると数十デコーダが同時に走ってしまうため)。
 * - 生成ジョブは直列キューで1本ずつ処理する(要素を共有しているため並列にはできない)。
 * - 結果はモジュールスコープのMapにdataURLとしてキャッシュする。キーは動画パス+時刻なので、
 *   あるクリップをトリムしても、他クリップが参照していた時刻のキャッシュは無効化されない。
 */

const cache = new Map<string, string>();
const inflight = new Set<string>();
let sharedVideo: HTMLVideoElement | null = null;
let sharedCanvas: HTMLCanvasElement | null = null;
let currentVideoSrc = "";
const queue: { key: string; time: number; resolve: () => void }[] = [];
let processing = false;

const THUMB_WIDTH = 96;
const THUMB_HEIGHT = 171; // VIDEO_WIDTH:VIDEO_HEIGHT (1080:1920) と同じ縦長比率
const TIME_EPSILON = 0.05;

const ensureElements = (): { video: HTMLVideoElement; canvas: HTMLCanvasElement } | null => {
  if (typeof window === "undefined") return null;
  if (!sharedVideo) {
    sharedVideo = document.createElement("video");
    sharedVideo.muted = true;
    sharedVideo.playsInline = true;
    sharedVideo.preload = "auto";
  }
  if (!sharedCanvas) {
    sharedCanvas = document.createElement("canvas");
    sharedCanvas.width = THUMB_WIDTH;
    sharedCanvas.height = THUMB_HEIGHT;
  }
  return { video: sharedVideo, canvas: sharedCanvas };
};

const waitForSrc = (video: HTMLVideoElement, videoUrl: string): Promise<void> =>
  new Promise((resolve) => {
    if (currentVideoSrc === videoUrl && video.readyState >= 1) {
      resolve();
      return;
    }
    currentVideoSrc = videoUrl;
    const onLoaded = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      resolve();
    };
    video.addEventListener("loadedmetadata", onLoaded);
    video.src = videoUrl;
  });

const grabFrame = (video: HTMLVideoElement, canvas: HTMLCanvasElement, time: number): Promise<string> =>
  new Promise((resolve) => {
    const draw = () => {
      try {
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve("");
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.6));
      } catch {
        resolve("");
      }
    };
    if (Math.abs(video.currentTime - time) < TIME_EPSILON) {
      draw();
      return;
    }
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      draw();
    };
    const onError = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      resolve("");
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = time;
  });

const processQueue = async (videoUrl: string) => {
  if (processing) return;
  processing = true;
  const els = ensureElements();
  if (!els) {
    processing = false;
    return;
  }
  await waitForSrc(els.video, videoUrl);
  while (queue.length > 0) {
    const job = queue.shift();
    if (!job) break;
    if (cache.has(job.key)) {
      job.resolve();
      continue;
    }
    const dataUrl = await grabFrame(els.video, els.canvas, job.time);
    if (dataUrl) cache.set(job.key, dataUrl);
    inflight.delete(job.key);
    job.resolve();
  }
  processing = false;
};

/** widthPxに応じて、フィルムストリップに並べるサムネイル枚数を決める(狭いクリップは1枚)。 */
const thumbnailCountForWidth = (widthPx: number): number => Math.min(12, Math.max(1, Math.round(widthPx / 72)));

export const useClipThumbnails = (
  videoPath: string,
  startFromSeconds: number,
  durationInSeconds: number,
  widthPx: number
): (string | null)[] => {
  const count = thumbnailCountForWidth(widthPx);
  const videoUrl = videoPath.startsWith("/") ? videoPath : `/${videoPath}`;

  // トリム中は毎フレーム変わるので、少し落ち着いてからサンプル時刻を確定する
  // (ドラッグ中に大量のseekジョブを積まないようにするための軽量デバウンス)。
  const [settled, setSettled] = useState({ startFromSeconds, durationInSeconds, count });
  useEffect(() => {
    const timer = setTimeout(() => setSettled({ startFromSeconds, durationInSeconds, count }), 200);
    return () => clearTimeout(timer);
  }, [startFromSeconds, durationInSeconds, count]);

  const timestamps = useMemo(() => {
    const arr: number[] = [];
    for (let i = 0; i < settled.count; i++) {
      const t = settled.startFromSeconds + (settled.durationInSeconds * (i + 0.5)) / settled.count;
      arr.push(Math.max(0, t));
    }
    return arr;
  }, [settled]);

  const [, bumpVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    timestamps.forEach((time) => {
      const key = `${videoUrl}|${time.toFixed(2)}`;
      if (cache.has(key) || inflight.has(key)) return;
      inflight.add(key);
      queue.push({
        key,
        time,
        resolve: () => {
          if (!cancelled) bumpVersion((v) => v + 1);
        },
      });
    });
    void processQueue(videoUrl);
    return () => {
      cancelled = true;
    };
  }, [videoUrl, timestamps]);

  return timestamps.map((time) => cache.get(`${videoUrl}|${time.toFixed(2)}`) ?? null);
};
