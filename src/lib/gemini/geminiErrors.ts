import { ApiError } from "@google/genai";

/** 過負荷(503)・レート制限(429)は一時的なことが多いため、呼び出し側で再試行の対象にする。 */
export const RETRYABLE_STATUS_CODES = new Set([429, 503]);

/**
 * 各Gemini呼び出し箇所が独自に実装している「一定時間で諦める」タイムアウトの
 * 目印。素のErrorだと`isRetryableApiError`のApiError判定に引っかからず、
 * 一度時間切れになっただけでリトライされずに終わってしまうため、専用の型で
 * リトライ対象に含められるようにする。
 */
export class GeminiTimeoutError extends Error {}

/**
 * 429には「1分あたりの上限(すぐ回復する)」と「1日あたりの上限(翌日まで回復しない)」の
 * 2種類があり、利用者が取るべき行動が全く違う。Geminiは前者をRPM/RPS、後者をPerDayを含む
 * quotaIdとして返すため、メッセージ本文から日次上限かどうかを見分ける。
 */
export const isDailyQuotaError = (error: unknown): boolean =>
  error instanceof ApiError &&
  error.status === 429 &&
  /PerDay|per day|daily/i.test(typeof error.message === "string" ? error.message : "");

/** Geminiが返すRetryInfo(例: "retryDelay":"43s")から、再試行可能になるまでの秒数を取り出す。 */
export const parseRetryDelaySeconds = (error: unknown): number | null => {
  if (!(error instanceof ApiError) || typeof error.message !== "string") return null;
  const match = error.message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return match ? Math.ceil(Number(match[1])) : null;
};

/**
 * 日次上限は待っても翌日まで回復しないため、リトライしても無駄にトークン/待ち時間を
 * 消費するだけ。呼び出し側の再試行ループはこれをfalseとして扱い、即座に諦めさせる。
 * タイムアウト(GeminiTimeoutError)は一過性の遅さのことが多いためリトライ対象に含める。
 */
export const isRetryableApiError = (error: unknown): boolean =>
  error instanceof GeminiTimeoutError ||
  (error instanceof ApiError && RETRYABLE_STATUS_CODES.has(error.status) && !isDailyQuotaError(error));

/**
 * 共有・自分のどちらのAPIキーも無い場合に画面へ出すメッセージ。「GEMINI_API_KEY」
 * のような環境変数名を出さず、利用者が次に何をすればよいか分かる表現にする。
 * サーバーログ側には別途、環境変数が未設定である旨を出しておくこと。
 */
export const MISSING_API_KEY_MESSAGE =
  "AIがまだ使える状態になっていません。右下の設定から自分のAPIキーを登録すると使えるようになります";

/**
 * Gemini SDKが返す生のエラー(JSON文字列そのまま、またはステータスコードのような
 * 専門用語)を、非エンジニアの利用者が読んでも状況と次にすることが分かるような
 * 平易な日本語メッセージに変換する。「API」「クォータ」「レート制限」のような
 * 用語は避け、「AI」「回数」「時間を置く」といった言葉で言い換える。
 */
export const toFriendlyGeminiError = (error: unknown): Error => {
  if (error instanceof GeminiTimeoutError) {
    return new Error(
      "AIの処理に時間がかかりすぎたため中断しました。少し時間を置いてから、もう一度お試しください"
    );
  }
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return new Error(
        "設定した自分のAPIキーがうまく使えないようです。右下の設定からキーを確認するか、削除すれば共有の枠に戻れます"
      );
    }
    if (error.status === 503) {
      return new Error(
        "AIが混み合っていて、うまく処理できませんでした。少し時間を置いてから、もう一度お試しください"
      );
    }
    if (error.status === 429) {
      if (isDailyQuotaError(error)) {
        return new Error(
          "本日使えるAIの回数が上限に達しました。明日になればまた使えます。今すぐ試したい場合は、右下の設定から自分のAPIキーを登録すると、自分専用の回数で使えます"
        );
      }
      const retryAfterSeconds = parseRetryDelaySeconds(error);
      return new Error(
        retryAfterSeconds !== null
          ? `AIへのリクエストが短時間に集中してしまいました。約${retryAfterSeconds}秒後に、もう一度お試しください`
          : "AIへのリクエストが短時間に集中してしまいました。1分ほど待ってから、もう一度お試しください"
      );
    }
  }
  return error instanceof Error ? error : new Error("AIの処理に失敗しました。もう一度お試しください");
};
