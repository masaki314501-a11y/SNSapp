import type { GoogleGenAI } from "@google/genai";

const FILE_ACTIVE_TIMEOUT_MS = 60_000;
const FILE_ACTIVE_POLL_INTERVAL_MS = 1_500;

/**
 * Gemini File APIにアップロードした動画がACTIVE(解析可能な状態)になるまで待つ。
 * 文字起こし・参考動画からのスタイル抽出など、動画をFile API経由で渡す処理で共通して使う。
 */
export const waitForGeminiFileActive = async (ai: GoogleGenAI, fileName: string): Promise<void> => {
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
