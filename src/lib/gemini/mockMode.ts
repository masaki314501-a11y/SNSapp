/**
 * 開発中にGemini無料枠を消費せずUIの動作確認を行うためのモード。
 * GEMINI_MOCK=1 のとき、extractStyle/transcribeCaptions/generateVoiceoverは実際に
 * Gemini APIを呼ばず固定のダミー応答を返す(GEMINI_API_KEY未設定でも動作し、
 * レート制限の待機も発生しない)。
 */
export const isGeminiMockEnabled = (): boolean => process.env.GEMINI_MOCK === "1";
