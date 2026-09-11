/**
 * アプリに同梱している著作権フリー(CC0)の効果音/BGMプリセット。
 * 出典・ライセンスは public/audio/presets/CREDITS.md を参照。
 * BGM_PRESETS は現時点では未収録(適切な長さ・雰囲気のCC0楽曲を選定中のため空)。
 */

export type AudioPreset = {
  id: string;
  label: string;
  src: string;
};

export const SFX_PRESETS: AudioPreset[] = [
  { id: "tap", label: "タップ", src: "audio/presets/sfx/tap.mp3" },
  { id: "decide", label: "決定", src: "audio/presets/sfx/decide.mp3" },
  { id: "success", label: "成功", src: "audio/presets/sfx/success.mp3" },
  { id: "error", label: "残念", src: "audio/presets/sfx/error.mp3" },
  { id: "notify", label: "通知", src: "audio/presets/sfx/notify.mp3" },
  { id: "swipe", label: "スワイプ", src: "audio/presets/sfx/swipe.mp3" },
  { id: "pop", label: "ポップ", src: "audio/presets/sfx/pop.mp3" },
  { id: "question", label: "はてな", src: "audio/presets/sfx/question.mp3" },
  { id: "toggle", label: "切り替え", src: "audio/presets/sfx/toggle.mp3" },
  { id: "glitch", label: "グリッチ", src: "audio/presets/sfx/glitch.mp3" },
];

export const BGM_PRESETS: AudioPreset[] = [];
