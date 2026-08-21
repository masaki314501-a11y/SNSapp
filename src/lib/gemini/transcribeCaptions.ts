import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import { CLIP_CAPTION_MAX_CHARS, truncateNaturally } from "./textUtils";
import { runWithGeminiRateLimit } from "./rateLimiter";

const DEFAULT_MODEL = "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 60_000;
const FILE_ACTIVE_TIMEOUT_MS = 60_000;
const FILE_ACTIVE_POLL_INTERVAL_MS = 1_500;

export type TranscribeSegment = {
  startFromSeconds: number;
  durationInSeconds: number;
};

export type TranscribeCaptionsInput = {
  /** サーバー上の絶対パス(アップロード済み動画)。 */
  absoluteVideoPath: string;
  mimeType: string;
  segments: TranscribeSegment[];
};

const formatTimestamp = (totalSeconds: number): string => {
  const rounded = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const buildPrompt = (segments: TranscribeSegment[]): string => {
  const rangesSection = segments
    .map((segment, i) => {
      const start = formatTimestamp(segment.startFromSeconds);
      const end = formatTimestamp(segment.startFromSeconds + segment.durationInSeconds);
      return `  - クリップ${i + 1}: ${start} 〜 ${end}`;
    })
    .join("\n");

  return `
添付した動画の音声を文字起こしし、以下の時間帯ごとに実際に話されている内容をテロップ用の
短い日本語テキストにしてください。内容を創作せず、実際に話されている言葉をもとにしてください。

# 時間帯(この動画の再生時間を基準にしたタイムスタンプ)
${rangesSection}

# 出力ルール
- captionsは上記と同じ順序・同じ${segments.length}個の配列。
- 各要素は全角${CLIP_CAPTION_MAX_CHARS}文字以内。長い場合は意味を保ったまま短く要約する。
- 話し言葉の言い淀み(「えー」「あの」等)は取り除き、読みやすい書き言葉に整える。
- その時間帯に発話が無い、または聞き取れない場合は空文字列にする。
- JSON以外の文字列は出力しない。
`.trim();
};

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    captions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ["captions"],
} as const;

const rawResultSchema = z.object({
  captions: z.array(z.string()),
});

const waitForFileActive = async (
  ai: GoogleGenAI,
  fileName: string
): Promise<void> => {
  const deadline = Date.now() + FILE_ACTIVE_TIMEOUT_MS;
  for (;;) {
    const file = await ai.files.get({ name: fileName });
    if (file.state === "ACTIVE") return;
    if (file.state === "FAILED") {
      throw new Error("動画のアップロード処理に失敗しました");
    }
    if (Date.now() > deadline) {
      throw new Error("動画の処理がタイムアウトしました");
    }
    await new Promise((resolve) => setTimeout(resolve, FILE_ACTIVE_POLL_INTERVAL_MS));
  }
};

/**
 * アップロード済み動画をGemini File APIに渡し、指定した時間帯ごとに実際の発話内容を
 * 文字起こしして短いテロップ用テキストにする。フォールバックは持たない
 * (文字起こし失敗時に架空の文言で埋め合わせると誤情報になるため、呼び出し元でエラー表示する)。
 */
export const transcribeCaptions = async (
  input: TranscribeCaptionsInput
): Promise<string[]> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEYが未設定です");
  }
  if (input.segments.length === 0) {
    return [];
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  const uploaded = await ai.files.upload({
    file: input.absoluteVideoPath,
    config: { mimeType: input.mimeType },
  });
  if (!uploaded.name || !uploaded.uri) {
    throw new Error("動画のアップロードに失敗しました");
  }

  try {
    await waitForFileActive(ai, uploaded.name);

    const response = await runWithGeminiRateLimit(() => {
      const generatePromise = ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              { fileData: { fileUri: uploaded.uri!, mimeType: input.mimeType } },
              { text: buildPrompt(input.segments) },
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
    const text = response.text;
    if (!text) {
      throw new Error("Gemini APIから空の応答が返されました");
    }

    const parsed = rawResultSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      throw new Error(`Gemini応答のスキーマ検証に失敗: ${parsed.error.message}`);
    }

    return input.segments.map((_, i) => {
      const caption = parsed.data.captions[i]?.trim() ?? "";
      return truncateNaturally(caption, CLIP_CAPTION_MAX_CHARS);
    });
  } finally {
    await ai.files.delete({ name: uploaded.name }).catch(() => {});
  }
};
