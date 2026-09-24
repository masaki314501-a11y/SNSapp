import { GoogleGenAI } from "@google/genai";
import { runWithGeminiRateLimit } from "./rateLimiter";
import {
  isCreditExhaustedError,
  isDailyQuotaError,
  isRetryableApiError,
  toFriendlyGeminiError,
} from "./geminiErrors";

/**
 * 旧来の gemini-2.5-flash-preview-tts より抑揚が自然で、ショート動画向きの明るい読み方になる。
 * 「明るくテンポよく」のような読み方の指示を本文の前に付けると、指示文ごと読み上げてしまう
 * (2026-09に文字起こしで確認済み)ため、テロップ本文だけを渡している。
 */
const DEFAULT_MODEL = "gemini-3.8-flash-tts";
const GEMINI_TIMEOUT_MS = 60_000;
const MAX_GENERATE_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 8_000;
const DEFAULT_SAMPLE_RATE = 24_000;

export type GenerateVoiceoverInput = {
  text: string;
  voiceName: string;
};

/** 実際に使うTTSモデル名。生成済み音声のキャッシュキーにも含める(モデルが変われば声も変わるため)。 */
export const resolveVoiceoverModel = (): string => process.env.GEMINI_TTS_MODEL || DEFAULT_MODEL;

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
  const model = resolveVoiceoverModel();

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
      }, "tts");

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
      const audioData = Buffer.from(base64Data, "base64");
      // gemini-3.x系のTTSはヘッダー付きのWAV(audio/wav)を返し、2.5系はヘッダー無しの生PCM
      // (audio/L16)を返す。WAVにさらにヘッダーを足すと壊れたファイルになるため、そのまま使う。
      if (audioData.subarray(0, 4).toString("ascii") === "RIFF") {
        return audioData;
      }
      const sampleRate = parseSampleRate(part?.inlineData?.mimeType);
      return pcmToWav(audioData, sampleRate);
    } catch (error) {
      lastError = error;
      // 1日あたりの上限・チャージ残高切れは待っても回復しないため、再試行はトークンを無駄に
      // 消費するだけでなく利用者を数十秒待たせるだけになる。すぐに諦めて伝える。
      if (isDailyQuotaError(error) || isCreditExhaustedError(error)) {
        throw toFriendlyGeminiError(error);
      }
      // ここまでに確認できた失敗(429/503、音声データ空、原因不明の一過性エラー)は
      // いずれも一時的なもので、時間を置いて再試行すれば成功することが多い。
      // 原因を個別に判定しきれない以上、このAPI呼び出しに限っては種類を問わず
      // リトライ対象にする(GEMINI_API_KEY未設定などはループに入る前に弾いている)。
      if (!(error instanceof NoAudioDataError) && !isRetryableApiError(error)) {
        console.error(
          `[generateVoiceover] 想定外のエラー(試行${attempt}/${MAX_GENERATE_ATTEMPTS})`,
          error
        );
      }
      if (attempt < MAX_GENERATE_ATTEMPTS) {
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
