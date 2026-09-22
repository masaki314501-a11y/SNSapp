import { createRateLimiterLane } from "../rateLimiterFactory";

// Groq無料枠のレート制限(2026-09-23時点、console.groq.com/docs/rate-limitsで確認)。
// テキスト生成(openai/gpt-oss-*等): RPM 30。Whisper音声認識: RPM 20。
// Geminiと同様、レーンを分けて直列実行し、上限ぎりぎりを攻めないよう間隔に余裕を持たせる。

const TEXT_MIN_INTERVAL_MS = Number(process.env.GROQ_TEXT_MIN_INTERVAL_MS) || 2_500;
export const runWithGroqTextRateLimit = createRateLimiterLane(TEXT_MIN_INTERVAL_MS);

const WHISPER_MIN_INTERVAL_MS = Number(process.env.GROQ_WHISPER_MIN_INTERVAL_MS) || 3_500;
export const runWithGroqWhisperRateLimit = createRateLimiterLane(WHISPER_MIN_INTERVAL_MS);
