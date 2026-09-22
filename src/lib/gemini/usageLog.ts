import type { GenerateContentResponseUsageMetadata } from "@google/genai";

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
};

const stats = new Map<GeminiCallType, CallStats>();

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
  };
  stats.set(call, created);
  return created;
};

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
  s.calls += 1;
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
      `累計(このプロセス起動から): calls=${s.calls} totalTokens=${s.totalTokens}`
  );
};

/** 日次の無料枠上限(RPD/TPD)に到達したことが分かった際に呼ぶ。 */
export const recordGeminiDailyQuotaExceeded = (call: GeminiCallType): void => {
  const s = getOrCreateStats(call);
  s.dailyQuotaExceededCount += 1;

  console.warn(
    `[gemini_usage] call=${call} が本日の無料枠上限に到達 ` +
      `累計(このプロセス起動から): dailyQuotaExceededCount=${s.dailyQuotaExceededCount}`
  );
};
