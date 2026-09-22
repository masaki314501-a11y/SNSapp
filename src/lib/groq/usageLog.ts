/**
 * Geminiのusage Log(src/lib/gemini/usageLog.ts)と同じ目的で、Groq呼び出しがどれだけ
 * 発生しているかをログに出すだけの軽量な計測。Whisper(音声認識)はトークンではなく
 * 処理した音声の秒数、テキスト生成はトークン数、と機能ごとに意味のある指標が異なるため、
 * detail文字列は呼び出し元が組み立てる。
 */
export type GroqCallType = "transcribeCaptions" | "autoEditPlan";

type CallStats = { calls: number };
const stats = new Map<GroqCallType, CallStats>();

const getOrCreateStats = (call: GroqCallType): CallStats => {
  const existing = stats.get(call);
  if (existing) return existing;
  const created: CallStats = { calls: 0 };
  stats.set(call, created);
  return created;
};

export const recordGroqUsage = (call: GroqCallType, model: string, detail: string): void => {
  const s = getOrCreateStats(call);
  s.calls += 1;
  console.log(`[groq_usage] call=${call} model=${model} ${detail} 累計(このプロセス起動から): calls=${s.calls}`);
};
