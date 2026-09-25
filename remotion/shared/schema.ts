import { z } from "zod";
import { zColor } from "@remotion/zod-types";
import { DEFAULT_CLIP_DURATION_IN_SECONDS } from "./constants";

// "remotion" / "@remotion/google-fonts" 等はReactのクライアント実行を前提にしており、
// スキーマ定義(Node.jsのAPIルートからも読み込まれる)に混ぜるとRSC環境で例外になる。
// そのためフォント名はここでは文字列リテラルの列挙として持つ(実際の読み込みは font.ts が担う)。
export const captionFontFamilySchema = z
  .enum([
    "Noto Sans JP",
    "M PLUS Rounded 1c",
    "Zen Maru Gothic",
    "Kosugi Maru",
    "Zen Kaku Gothic New",
    "Dela Gothic One",
    "Yusei Magic",
    "Potta One",
    "Reggae One",
    "RocknRoll One",
    "Mochiy Pop One",
    "Noto Serif JP",
    "Shippori Mincho",
    "Yomogi",
    "Kaisei Decol",
  ])
  .default("Noto Sans JP")
  .describe("テロップに使うフォント");

export type CaptionFontFamily = z.infer<typeof captionFontFamilySchema>;

export const CAPTION_FONT_FAMILY_OPTIONS: { value: CaptionFontFamily; label: string }[] = [
  { value: "Noto Sans JP", label: "標準ゴシック" },
  { value: "M PLUS Rounded 1c", label: "丸ゴシック(やわらか)" },
  { value: "Zen Maru Gothic", label: "まる字(やさしい)" },
  { value: "Kosugi Maru", label: "丸ゴシック(カジュアル)" },
  { value: "Zen Kaku Gothic New", label: "モダンゴシック" },
  { value: "Dela Gothic One", label: "極太インパクト" },
  { value: "Yusei Magic", label: "マーカー太字" },
  { value: "Potta One", label: "ポップな極太" },
  { value: "Reggae One", label: "アウトライン・ポップ" },
  { value: "RocknRoll One", label: "スタイリッシュ太字" },
  { value: "Mochiy Pop One", label: "キュート・ポップ" },
  { value: "Noto Serif JP", label: "上品な明朝体" },
  { value: "Shippori Mincho", label: "繊細な明朝体" },
  { value: "Yomogi", label: "手書き風" },
  { value: "Kaisei Decol", label: "装飾的な明朝(エレガント)" },
];

/**
 * 実際にCSSへ渡す際のフォールバックスタック。選択フォント→Noto Sans JP→システムの
 *日本語フォントの順に倒す(選択フォントのグリフ網羅性が低い場合の保険)。
 */
export const resolveFontFamilyStack = (family: CaptionFontFamily): string =>
  family === "Noto Sans JP"
    ? `"Noto Sans JP", "Hiragino Sans", sans-serif`
    : `"${family}", "Noto Sans JP", "Hiragino Sans", sans-serif`;

export const captionPositionSchema = z
  .enum(["top", "middle", "bottom"])
  .default("bottom")
  .describe("テロップを画面のどこに配置するか");

export type CaptionPosition = z.infer<typeof captionPositionSchema>;

export const CAPTION_POSITION_OPTIONS: { value: CaptionPosition; label: string }[] = [
  { value: "top", label: "上部" },
  { value: "middle", label: "中央" },
  { value: "bottom", label: "下部" },
];

export const captionFontSizeSchema = z
  .enum(["small", "medium", "large"])
  .default("medium")
  .describe("テロップの文字サイズ");

export type CaptionFontSize = z.infer<typeof captionFontSizeSchema>;

export const CAPTION_FONT_SIZE_OPTIONS: { value: CaptionFontSize; label: string }[] = [
  { value: "small", label: "小" },
  { value: "medium", label: "中" },
  { value: "large", label: "大" },
];

/** captionFontSizeSchemaの各値に対する、基準フォントサイズ(px)への倍率。 */
export const CAPTION_FONT_SIZE_SCALE: Record<CaptionFontSize, number> = {
  small: 0.75,
  medium: 1,
  large: 1.3,
};

