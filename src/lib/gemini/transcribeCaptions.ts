import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import { CLIP_CAPTION_MAX_CHARS, truncateNaturally } from "./textUtils";
import { runWithGeminiRateLimit } from "./rateLimiter";
import { isRetryableApiError, toFriendlyGeminiError } from "./geminiErrors";
import { waitForGeminiFileActive } from "./geminiFiles";

const DEFAULT_MODEL = "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 120_000;
const MAX_GENERATE_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 8_000;

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

/**
 * アップロード済み動画をGemini File APIに渡し、動画全体を対象に音声を文字起こしした上で、
 * 機械的な均等分割ではなく実際の発話の区切りを基準にクリップの開始秒・長さ・テロップを
 * 決定する。フォールバックは持たない(失敗時に架空の文言で埋め合わせると誤情報になるため、
 * 呼び出し元でエラー表示する)。
 */
export const transcribeCaptions = async (
  input: TranscribeCaptionsInput
): Promise<TranscribedSegment[]> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEYが未設定です");
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  input.onProgress?.("uploading");
  const uploaded = await ai.files.upload({
    file: input.absoluteVideoPath,
    config: { mimeType: input.mimeType },
  });
  if (!uploaded.name || !uploaded.uri) {
    throw new Error("動画のアップロードに失敗しました");
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
                  { fileData: { fileUri: uploaded.uri!, mimeType: input.mimeType } },
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
        text = response.text;
        break;
      } catch (error) {
        lastError = error;
        if (isRetryableApiError(error) && attempt < MAX_GENERATE_ATTEMPTS) {
          const delayMs = RETRY_BASE_DELAY_MS * attempt;
          console.warn(
            `[transcribeCaptions] Geminiが混雑しているため${delayMs}ms後に再試行します(試行${attempt}/${MAX_GENERATE_ATTEMPTS})`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
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
};
