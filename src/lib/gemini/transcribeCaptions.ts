import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GoogleGenAI, Type } from "@google/genai";
import { RenderInternals } from "@remotion/renderer";
import { z } from "zod";
import { CLIP_CAPTION_MAX_CHARS, truncateNaturally } from "./textUtils";
import { runWithGeminiRateLimit } from "./rateLimiter";
import { MISSING_API_KEY_MESSAGE, isDailyQuotaError, isRetryableApiError, toFriendlyGeminiError } from "./geminiErrors";
import { waitForGeminiFileActive } from "./geminiFiles";
import { recordGeminiDailyQuotaExceeded, recordGeminiUsage } from "./usageLog";
import { isGeminiMockEnabled } from "./mockMode";

const DEFAULT_MODEL = "gemini-3.6-flash";
const GEMINI_TIMEOUT_MS = 120_000;
const MAX_GENERATE_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 8_000;
const AUDIO_MIME_TYPE = "audio/wav";

export type TranscribedSegment = {
  startFromSeconds: number;
  durationInSeconds: number;
  caption: string;
};

export type TranscribeCaptionsInput = {
  /** サーバー上の絶対パス(アップロード済み動画)。 */
  absoluteVideoPath: string;
  mimeType: string;
  videoDurationInSeconds: number;
  minClips: number;
  maxClips: number;
  onProgress?: (phase: "uploading" | "processing" | "generating") => void;
  apiKeyOverride?: string;
};

const formatTimestamp = (totalSeconds: number): string => {
  const rounded = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const buildPrompt = (params: {
  videoDurationInSeconds: number;
  minClips: number;
  maxClips: number;
}): string => {
  const { videoDurationInSeconds, minClips, maxClips } = params;
  return `
添付した動画(全体の長さ: ${formatTimestamp(videoDurationInSeconds)})の音声を、実際に話している
YouTube/TikTokの自動字幕のように、一文または意味のまとまりごとに区切って文字起こししてください。
話されている内容を漏れなく、すべて字幕にすることが最優先です。1つのクリップに複数の文を
詰め込んで要約したり、一部を省略したりしないでください。

# 出力ルール
- segmentsは動画の先頭(00:00)から末尾(${formatTimestamp(videoDurationInSeconds)})までを
  隙間なく連続してカバーする配列。時系列順に並べる。個数の上限は${maxClips}個(目安であり、
  実際に話されている文の数だけ作ってよい。最低${minClips}個)。
- 各要素のstartFromSecondsはそのクリップの開始秒(先頭は0)、durationInSecondsはその
  クリップの長さ(秒)。次のクリップのstartFromSecondsは前のクリップの終了時刻と一致させる。
- 1クリップは実際の字幕と同じくらいのテンポ(目安1〜6秒)にする。長い発話は複数クリップに
  分割してでも、全ての発話内容が字幕として画面に表示されるようにする。
- captionは各クリップの時間帯で実際に話されている内容をそのまま短くしたもの。
  全角${CLIP_CAPTION_MAX_CHARS}文字以内に収まるよう、意味を保ったまま簡潔にする(要約による
  内容の欠落は避け、文が長い場合はクリップを分割する)。内容を創作せず、実際に話されている
  言葉をもとにする。言い淀み(「えー」「あの」等)は取り除き、読みやすい書き言葉に整える。
- 発話が無い、または聞き取れない区間はcaptionを空文字列にする(その場合もクリップ自体は
  時間軸を埋めるために残す)。
- JSON以外の文字列は出力しない。
`.trim();
};

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    segments: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          startFromSeconds: { type: Type.NUMBER },
          durationInSeconds: { type: Type.NUMBER },
          caption: { type: Type.STRING },
        },
        required: ["startFromSeconds", "durationInSeconds", "caption"],
      },
    },
  },
  required: ["segments"],
} as const;

