import Groq from "groq-sdk";

/**
 * 呼び出し側が独自に実装する「一定時間で諦める」タイムアウトの目印。
 * geminiErrors.tsのGeminiTimeoutErrorと同じ役割。
 */
export class GroqTimeoutError extends Error {}

/**
 * リトライして直る可能性が高い失敗(混雑・一時的なレート制限・タイムアウト・接続エラー)。
 *
 * Geminiと違い、Groqのエラーから「1日あたりの上限(待っても回復しない)」と
 * 「1分あたりの上限(すぐ回復する)」を確実に見分ける方法はまだ調査できていない
 * (docs/gemini-multi-provider-offload/README.mdの要検証事項を参照)。GroqのRPD自体が
 * 1,000〜2,000とGeminiよりかなり余裕があり、日次上限に張り付く頻度は低いと見込んでいるため、
 * 現状は429を一律リトライ対象として扱う(見分けられるようになり次第、geminiErrors.tsの
 * isDailyQuotaError相当を追加する)。
 */
export const isRetryableGroqError = (error: unknown): boolean =>
  error instanceof GroqTimeoutError ||
  (error instanceof Groq.APIError && (error.status === undefined || error.status === 429 || error.status >= 500));

/** Groqの生エラーを、専門用語を避けた平易な日本語メッセージに変換する。 */
export const toFriendlyGroqError = (error: unknown): Error => {
  if (error instanceof GroqTimeoutError) {
    return new Error(
      "AIの処理に時間がかかりすぎたため中断しました。少し時間を置いてから、もう一度お試しください"
    );
  }
  if (error instanceof Groq.APIError) {
    if (error.status === 401 || error.status === 403) {
      // Groqは管理者キーのみのため、利用者にキー登録を促す案内は出さない。
      return new Error("AI機能が現在利用できません。しばらく時間をおいてから、もう一度お試しください");
    }
    if (error.status === 429) {
      return new Error("AIへのリクエストが短時間に集中してしまいました。1分ほど待ってから、もう一度お試しください");
    }
    if (error.status === undefined || error.status >= 500) {
      return new Error("AIが混み合っていて、うまく処理できませんでした。少し時間を置いてから、もう一度お試しください");
    }
  }
  return error instanceof Error ? error : new Error("AIの処理に失敗しました。もう一度お試しください");
};
