import { GoogleGenAI, Type } from "@google/genai";
import { runWithGeminiRateLimit } from "./rateLimiter";
import {
  GeminiTimeoutError,
  MISSING_API_KEY_MESSAGE,
  isDailyQuotaError,
  isRetryableApiError,
  toFriendlyGeminiError,
} from "./geminiErrors";
import { waitForGeminiFileActive } from "./geminiFiles";
import { recordGeminiDailyQuotaExceeded, recordGeminiUsage } from "./usageLog";
import { isGeminiMockEnabled } from "./mockMode";
import { editExampleDigestSchema, type EditExampleDigest } from "./editExampleDigestTypes";

const DEFAULT_MODEL = "gemini-3.6-flash";
const GEMINI_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 8_000;

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    segments: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          caption: { type: Type.STRING },
          durationSeconds: { type: Type.NUMBER },
          technique: { type: Type.STRING },
        },
        required: ["caption", "durationSeconds", "technique"],
      },
    },
    summary: { type: Type.STRING },
  },
  required: ["segments", "summary"],
} as const;

const PROMPT = `
添付した動画は、SNSで実際に拡散された「編集の実例」です。これを今後、自動編集AIが
参考にするfew-shot例として使います。動画そのものを毎回見せる代わりに、この解析結果
(テキスト)だけで編集の勘所が伝わるよう、区間ごとの内容と編集の工夫を言語化してください。

## 出力ルール
- segmentsは動画の先頭から末尾までを、意味のまとまり(発話の区切りなど)で連続して
  カバーする配列
- caption: その区間で実際に話されている/表示されているテロップの内容
- durationSeconds: その区間の長さ(秒)
- technique: その区間で使われている編集の工夫を1〜2文で(テロップの出方・強調の仕方、
  ナレーションの有無、効果音の使い方、間の取り方など。無ければ「特筆すべき工夫なし」でよい)
- summary: 動画全体を通した編集方針(フックの作り方・テンポ・山場の作り方など)を2〜3文で

JSON以外の文字列は出力しないでください。
`.trim();

/**
 * 編集例(実例動画)を一度だけ解析し、後から動画自体をGeminiに送らなくても編集の勘所が
 * 伝わる軽量な要約(EditExampleDigest)を作る。登録時に1回だけ呼び、結果を
 * editExamplesStore.tsに保存して使い回す想定(繰り返しの自動編集のたびに動画を
 * 送っていた従来方式は、実測でトークン消費の9割以上を占めていた)。
 */
export const generateEditExampleDigest = async (
  absoluteVideoPath: string,
  mimeType: string,
  apiKeyOverride?: string
): Promise<EditExampleDigest> => {
  if (isGeminiMockEnabled()) {
    return {
      segments: [{ caption: "(モック)", durationSeconds: 3, technique: "(モック)" }],
      summary: "(モック要約)",
    };
  }

  const apiKey = apiKeyOverride || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[editExampleDigest] GEMINI_API_KEYが未設定です(共有キーも自分のキーも無し)");
    throw new Error(MISSING_API_KEY_MESSAGE);
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  const uploaded = await ai.files.upload({ file: absoluteVideoPath, config: { mimeType } });
  if (!uploaded.name || !uploaded.uri) {
    throw new Error("編集例動画のアップロードに失敗しました");
  }

  try {
    await waitForGeminiFileActive(ai, uploaded.name);

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await runWithGeminiRateLimit(() => {
          const generatePromise = ai.models.generateContent({
            model,
            contents: [
              {
                role: "user",
                parts: [{ fileData: { fileUri: uploaded.uri!, mimeType } }, { text: PROMPT }],
              },
            ],
            config: { responseMimeType: "application/json", responseSchema },
          });
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new GeminiTimeoutError("Gemini API timeout")), GEMINI_TIMEOUT_MS);
          });
          return Promise.race([generatePromise, timeoutPromise]);
        });

        recordGeminiUsage("editExampleDigest", model, response.usageMetadata);

        const text = response.text;
        if (!text) {
          throw new Error("Gemini APIから空の応答が返されました");
        }

        const parsed = editExampleDigestSchema.safeParse(JSON.parse(text));
        if (!parsed.success) {
          throw new Error(`Gemini応答のスキーマ検証に失敗: ${parsed.error.message}`);
        }

        return parsed.data;
      } catch (error) {
        lastError = error;
        if (isDailyQuotaError(error)) {
          recordGeminiDailyQuotaExceeded("editExampleDigest");
        }
        if (isRetryableApiError(error) && attempt < MAX_ATTEMPTS) {
          const delayMs = RETRY_BASE_DELAY_MS * attempt;
          console.warn(
            `[editExampleDigest] Geminiが混雑しているため${delayMs}ms後に再試行します(試行${attempt}/${MAX_ATTEMPTS}): ${
              error instanceof Error ? error.message : error
            }`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        console.error(
          `[editExampleDigest] リトライ上限(${MAX_ATTEMPTS}回)に到達、または再試行不可のエラーで中断します(試行${attempt}/${MAX_ATTEMPTS})`,
          error
        );
        throw toFriendlyGeminiError(error);
      }
    }
    throw toFriendlyGeminiError(lastError);
  } finally {
    await ai.files.delete({ name: uploaded.name }).catch(() => {});
  }
};
