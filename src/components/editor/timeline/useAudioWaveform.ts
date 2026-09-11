"use client";

import { useEffect, useState } from "react";

/**
 * SE/BGMの波形をWeb Audio APIでクライアント側デコードして取得するフック。
 * 音源1つにつき1回だけ高解像度(RESOLUTION個)のピーク配列にデコード・キャッシュし、
 * 各クリップブロックはズームに応じて必要な本数へその場でリサンプルする
 * (ズームが変わるたびに再デコードしないため)。
 *
 * デコードに失敗した場合(非対応コーデック等)はnullではなく空配列を返し、
 * 呼び出し側は波形無しのフラットなブロックとして描画すればよい。
 */

const RESOLUTION = 800;

const peaksCache = new Map<string, Float32Array>();
const errored = new Set<string>();
const pending = new Map<string, Promise<void>>();

const decodePeaks = async (src: string): Promise<Float32Array> => {
  const response = await fetch(src);
  const arrayBuffer = await response.arrayBuffer();
  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioContext = new AudioContextCtor();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const channel = audioBuffer.getChannelData(0);
    const peaks = new Float32Array(RESOLUTION);
    const chunkSize = Math.max(1, Math.floor(channel.length / RESOLUTION));
    for (let i = 0; i < RESOLUTION; i++) {
      const start = i * chunkSize;
      const end = Math.min(channel.length, start + chunkSize);
      let max = 0;
      for (let j = start; j < end; j++) {
        const value = Math.abs(channel[j]);
        if (value > max) max = value;
      }
      peaks[i] = max;
    }
    return peaks;
  } finally {
    void audioContext.close();
  }
};

const resample = (source: Float32Array, bucketCount: number): number[] => {
  if (bucketCount <= 0) return [];
  const result: number[] = new Array(bucketCount);
  for (let i = 0; i < bucketCount; i++) {
    const index = Math.min(source.length - 1, Math.floor((i / bucketCount) * source.length));
    result[i] = source[index];
  }
  return result;
};

export const useAudioWaveform = (src: string | null, bucketCount: number): number[] => {
  const [, bumpVersion] = useState(0);

  useEffect(() => {
    if (!src || peaksCache.has(src) || errored.has(src) || pending.has(src)) return;
    const task = decodePeaks(src)
      .then((peaks) => {
        peaksCache.set(src, peaks);
      })
      .catch(() => {
        errored.add(src);
      })
      .finally(() => {
        pending.delete(src);
        bumpVersion((v) => v + 1);
      });
    pending.set(src, task);
  }, [src]);

  if (!src || errored.has(src)) return [];
  const cached = peaksCache.get(src);
  if (!cached) return [];
  return resample(cached, bucketCount);
};