export const hookSchema = z.object({
  headline: z.string().describe("結論・数字を先出しするメインテロップ(0-3秒)"),
  subline: z.string().optional().describe("補足テロップ(任意)"),
});

export const ctaSchema = z.object({
  text: z.string().default("詳しくはプロフィールへ"),
});

export const captionStyleSchema = z
  .enum(["pill", "outline"])
  .default("pill")
  .describe(
    "テロップの見た目。pill=アクセントカラーの角丸背景、outline=背景無しの白文字+黒縁取り(バズ動画で定番)"
  );

export type CaptionStyle = z.infer<typeof captionStyleSchema>;

export const CAPTION_STYLE_OPTIONS: { value: CaptionStyle; label: string }[] = [
  { value: "pill", label: "カラー背景(ボックス)" },
  { value: "outline", label: "縁取り文字(背景なし)" },
];

export const themeSchema = z.object({
  primaryColor: zColor().default("#FF3366"),
  fontFamily: captionFontFamilySchema,
  captionStyle: captionStyleSchema,
  captionPosition: captionPositionSchema,
  fontSize: captionFontSizeSchema,
  fadeInOut: z.boolean().default(false).describe("動画の先頭・末尾をフェードイン/アウトさせる"),
});

export const captionAnimationSchema = z
  .enum([
    "slide-up",
    "fade",
    "pop",
    "zoom-in",
    "highlight-sweep",
    "shake-in",
    "blur-in",
    "slide-side",
    "flip-in",
  ])
  .default("slide-up")
  .describe("テロップの出現アニメーション");

export type CaptionAnimation = z.infer<typeof captionAnimationSchema>;

export const CAPTION_ANIMATION_OPTIONS: {
  value: CaptionAnimation;
  label: string;
}[] = [
  { value: "slide-up", label: "下からスライドイン" },
  { value: "fade", label: "フェードイン" },
  { value: "pop", label: "ポップイン(拡大)" },
  { value: "zoom-in", label: "ズームイン(縮小)" },
  { value: "highlight-sweep", label: "マーカーで塗る" },
  { value: "shake-in", label: "揺れて強調" },
  { value: "blur-in", label: "ぼかしからくっきり" },
  { value: "slide-side", label: "横からスライドイン" },
  { value: "flip-in", label: "回転してめくれる" },
];

/**
 * カット中の「寄り」。自動編集(Gemini)が強調したい瞬間に使う。候補から選ばせるのではなく
 * 倍率・寄る位置を数値で自由に決めさせ、描画側はその値をそのまま使う。
 * punch=カット頭で一気に寄る(バズ動画定番のジャンプズーム)、slow=カットの間じわじわ寄る。
 */
export const clipZoomSchema = z.object({
  scale: z.number().min(1).max(2).describe("最終的な拡大率(1=等倍)"),
  style: z.enum(["punch", "slow"]).default("punch"),
  focusXPercent: z.number().min(0).max(100).default(50).describe("寄る中心の横位置(左端0〜右端100)"),
  focusYPercent: z.number().min(0).max(100).default(40).describe("寄る中心の縦位置(上端0〜下端100)"),
});

export type ClipZoom = z.infer<typeof clipZoomSchema>;

/**
 * 字幕とは別に画面へ重ねる強調テキスト(「実は3倍!」「ここ重要」など)。文言・位置・色・
 * 大きさ・傾きはすべて自動編集(Gemini)が自由に決めた値をそのまま描く。
 */
export const textOverlaySchema = z.object({
  text: z.string(),
  startOffsetSeconds: z.number().min(0).default(0).describe("カット先頭から何秒後に出すか"),
  durationInSeconds: z.number().min(0.2).max(30).optional().describe("表示秒数。省略時はカットの終わりまで"),
  xPercent: z.number().min(0).max(100).default(50).describe("文字の中心の横位置(左端0〜右端100)"),
  yPercent: z.number().min(0).max(100).default(30).describe("文字の中心の縦位置(上端0〜下端100)"),
  fontSizePx: z.number().min(20).max(220).default(80),
  color: zColor().default("#FFFFFF"),
  strokeColor: zColor().optional().describe("縁取りの色。省略時は縁取り無し"),
  backgroundColor: zColor().optional().describe("文字の後ろの帯の色。省略時は帯無し"),
  rotationDeg: z.number().min(-30).max(30).default(0),
  animation: captionAnimationSchema,
});