const rawResultSchema = z.object({
  segments: z
    .array(
      z.object({
        startFromSeconds: z.number().min(0),
        durationInSeconds: z.number().positive(),
        caption: z.string(),
      })
    )
    .min(1),
});

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
 * 映像フレームを一切Geminiに渡さないことで、動画まるごとアップロードする場合に比べて
 * 入力トークンを大幅に削減できる(音声は32トークン/秒、映像込みの動画は263トークン/秒)。
 * PCM WAVへの変換を明示するため@remotion/rendererのffmpegバイナリを直接呼び出す
 * (extractAudio()相当の処理を、出力フォーマットを固定した上で自前で行う)。
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
 * アップロード済み動画から音声トラックのみを抽出してGemini File APIに渡し、音声全体を
 * 対象に文字起こしした上で、機械的な均等分割ではなく実際の発話の区切りを基準にクリップの
 * 開始秒・長さ・テロップを決定する。文字起こし用途では映像フレームの内容は使わないため、
 * 動画をまるごと渡さず音声だけを送ることでトークン消費を抑える。フォールバックは持たない
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

  const apiKey = input.apiKeyOverride || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[transcribeCaptions] GEMINI_API_KEYが未設定です(共有キーも自分のキーも無し)");
    throw new Error(MISSING_API_KEY_MESSAGE);
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  input.onProgress?.("uploading");
  // 文字起こしにしか使わないため、映像フレームは送らず音声トラックのみアップロードする。
  const audioPath = await extractAudioTrack(input.absoluteVideoPath);

  try {
    const uploaded = await ai.files.upload({
      file: audioPath,
      config: { mimeType: AUDIO_MIME_TYPE },
    });
    if (!uploaded.name || !uploaded.uri) {
      throw new Error("音声のアップロードに失敗しました");
    }

    try {
      input.onProgress?.("processing");
      await waitForGeminiFileActive(ai, uploaded.name);

      input.onProgress?.("generating");
      const prompt = buildPrompt({
        videoDurationInSeconds: input.videoDurationInSeconds,
        minClips: input.minClips,
        maxClips: input.maxClips,
      });

      let text: string | undefined;
      let lastError: unknown;
      for (let attempt = 1; attempt <= MAX_GENERATE_ATTEMPTS; attempt++) {
        try {
          const response = await runWithGeminiRateLimit(() => {
            const generatePromise = ai.models.generateContent({
              model,
              contents: [
                {
                  role: "user",
                  parts: [
                    { fileData: { fileUri: uploaded.uri!, mimeType: AUDIO_MIME_TYPE } },
                    { text: prompt },
                  ],
                },
              ],
              config: {
                responseMimeType: "application/json",
                responseSchema,
              },
            });
            const timeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error("Gemini API timeout")), GEMINI_TIMEOUT_MS);
            });
            return Promise.race([generatePromise, timeoutPromise]);
          });
          recordGeminiUsage("transcribeCaptions", model, response.usageMetadata);
          text = response.text;
          break;
        } catch (error) {
          lastError = error;
          if (isDailyQuotaError(error)) {
            recordGeminiDailyQuotaExceeded("transcribeCaptions");
          }
          if (isRetryableApiError(error) && attempt < MAX_GENERATE_ATTEMPTS) {
            const delayMs = RETRY_BASE_DELAY_MS * attempt;
            console.warn(
              `[transcribeCaptions] Geminiが混雑しているため${delayMs}ms後に再試行します(試行${attempt}/${MAX_GENERATE_ATTEMPTS}): ${
                error instanceof Error ? error.message : error
              }`
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            continue;
          }
          console.error(
            `[transcribeCaptions] リトライ上限(${MAX_GENERATE_ATTEMPTS}回)に到達、または再試行不可のエラーで中断します(試行${attempt}/${MAX_GENERATE_ATTEMPTS})`,
            error
          );
          throw toFriendlyGeminiError(error);
        }
      }
      if (!text) {
        if (lastError) throw toFriendlyGeminiError(lastError);
        throw new Error("Gemini APIから空の応答が返されました");
      }

      const parsed = rawResultSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        throw new Error(`Gemini応答のスキーマ検証に失敗: ${parsed.error.message}`);
      }

      const sorted = [...parsed.data.segments].sort(
        (a, b) => a.startFromSeconds - b.startFromSeconds
      );
      if (sorted.length < input.minClips || sorted.length > input.maxClips) {
        throw new Error(
          `Gemini応答のクリップ数が不正です(${sorted.length}個、期待値${input.minClips}〜${input.maxClips}個)`
        );
      }

      // 開始秒を基準に隙間・重複なく連続するよう長さを再計算する
      // (Gemini側のstartFromSecondsとdurationInSecondsの丸め誤差を吸収するため)。
      const starts = [...sorted.map((s) => Math.max(0, s.startFromSeconds)), input.videoDurationInSeconds];
      starts[0] = 0;

      return sorted.map((segment, i) => ({
        startFromSeconds: starts[i],
        durationInSeconds: Math.max(0.1, starts[i + 1] - starts[i]),
        caption: truncateNaturally(segment.caption.trim(), CLIP_CAPTION_MAX_CHARS),
      }));
    } finally {
      await ai.files.delete({ name: uploaded.name }).catch(() => {});
    }
  } finally {
    await rm(audioPath, { force: true }).catch(() => {});
  }
};
