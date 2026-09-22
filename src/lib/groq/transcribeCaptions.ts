import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { RenderInternals } from "@remotion/renderer";
import { z } from "zod";
import { CLIP_CAPTION_MAX_CHARS, truncateNaturally } from "../gemini/textUtils";
import { isGeminiMockEnabled } from "../gemini/mockMode";
import { createGroqClient } from "./groqClient";
import { GroqTimeoutError, isRetryableGroqError, toFriendlyGroqError } from "./groqErrors";
import { runWithGroqWhisperRateLimit } from "./rateLimiter";
import { recordGroqUsage } from "./usageLog";

/**
 * 字幕(テロップ)の自動生成。docs/gemini-multi-provider-offload/README.mdの方針案1に基づき、
 * Geminiから移行した(入力が音声のみで、Groqの無料枠(Whisper RPD 2,000、1日8時間相当)に
 * そのまま収まるため)。管理者の共有GROQ_API_KEYのみで動かし、BYOKには対応しない。
 *
 * GeminiのLLMに「意味のまとまりごとに区切って」と指示していた従来方式と異なり、Whisperは
 * 発話の区切り(ポーズ)をもとに機械的にセグメントを作る。言い淀みの除去や表記の整えは
 * 行わないため、字幕の仕上がりの質はGemini版よりやや落ちる可能性がある
 * (docs/gemini-multi-provider-offload/README.mdの「体感の品質が下がったと感じたら」参照)。
 */

const DEFAULT_MODEL = "whisper-large-v3-turbo";
const GROQ_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 4_000;
/** MAX_CLIPS(remotion/templates/standard/schema.ts)と同じ値。Whisperの自然な区切りが
 *  これを超えた場合だけ、隣接セグメントを間引いて統合する。 */
const MAX_CLIPS_SAFETY_CAP = 40;

export type TranscribedSegment = {
  startFromSeconds: number;
  durationInSeconds: number;
  caption: string;
};

export type TranscribeCaptionsInput = {
  /** サーバー上の絶対パス(アップロード済み動画)。 */
  absoluteVideoPath: string;
  videoDurationInSeconds: number;
  minClips: number;
  maxClips: number;
  onProgress?: (phase: "uploading" | "processing" | "generating") => void;
};

/** GEMINI_MOCK=1のときに返す固定のダミー結果(開発中の動作確認用)。動画長をクリップ数で均等分割する。 */
const buildMockSegments = (params: {
  videoDurationInSeconds: number;
  minClips: number;
  maxClips: number;
}): TranscribedSegment[] => {
  const { videoDurationInSeconds, minClips, maxClips } = params;
  const clipCount = Math.min(Math.max(minClips, 3), maxClips);
  const clipDuration = videoDurationInSeconds / clipCount;
  return Array.from({ length: clipCount }, (_, i) => ({
    startFromSeconds: i * clipDuration,
    durationInSeconds: clipDuration,
    caption: `(モック字幕 ${i + 1})`,
  }));
};

/**
 * 文字起こしにしか使わない動画から音声トラックだけを抽出し、一時WAVファイルに書き出す。
 * 映像フレームを一切送らないことで、動画まるごとアップロードする場合に比べて
 * アップロード量・処理時間を大幅に削減できる。
 */
const extractAudioTrack = async (videoPath: string): Promise<string> => {
  const audioPath = path.join(tmpdir(), `transcribe-audio-${randomUUID()}.wav`);
  await RenderInternals.callFf({
    bin: "ffmpeg",
    args: ["-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", audioPath],
    indent: false,
    logLevel: "error",
    binariesDirectory: null,
    cancelSignal: undefined,
  });
  return audioPath;
};

/**
 * GroqのWhisper verbose_json応答。groq-sdkのTypeScript型は`{ text: string }`しか
 * 定義していない(2026-09-23時点でTranscriptionVerbose型が存在しないことを
 * groq-typescriptのソースで確認済み)が、OpenAI互換のWhisper APIとして
 * segments/duration等を含む実データが返る想定で、緩めに検証する。
 */
const verboseTranscriptionSchema = z
  .object({
    duration: z.union([z.string(), z.number()]).optional(),
    segments: z
      .array(
        z
          .object({
            start: z.number(),
            end: z.number(),
            text: z.string(),
          })
          .passthrough()
      )
      .optional(),
    text: z.string().optional(),
  })
  .passthrough();