export type TextOverlay = z.infer<typeof textOverlaySchema>;

/**
 * 画面に重ねる画像(ロゴ・商品写真・図など)。利用者がアップロードした画像を、位置・大きさ・
 * 表示タイミング・出現演出を指定して重ねる。src は public/ 配下の相対パス("images/xxx.png")かURL。
 */
export const imageOverlaySchema = z.object({
  src: z.string(),
  startOffsetSeconds: z.number().min(0).default(0).describe("カット先頭(動画全体の場合は動画先頭)から何秒後に出すか"),
  durationInSeconds: z.number().min(0.2).max(600).optional().describe("表示秒数。省略時は最後まで"),
  xPercent: z.number().min(0).max(100).default(50).describe("画像の中心の横位置(左端0〜右端100)"),
  yPercent: z.number().min(0).max(100).default(50).describe("画像の中心の縦位置(上端0〜下端100)"),
  widthPercent: z.number().min(5).max(100).default(50).describe("画像の幅(画面幅に対する割合)"),
  rotationDeg: z.number().min(-45).max(45).default(0),
  cornerRadiusPx: z.number().min(0).max(200).default(0),
  animation: captionAnimationSchema,
});

export type ImageOverlay = z.infer<typeof imageOverlaySchema>;

/**
 * 動画/画像+テロップで構成されるカットの共通フィールド。
 * テンプレート固有のフィールド(例: ランキングのtitle)は各テンプレートのschemaでextendする。
 */
export const mediaItemBaseSchema = z.object({
  src: z
    .string()
    .optional()
    .describe(
      "動画ファイルのパス(public/配下、staticFile()で参照)またはURL。未指定ならプレースホルダー背景で代替表示"
    ),
  caption: z.string().describe("このカットに重ねるテロップ"),
  durationInSeconds: z
    .number()
    .min(0.3)
    .max(30)
    .default(DEFAULT_CLIP_DURATION_IN_SECONDS)
    .describe("このカットの尺(秒)"),
  startFromSeconds: z
    .number()
    .min(0)
    .default(0)
    .describe("元動画の何秒目から切り出すか"),
  captionAnimation: captionAnimationSchema,
  volume: z
    .number()
    .min(0)
    .max(2)
    .default(1)
    .describe("このカットの元動画の音量(0=ミュート、1=そのまま、2=倍量)"),
  /** テロップ中で色を変えて大きく見せる単語(数字・キーワード)。自動編集が決める。 */
  emphasisWords: z.array(z.string()).optional(),
  emphasisColor: zColor().optional(),
  zoom: clipZoomSchema.optional(),
  overlays: z.array(textOverlaySchema).max(8).optional(),
  images: z.array(imageOverlaySchema).max(8).optional(),
});

export const sfxClipSchema = z.object({
  src: z.string().describe("効果音ファイルのパス(public/配下)またはURL"),
  label: z.string().default("SE").describe("表示用のラベル(元ファイル名など)"),
  startFromSeconds: z
    .number()
    .min(0)
    .describe("書き出し後の動画上でこの効果音を鳴らし始める秒数"),
  volume: z.number().min(0).max(2).default(1),
});

export type SfxClip = z.infer<typeof sfxClipSchema>;

export const bgmSchema = z.object({
  src: z.string().describe("BGMファイルのパス(public/配下)またはURL"),
  volume: z.number().min(0).max(1).default(0.4),
  fadeInSeconds: z.number().min(0).max(5).default(0).describe("先頭でBGM音量を0から立ち上げる秒数"),
  fadeOutSeconds: z.number().min(0).max(5).default(0).describe("末尾でBGM音量を0まで下げる秒数"),
});

export type Bgm = z.infer<typeof bgmSchema>;
