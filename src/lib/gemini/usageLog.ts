import type { GenerateContentResponseUsageMetadata } from "@google/genai";
import { parseDailyQuotaLimit } from "./geminiErrors";

/**
 * どの機能がGeminiの無料枠を最も消費しているか(429/日次上限のどちらに当たっているか)を
 * 判断するための計測。ログに出すだけで、集計自体は行わない(Render Freeの制約でDBを
 * 増やしたくないため、ログ上で目視・grepして把握する運用を前提にする)。
 */
export type GeminiCallType =
  | "extractStyle"
  | "transcribeCaptions"
  | "generateVoiceover"
  | "autoEditPlan"
  | "editExampleDigest";

type CallStats = {
  calls: number;
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
  dailyQuotaExceededCount: number;
  /** RPDが基準にする太平洋時間の日付("YYYY-MM-DD")。日付が変わったらcallsTodayをリセットする。 */
  dayKey: string;
  /** 太平洋時間の当日中にこの呼び出し種別が実行された回数(このプロセス内のみで把握できる分)。 */
  callsToday: number;
  /** 直近に429の"quotaValue"から読み取れた1日あたりの上限回数。呼び出し元・環境変数を跨いで
   *  モデルを変えない限り、一度わかれば同じ値のはずなので保持し続ける。 */
  dailyLimit?: number;
};

const stats = new Map<GeminiCallType, CallStats>();

/** GeminiのRPD(1日あたりのリクエスト数)は太平洋時間の深夜にリセットされる(公式ドキュメント確認済み)。 */
const getPacificDayKey = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());

const getOrCreateStats = (call: GeminiCallType): CallStats => {
  const existing = stats.get(call);
  if (existing) return existing;
  const created: CallStats = {
    calls: 0,
    promptTokens: 0,
    candidatesTokens: 0,
    thoughtsTokens: 0,
    totalTokens: 0,
    dailyQuotaExceededCount: 0,
    dayKey: getPacificDayKey(),
    callsToday: 0,
  };
  stats.set(call, created);
  return created;
};

/** 太平洋時間で日付が変わっていたら、当日カウントだけをリセットする(上限回数自体は日付を跨いでも変わらない)。 */
const resetIfNewDay = (s: CallStats): void => {
  const today = getPacificDayKey();
  if (s.dayKey !== today) {
    s.dayKey = today;
    s.callsToday = 0;
  }
};

/**
 * 「本日の残り目安」の文字列を作る。Gemini APIは残り枠数を一切返さないため、直近で429から
 * 読み取れた上限(dailyLimit)から、このプロセスが数えた当日の呼び出し回数を引いた概算でしか
 * ない。プロセス再起動・他の共有キー利用者の呼び出し・複数プロセスでの分散は反映できないため、
 * 実際より残りが多く見える場合がある(逆に、上限に達した直後はcallsTodayをdailyLimitに
 * 合わせるため、その時点以降は正確になる)。
 */
const formatRemainingEstimate = (s: CallStats): string =>
  s.dailyLimit !== undefined
    ? ` 本日の残り目安=${Math.max(0, s.dailyLimit - s.callsToday)}/${s.dailyLimit}回`
    : "";

/**
 * Gemini呼び出しが成功するたびに呼ぶ。usageMetadataはGemini APIのレスポンスに
 * 含まれる実際のトークン数(モック応答時はundefined)。thoughtsTokenCountは
 * 画面に出さない内部の「思考」に使われたトークン数で、responseにテキストとして
 * 現れないため見落としやすいが、無料枠は消費する。
 * プロセス起動から現在までの累計もあわせて出力し、ログを都度合算しなくても
 * 直近の行だけでどの機能が食っているか分かるようにする。
 */
export const recordGeminiUsage = (
  call: GeminiCallType,
  model: string,
  usage?: Pick<
    GenerateContentResponseUsageMetadata,
    "promptTokenCount" | "candidatesTokenCount" | "thoughtsTokenCount" | "totalTokenCount" | "promptTokensDetails"
  >
): void => {
  const s = getOrCreateStats(call);
  resetIfNewDay(s);
  s.calls += 1;
  s.callsToday += 1;
  s.promptTokens += usage?.promptTokenCount ?? 0;
  s.candidatesTokens += usage?.candidatesTokenCount ?? 0;
  s.thoughtsTokens += usage?.thoughtsTokenCount ?? 0;
  s.totalTokens += usage?.totalTokenCount ?? 0;

  // 入力トークンがモダリティ(TEXT/VIDEO/IMAGE等)別にどれだけ使われたかを見えるようにする。
  // few-shot例の動画のように、呼び出し元のコード上は分かりにくい消費源を特定するのに使う。
  const details = usage?.promptTokensDetails
    ?.map((d) => `${d.modality ?? "?"}=${d.tokenCount ?? "?"}`)
    .join(",");

  console.log(
    `[gemini_usage] call=${call} model=${model} ` +
      `tokens(prompt/output/thoughts/total)=${usage?.promptTokenCount ?? "?"}/${
        usage?.candidatesTokenCount ?? "?"
      }/${usage?.thoughtsTokenCount ?? "?"}/${usage?.totalTokenCount ?? "?"} ` +
      (details ? `prompt内訳=[${details}] ` : "") +
      `累計(このプロセス起動から): calls=${s.calls} totalTokens=${s.totalTokens}` +
      formatRemainingEstimate(s)
  );
};

/** 日次の無料枠上限(RPD/TPD)に到達したことが分かった際に呼ぶ。errorを渡せば上限回数(quotaValue)を読み取って以後の残り目安に使う。 */
export const recordGeminiDailyQuotaExceeded = (
  call: GeminiCallType,
  model: string,
  error?: unknown
): void => {
  const s = getOrCreateStats(call);
  resetIfNewDay(s);
  s.dailyQuotaExceededCount += 1;

  const limit = parseDailyQuotaLimit(error);
  if (limit !== null) {
    s.dailyLimit = limit;
  }
  // 上限到達が確定した時点では、実際の呼び出し回数(他利用者・別プロセス分を含む)が
  // 分からなくても「今日はもう0」であることだけは確実なので、カウンタをそこに揃える。
  if (s.dailyLimit !== undefined) {
    s.callsToday = s.dailyLimit;
  }

  console.warn(
    `[gemini_usage] call=${call} model=${model} が本日の無料枠上限に到達 ` +
      `累計(このプロセス起動から): dailyQuotaExceededCount=${s.dailyQuotaExceededCount}` +
      formatRemainingEstimate(s)
  );
};