/** Whisperの自然なセグメント数がmaxClipsを超えた場合、隣接セグメントを均等にまとめて収める。 */
export const capSegments = <T extends { start: number; end: number; text: string }>(
  segments: T[],
  maxClips: number
): { start: number; end: number; text: string }[] => {
  if (segments.length <= maxClips) return segments;
  const groupSize = Math.ceil(segments.length / maxClips);
  const merged: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < segments.length; i += groupSize) {
    const group = segments.slice(i, i + groupSize);
    merged.push({
      start: group[0].start,
      end: group[group.length - 1].end,
      text: group.map((g) => g.text.trim()).join(" ").trim(),
    });
  }
  return merged;
};

/**
 * アップロード済み動画から音声トラックのみを抽出してGroqのWhisperに渡し、字幕クリップの
 * 開始秒・長さ・テロップを機械的な発話区切りから決定する。フォールバックは持たない
 * (失敗時に架空の文言で埋め合わせると誤情報になるため、呼び出し元でエラー表示する)。
 */
export const transcribeCaptions = async (
  input: TranscribeCaptionsInput
): Promise<TranscribedSegment[]> => {
  if (isGeminiMockEnabled()) {
    input.onProgress?.("uploading");
    input.onProgress?.("processing");
    input.onProgress?.("generating");
    return buildMockSegments({
      videoDurationInSeconds: input.videoDurationInSeconds,
      minClips: input.minClips,
      maxClips: input.maxClips,
    });
  }

  const groq = createGroqClient();
  const model = process.env.GROQ_WHISPER_MODEL || DEFAULT_MODEL;

  input.onProgress?.("uploading");
  // 文字起こしにしか使わないため、映像フレームは送らず音声トラックのみアップロードする。
  const audioPath = await extractAudioTrack(input.absoluteVideoPath);

  try {
    input.onProgress?.("processing");
    input.onProgress?.("generating");

    let lastError: unknown;
    let raw: z.infer<typeof verboseTranscriptionSchema> | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await runWithGroqWhisperRateLimit(() => {
          const transcribePromise = groq.audio.transcriptions.create({
            file: createReadStream(audioPath),
            model,
            response_format: "verbose_json",
            timestamp_granularities: ["segment"],
          });
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new GroqTimeoutError("Groq API timeout")), GROQ_TIMEOUT_MS);
          });
          return Promise.race([transcribePromise, timeoutPromise]);
        });

        const parsed = verboseTranscriptionSchema.safeParse(response);
        if (!parsed.success) {
          throw new Error(`Groq応答のスキーマ検証に失敗: ${parsed.error.message}`);
        }
        raw = parsed.data;
        recordGroqUsage("transcribeCaptions", model, `audio_duration_sec=${raw.duration ?? "?"}`);
        break;
      } catch (error) {
        lastError = error;
        if (isRetryableGroqError(error) && attempt < MAX_ATTEMPTS) {
          const delayMs = RETRY_BASE_DELAY_MS * attempt;
          console.warn(
            `[transcribeCaptions(groq)] Groqが混雑しているため${delayMs}ms後に再試行します(試行${attempt}/${MAX_ATTEMPTS}): ${
              error instanceof Error ? error.message : error
            }`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        console.error(
          `[transcribeCaptions(groq)] リトライ上限(${MAX_ATTEMPTS}回)に到達、または再試行不可のエラーで中断します(試行${attempt}/${MAX_ATTEMPTS})`,
          error
        );
        throw toFriendlyGroqError(error);
      }
    }
    if (!raw) {
      throw toFriendlyGroqError(lastError);
    }

    const rawSegments = (raw.segments ?? [])
      .map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }))
      .filter((s) => s.end > s.start);
    if (rawSegments.length === 0) {
      throw new Error("Groq応答から字幕セグメントを取得できませんでした");
    }

    const capped = capSegments(rawSegments, Math.min(input.maxClips, MAX_CLIPS_SAFETY_CAP));

    // 開始秒を基準に隙間・重複なく連続するよう長さを再計算する
    // (Whisper側のstart/endの丸め誤差を吸収するため)。
    const starts = [...capped.map((s) => Math.max(0, s.start)), input.videoDurationInSeconds];
    starts[0] = 0;

    return capped.map((segment, i) => ({
      startFromSeconds: starts[i],
      durationInSeconds: Math.max(0.1, starts[i + 1] - starts[i]),
      caption: truncateNaturally(segment.text, CLIP_CAPTION_MAX_CHARS),
    }));
  } finally {
    await rm(audioPath, { force: true }).catch(() => {});
  }
};
