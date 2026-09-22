import { createRateLimiterLane } from "../rateLimiterFactory";

// モデルによって無料枠のRPM上限が大きく異なり、実測ではTTSプレビューモデルが
// 1分あたり3回程度と、通常のテキスト系モデルよりも桁違いに厳しいことが分かったため、
// レーン(キュー)を分けて別々の間隔で制御できるようにしている。
export const createGeminiRateLimiter = createRateLimiterLane;

// テロップ生成・文字起こしなど、通常のテキスト系モデル用のレーン。
// 4秒間隔(最大15 RPM相当)だと無料枠の上限に対してまだ攻めすぎだったため、
// 余裕を持たせている(1分あたり約9件)。
const MIN_INTERVAL_MS = Number(process.env.GEMINI_MIN_INTERVAL_MS) || 6_500;
export const runWithGeminiRateLimit = createGeminiRateLimiter(MIN_INTERVAL_MS);

// AIナレーション(TTS)専用のレーン。無料枠の実測上限が1分3回(≒20秒に1回)と
// 極端に厳しいため、他の呼び出しとは別間隔で直列実行する。
const TTS_MIN_INTERVAL_MS = Number(process.env.GEMINI_TTS_MIN_INTERVAL_MS) || 22_000;
export const runWithGeminiTtsRateLimit = createGeminiRateLimiter(TTS_MIN_INTERVAL_MS);
