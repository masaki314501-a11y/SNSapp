import type { GoogleGenAI } from "@google/genai";

/** 1回の送信・問い合わせを待つ上限。通信が止まったまま、いつまでも待ち続けないようにする(前は50分待ったことがあった)。 */
const UPLOAD_TIMEOUT_MS = 300_000;
const FILE_GET_TIMEOUT_MS = 30_000;
const UPLOAD_ATTEMPTS = 3;

const withTimeout = <T>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

/**
 * Gemini File APIへファイルを送る。時間切れ(5分)や通信の失敗の時は、少し待って送り直す(3回まで)。
 */
export const uploadGeminiFile = async (
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI["files"]["upload"]>[0]
): Promise<Awaited<ReturnType<GoogleGenAI["files"]["upload"]>>> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    try {
      return await withTimeout(ai.files.upload(params), UPLOAD_TIMEOUT_MS, "動画をAIへ送るのに時間がかかりすぎました。通信の状態を確かめて、もう一度試してください");
    } catch (error) {
      lastError = error;
      console.warn(`[geminiFiles] AIへの送信に失敗しました(${attempt}回目)`, error);
      if (attempt < UPLOAD_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
    }
  }
  throw lastError;
};

/**
 * 大きい/長い動画ほどGemini側のACTIVE化(解析可能になるまで)に時間がかかる。
 * 編集例(few-shot、数十〜100MB超)や長めのユーザー動画で60秒に収まらないことがあったため
 * 余裕を持たせる(autoEditPlan.ts/transcribeCaptions.tsのGEMINI_TIMEOUT_MSと同程度)。
 */
const FILE_ACTIVE_TIMEOUT_MS = 180_000;
const FILE_ACTIVE_POLL_INTERVAL_MS = 1_500;

/**
 * Gemini File APIにアップロードした動画がACTIVE(解析可能な状態)になるまで待つ。
 * 文字起こし・参考動画からのスタイル抽出など、動画をFile API経由で渡す処理で共通して使う。
 */
export const waitForGeminiFileActive = async (ai: GoogleGenAI, fileName: string): Promise<void> => {
  const deadline = Date.now() + FILE_ACTIVE_TIMEOUT_MS;
  for (;;) {
    // 1回の問い合わせが止まっても、時間切れまでに次の問い合わせができるようにする
    const file = await withTimeout(ai.files.get({ name: fileName }), FILE_GET_TIMEOUT_MS, "動画の処理の確認に時間がかかりすぎました").catch(
      (error: unknown) => {
        if (Date.now() > deadline) throw error;
        return null;
      }
    );
    if (!file) {
      await new Promise((resolve) => setTimeout(resolve, FILE_ACTIVE_POLL_INTERVAL_MS));
      continue;
    }
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
