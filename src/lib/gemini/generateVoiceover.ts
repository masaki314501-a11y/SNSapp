import { GoogleGenAI } from "@google/genai";
import { runWithGeminiRateLimit } from "./rateLimiter";
import { isRetryableApiError, toFriendlyGeminiError } from "./geminiErrors";

const DEFAULT_MODEL = "gemini-2.5-flash-preview-tts";
const GEMINI_TIMEOUT_MS = 60_000;
const MAX_GENERATE_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 8_000;
const DEFAULT_SAMPLE_RATE = 24_000;

export type GenerateVoiceoverInput = {
  text: string;
  voiceName: string;
};

/**
 * GeminiのTTSプレビューモデルは、リクエスト自体は200 OKで成功するのに音声データが
 * 空(finishReason=OTHER等)で返ってくることが一定確率である既知の問題を抱えている
 * (Google公式ドキュメントも「テキストトークンが誤って返り500になることがあるため
 * リトライを実装すること」と案内しており、同種の一過性の不具合)。
 * HTTPレベルのエラーではないため isRetryableApiError では拾えず、専用にリトライ対象と
 * して扱う。
 */
class NoAudioDataError extends Error {}

/** Gemini TTSのレスポンスmimeType(例: "audio/L16;codec=pcm;rate=24000")からサンプルレートを取り出す。 */
const parseSampleRate = (mimeType: string | undefined): number => {
  const match = mimeType?.match(/rate=(\d+)/);
  return match ? Number(match[1]) : DEFAULT_SAMPLE_RATE;
};

/**
 * 16bit PCM(リトルエンディアン・モノラル)の生データに、そのままブラウザ/ffmpegで再生・
 * 読み込みできるようWAVヘッダーを付与する。
 */
const pcmToWav = (pcmData: Buffer, sampleRate: number, channels = 1, bitsPerSample = 16): Buffer => {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcmData.length, 40);
  return Buffer.concat([header, pcmData]);
};

/**
 * テロップの文言をGemini TTSで読み上げ音声(WAV)に変換する。フォールバックは持たない
 * (失敗時に無音を返すと気づかれないまま書き出されてしまうため、呼び出し元でエラー表示する)。
 */
export const generateVoiceover = async (input: GenerateVoiceoverInput): Promise<Buffer> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEYが未設定です");
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_TTS_MODEL || DEFAULT_MODEL;

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_GENERATE_ATTEMPTS; attempt++) {
    try {
      const response = await runWithGeminiRateLimit(() => {
        const generatePromise = ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: input.text }] }],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: input.voiceName } },
            },
          },
        });
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Gemini API timeout")), GEMINI_TIMEOUT_MS);
        });
        return Promise.race([generatePromise, timeoutPromise]);
      });

      const candidate = response.candidates?.[0];
      const part = candidate?.content?.parts?.[0];
      const base64Data = part?.inlineData?.data;
      if (!base64Data) {
        const reasonParts = [
          response.promptFeedback?.blockReason ? `blockReason=${response.promptFeedback.blockReason}` : null,
          candidate?.finishReason ? `finishReason=${candidate.finishReason}` : null,
          typeof part?.text === "string" && part.text ? `text="${part.text.slice(0, 80)}"` : null,
        ].filter((v): v is string => Boolean(v));
        console.error(
          "[generateVoiceover] 音声データが返されなかったレスポンス",
          JSON.stringify(response).slice(0, 2000)
        );
        throw new NoAudioDataError(
          reasonParts.length > 0
            ? `Gemini APIから音声データが返されませんでした(${reasonParts.join(", ")})`
            : "Gemini APIから音声データが返されませんでした"
        );
      }
      const pcmData = Buffer.from(base64Data, "base64");
      const sampleRate = parseSampleRate(part?.inlineData?.mimeType);
      return pcmToWav(pcmData, sampleRate);
    } catch (error) {
      lastError = error;
      const retryable = isRetryableApiError(error) || error instanceof NoAudioDataError;
      if (retryable && attempt < MAX_GENERATE_ATTEMPTS) {
        const delayMs = RETRY_BASE_DELAY_MS * attempt;
        console.warn(
          `[generateVoiceover] 音声生成に失敗したため${delayMs}ms後に再試行します(試行${attempt}/${MAX_GENERATE_ATTEMPTS}): ${
            error instanceof Error ? error.message : error
          }`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw toFriendlyGeminiError(error);
    }
  }
  throw toFriendlyGeminiError(lastError);
};
