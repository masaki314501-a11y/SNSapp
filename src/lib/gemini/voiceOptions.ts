/**
 * Gemini TTSの読み上げ声(プリセットボイス名)。クライアント(声の選択UI)とサーバー
 * (APIリクエストのバリデーション)の両方から参照するため、Node専用の依存を持たない。
 */

export type VoiceOption = { id: string; label: string };

export const VOICE_OPTIONS: VoiceOption[] = [
  { id: "Kore", label: "Kore" },
  { id: "Puck", label: "Puck" },
  { id: "Charon", label: "Charon" },
  { id: "Aoede", label: "Aoede" },
  { id: "Fenrir", label: "Fenrir" },
  { id: "Leda", label: "Leda" },
];

export const DEFAULT_VOICE_NAME = "Kore";

export const isKnownVoiceName = (voiceName: string): boolean =>
  VOICE_OPTIONS.some((option) => option.id === voiceName);
