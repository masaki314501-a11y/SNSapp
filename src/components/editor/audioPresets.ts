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
  // 以下はショート動画でよく使う、発表・衝撃・お金・上がる/下がる などの音(Kenneyの別の音源集。CREDITS.md参照)
  { id: "reveal", label: "ジャーン(発表)", src: "audio/presets/sfx/reveal.mp3" },
  { id: "hit", label: "ジャン(短い強調)", src: "audio/presets/sfx/hit.mp3" },
  { id: "funny", label: "とぼけた音(ピチカート)", src: "audio/presets/sfx/funny.mp3" },
  { id: "cheerful", label: "明るい音(スチールドラム)", src: "audio/presets/sfx/cheerful.mp3" },
  { id: "relaxed", label: "お気楽(サックス)", src: "audio/presets/sfx/relaxed.mp3" },
  { id: "game", label: "ゲーム風(ピコピコ)", src: "audio/presets/sfx/game.mp3" },
  { id: "impact", label: "ドン(重い衝撃)", src: "audio/presets/sfx/impact.mp3" },
  { id: "bell", label: "ゴーン(鐘)", src: "audio/presets/sfx/bell.mp3" },
  { id: "thud", label: "ボフッ(やわらかい衝撃)", src: "audio/presets/sfx/thud.mp3" },
  { id: "knock", label: "コンッ(木をたたく)", src: "audio/presets/sfx/knock.mp3" },
  { id: "glass", label: "カシャン(ガラス)", src: "audio/presets/sfx/glass.mp3" },
  { id: "coins", label: "チャリン(お金)", src: "audio/presets/sfx/coins.mp3" },
  { id: "page", label: "ペラッ(ページをめくる)", src: "audio/presets/sfx/page.mp3" },
  { id: "slash", label: "シュッ(切る)", src: "audio/presets/sfx/slash.mp3" },
  { id: "door", label: "ガチャ(ドアを開ける)", src: "audio/presets/sfx/door.mp3" },
  { id: "power-up", label: "パワーアップ", src: "audio/presets/sfx/power-up.mp3" },
  { id: "rise", label: "キュイーン(上がる)", src: "audio/presets/sfx/rise.mp3" },
  { id: "fall", label: "ヒューン(下がる)", src: "audio/presets/sfx/fall.mp3" },
  { id: "idea", label: "ピロリン(ひらめき)", src: "audio/presets/sfx/idea.mp3" },
  { id: "level-up", label: "ピロピロ(良くなる)", src: "audio/presets/sfx/level-up.mp3" },
  { id: "level-down", label: "ピロピロ(悪くなる・がっかり)", src: "audio/presets/sfx/level-down.mp3" },
  { id: "dice", label: "コロコロ(サイコロ)", src: "audio/presets/sfx/dice.mp3" },
  { id: "card", label: "シュッ(カードを出す)", src: "audio/presets/sfx/card.mp3" },
];

export const BGM_PRESETS: AudioPreset[] = [];
