/**
 * Gemini TTSの読み上げ声(プリセットボイス名)。クライアント(声の選択UI)とサーバー
 * (APIリクエストのバリデーション)の両方から参照するため、Node専用の依存を持たない。
 */

export type VoiceOption = { id: string; label: string };

/**
 * 名前だけでは男性か女性か分からず選べなかったため、声の感じを添えて表示する
 * (特徴はGoogleの声の説明による。Kore=Firm、Puck=Upbeat、Charon=Informative、Aoede=Breezy、
 * Fenrir=Excitable、Leda=Youthful)。
 */
export const VOICE_OPTIONS: VoiceOption[] = [
  { id: "Kore", label: "女性・落ち着いた(Kore)" },
  { id: "Aoede", label: "女性・さわやか(Aoede)" },
  { id: "Leda", label: "女性・若々しい(Leda)" },
  { id: "Puck", label: "男性・明るい(Puck)" },
  { id: "Charon", label: "男性・説明向き(Charon)" },
  { id: "Fenrir", label: "男性・元気(Fenrir)" },
];

export const voiceLabel = (voiceName: string | undefined): string =>
  VOICE_OPTIONS.find((option) => option.id === voiceName)?.label ?? "不明(以前に作った声)";

export const DEFAULT_VOICE_NAME = "Kore";

export const isKnownVoiceName = (voiceName: string): boolean =>
  VOICE_OPTIONS.some((option) => option.id === voiceName);
