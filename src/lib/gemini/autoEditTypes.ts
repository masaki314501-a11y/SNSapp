import { Type } from "@google/genai";
import { z } from "zod";
import {
  CAPTION_ANIMATION_OPTIONS,
  CAPTION_FONT_FAMILY_OPTIONS,
  CAPTION_FONT_SIZE_OPTIONS,
  CAPTION_POSITION_OPTIONS,
  CAPTION_STYLE_OPTIONS,
} from "@video/shared/schema";
import { SFX_PRESETS } from "@/components/editor/audioPresets";

/**
 * autoEditPlan.tsとautoEditJobs.tsの両方から使う型・スキーマ。extractStyle.ts/styleTypes.ts
 * と同じ理由(循環import回避)でこのファイルに切り出している。
 *
 * ここはGeminiの生の応答を受け取るためのスキーマなので、数値の範囲などはあえて緩くしている。
 * 1か所の値が範囲外なだけで編集案全体を捨てるのはもったいないため、範囲の丸め込みや不正な
 * 要素の除外はautoEditPlan.ts側で要素ごとに行う。
 */
const FONT_FAMILY_VALUES = CAPTION_FONT_FAMILY_OPTIONS.map((option) => option.value);
const CAPTION_POSITION_VALUES = CAPTION_POSITION_OPTIONS.map((option) => option.value);
const CAPTION_STYLE_VALUES = CAPTION_STYLE_OPTIONS.map((option) => option.value);
const CAPTION_FONT_SIZE_VALUES = CAPTION_FONT_SIZE_OPTIONS.map((option) => option.value);
const CAPTION_ANIMATION_VALUES = CAPTION_ANIMATION_OPTIONS.map((option) => option.value);
const SFX_PRESET_IDS = SFX_PRESETS.map((preset) => preset.id);

const rawOverlaySchema = z.object({
  text: z.string(),
  startOffsetSeconds: z.number().nullable().optional(),
  durationInSeconds: z.number().nullable().optional(),
  xPercent: z.number().nullable().optional(),
  yPercent: z.number().nullable().optional(),
  fontSizePx: z.number().nullable().optional(),
  color: z.string().nullable().optional(),
  strokeColor: z.string().nullable().optional(),
  backgroundColor: z.string().nullable().optional(),
  rotationDeg: z.number().nullable().optional(),
  animation: z.enum(CAPTION_ANIMATION_VALUES as [string, ...string[]]).nullable().optional(),
  fontFamily: z.enum(FONT_FAMILY_VALUES as [string, ...string[]]).nullable().optional(),
  glowColor: z.string().nullable().optional(),
  italic: z.boolean().nullable().optional(),
  strokeWidthPx: z.number().nullable().optional(),
  /** ランキングの何位の枠に入れる文字か。位置はサーバー側で枠に合わせる(autoEditPlan.tsのsnapToRankSlots)。 */
  slotRank: z.number().int().nullable().optional(),
  /**
   * クリップの強調テキストで、出てから動画の最後まで残す物(ランキングの空枠に入る項目名など)。
   * 動画全体の先頭からの秒数をGeminiに計算させるとずれるので、出すクリップに置かせたまま印だけ付けさせ、
   * 全体の文字(globalOverlays)への移し替えはサーバー側で行う(autoEditPlan.ts)。
   */
  keepUntilEnd: z.boolean().nullable().optional(),
});

/**
 * クリップに重ねる画像。自動編集では、本人が渡した「使える画像」をimageNumber(1始まり)で指定させる。
 * 正解動画の書き起こしでは元の画像ファイルが無いので、imageNumberはnullにしてdescriptionに何の画像かを書かせる
 * (自動編集の手本として「どんな画像を、いつ・どこに・どの大きさで出すか」を見せるため)。
 * 表示の長さがクリップを超える物・最後まで残す物は、文字と同じく全体の画像へサーバー側で移す(autoEditPlan.ts)。
 */
const rawImageSchema = z.object({
  imageNumber: z.number().int().nullable().optional(),
  description: z.string(),
  /** AIに作らせる画像の短い名前。同じ画像を2回出す(大きく出す→枠に入れる)ときに同じ1枚を使うための目印。 */
  name: z.string().nullable().optional(),
  startOffsetSeconds: z.number().nullable().optional(),
  durationInSeconds: z.number().nullable().optional(),
  xPercent: z.number().nullable().optional(),
  yPercent: z.number().nullable().optional(),
  widthPercent: z.number().nullable().optional(),
  heightPercent: z.number().nullable().optional(),
  cornerRadiusPx: z.number().nullable().optional(),
  animation: z.enum(CAPTION_ANIMATION_VALUES as [string, ...string[]]).nullable().optional(),
  keepUntilEnd: z.boolean().nullable().optional(),
  /** ランキングの何位の枠に入れる画像か。位置・大きさはサーバー側で枠に合わせる。 */
  slotRank: z.number().int().nullable().optional(),
});

/** 動画全体に重ねる図形(ランキングの空の枠など)。秒数は動画全体の先頭から。 */
const rawShapeSchema = z.object({
  kind: z.enum(["rect", "circle"]).nullable().optional(),
  /** クリップに置いた図形で、出てから動画の最後まで残す物。 */
  keepUntilEnd: z.boolean().nullable().optional(),
  startOffsetSeconds: z.number().nullable().optional(),
  durationInSeconds: z.number().nullable().optional(),
  xPercent: z.number().nullable().optional(),
  yPercent: z.number().nullable().optional(),
  widthPercent: z.number().nullable().optional(),
  heightPercent: z.number().nullable().optional(),
  borderColor: z.string().nullable().optional(),
  borderWidthPx: z.number().nullable().optional(),
  fillColor: z.string().nullable().optional(),
  fillOpacity: z.number().nullable().optional(),
  cornerRadiusPx: z.number().nullable().optional(),
});

const rawClipSchema = z.object({
  /** 元動画上の開始・終了秒。Geminiが本人の動画を見て、使う区間を自由に切り出す。 */
  sourceStartSeconds: z.number(),
  sourceEndSeconds: z.number(),
  /** この区間で話している内容。字幕は編集画面で付けるかどうか決めるため、ここでは下書きとして保持する。 */
  speech: z.string().nullable().optional(),
  captionAnimation: z.enum(CAPTION_ANIMATION_VALUES as [string, ...string[]]).nullable().optional(),
  emphasisWords: z.array(z.string()).nullable().optional(),
  emphasisColor: z.string().nullable().optional(),
  captionAccentColor: z.string().nullable().optional(),
  captionFontFamily: z.enum(FONT_FAMILY_VALUES as [string, ...string[]]).nullable().optional(),
  captionGlowColor: z.string().nullable().optional(),
  zoom: z
    .object({
      scale: z.number(),
      style: z.enum(["punch", "slow"]).nullable().optional(),
      focusXPercent: z.number().nullable().optional(),
      focusYPercent: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
  overlays: z.array(rawOverlaySchema).nullable().optional(),
  images: z.array(rawImageSchema).nullable().optional(),
  /** そのクリップで出す図形(〇印など)。出し続ける長さはクリップより長くてよく、全体の図形へサーバー側で移す。 */
  shapes: z.array(rawShapeSchema).nullable().optional(),
  sfx: z
    .array(
      z.object({
        presetId: z.enum(SFX_PRESET_IDS as [string, ...string[]]),
        offsetSeconds: z.number().nullable().optional(),
      })
    )
    .nullable()
    .optional(),
  /** AIナレーションで読ませる文(元の声とは別に足す)。不要ならnull。 */
  narration: z.string().nullable().optional(),
});

export const rawAutoEditPlanSchema = z.object({
  /** 参考スクショ/動画から読み取った「編集の感じ」。UIに出して、何を手本にしたか確認できるようにする。 */
  referenceNotes: z.string().nullable().optional(),
  /** 「なぜこう編集したか」を短く。UIに表示してユーザーが受け入れ判断をしやすくするため。 */
  summary: z.string(),
  theme: z
    .object({
      primaryColor: z.string().nullable().optional(),
      fontFamily: z.enum(FONT_FAMILY_VALUES as [string, ...string[]]).nullable().optional(),
      captionPosition: z.enum(CAPTION_POSITION_VALUES as [string, ...string[]]).nullable().optional(),
      captionStyle: z.enum(CAPTION_STYLE_VALUES as [string, ...string[]]).nullable().optional(),
      captionFontSize: z.enum(CAPTION_FONT_SIZE_VALUES as [string, ...string[]]).nullable().optional(),
    })
    .nullable()
    .optional(),
  hook: z.object({ headline: z.string(), subline: z.string().nullable().optional() }).nullable().optional(),
  cta: z.object({ text: z.string() }).nullable().optional(),
  /** 動画全体の画角(人物を片側に寄せて、空いた側に枠などを置く)。 */
  framing: z
    .object({
      scale: z.number(),
      focusXPercent: z.number().nullable().optional(),
      focusYPercent: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
  /** 動画全体に重ねる図形(ランキングの空の枠など)。 */
  globalShapes: z.array(rawShapeSchema).nullable().optional(),
  /** 動画全体に重ね続ける文字(参考投稿の上部タイトル等)。 */
  globalOverlays: z.array(rawOverlaySchema).nullable().optional(),
  /** 話している言葉を字幕(テロップ)として出すか。参考・編集例が字幕を出していればtrue。 */
  showCaptions: z.boolean().nullable().optional(),
  /** AIに作らせる画像の画風。医療・美容・健康の話はイラスト必須(generateImage.ts参照)。 */
  generatedImageStyle: z.enum(["illustration", "photo"]).nullable().optional(),
  clips: z.array(rawClipSchema),
});

export type RawAutoEditPlan = z.infer<typeof rawAutoEditPlanSchema>;
export type RawAutoEditClip = z.infer<typeof rawClipSchema>;
export type RawAutoEditImage = z.infer<typeof rawImageSchema>;
export type RawAutoEditShape = z.infer<typeof rawShapeSchema>;

const nullableString = { type: Type.STRING, nullable: true } as const;
const nullableNumber = { type: Type.NUMBER, nullable: true } as const;

const overlayItemSchema = {
  type: Type.OBJECT,
  properties: {
    text: { type: Type.STRING },
    startOffsetSeconds: nullableNumber,
    durationInSeconds: nullableNumber,
    xPercent: nullableNumber,
    yPercent: nullableNumber,
    fontSizePx: nullableNumber,
    color: nullableString,
    strokeColor: nullableString,
    backgroundColor: nullableString,
    rotationDeg: nullableNumber,
    animation: { type: Type.STRING, format: "enum", enum: CAPTION_ANIMATION_VALUES, nullable: true },
    fontFamily: { type: Type.STRING, format: "enum", enum: FONT_FAMILY_VALUES, nullable: true },
    glowColor: nullableString,
    italic: { type: Type.BOOLEAN, nullable: true },
    strokeWidthPx: nullableNumber,
    slotRank: { type: Type.INTEGER, nullable: true },
    keepUntilEnd: { type: Type.BOOLEAN, nullable: true },
  },
  required: ["text"],
} as const;

const imageItemSchema = {
  type: Type.OBJECT,
  properties: {
    imageNumber: { type: Type.INTEGER, nullable: true },
    description: { type: Type.STRING },
    name: nullableString,
    startOffsetSeconds: nullableNumber,
    durationInSeconds: nullableNumber,
    xPercent: nullableNumber,
    yPercent: nullableNumber,
    widthPercent: nullableNumber,
    heightPercent: nullableNumber,
    cornerRadiusPx: nullableNumber,
    animation: { type: Type.STRING, format: "enum", enum: CAPTION_ANIMATION_VALUES, nullable: true },
    keepUntilEnd: { type: Type.BOOLEAN, nullable: true },
    slotRank: { type: Type.INTEGER, nullable: true },
  },
  required: ["description"],
} as const;

const shapeItemSchema = {
  type: Type.OBJECT,
  properties: {
    kind: { type: Type.STRING, format: "enum", enum: ["rect", "circle"], nullable: true },
    keepUntilEnd: { type: Type.BOOLEAN, nullable: true },
    startOffsetSeconds: nullableNumber,
    durationInSeconds: nullableNumber,
    xPercent: nullableNumber,
    yPercent: nullableNumber,
    widthPercent: nullableNumber,
    heightPercent: nullableNumber,
    borderColor: nullableString,
    borderWidthPx: nullableNumber,
    fillColor: nullableString,
    fillOpacity: nullableNumber,
    cornerRadiusPx: nullableNumber,
  },
} as const;

/**
 * Geminiに返させるJSONの形(Gemini APIのresponseSchema)。自動編集(autoEditPlan.ts)と、
 * 学習データの正解動画の書き起こし(editExampleBreakdown.ts)の両方で同じ形を使う
 * (書き起こしを自動編集にそのままお手本の答えとして見せるため、形がずれないよう1か所にまとめる)。
 */
export const autoEditResponseSchema = {
  type: Type.OBJECT,
  properties: {
    referenceNotes: nullableString,
    summary: { type: Type.STRING },
    theme: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        primaryColor: { type: Type.STRING, description: "#RRGGBB形式" },
        fontFamily: { type: Type.STRING, format: "enum", enum: FONT_FAMILY_VALUES },
        captionPosition: { type: Type.STRING, format: "enum", enum: CAPTION_POSITION_VALUES },
        captionStyle: { type: Type.STRING, format: "enum", enum: CAPTION_STYLE_VALUES },
        captionFontSize: { type: Type.STRING, format: "enum", enum: CAPTION_FONT_SIZE_VALUES },
      },
    },
    hook: {
      type: Type.OBJECT,
      nullable: true,
      properties: { headline: { type: Type.STRING }, subline: nullableString },
      required: ["headline"],
    },
    cta: {
      type: Type.OBJECT,
      nullable: true,
      properties: { text: { type: Type.STRING } },
      required: ["text"],
    },
    framing: {
      type: Type.OBJECT,
      nullable: true,
      properties: { scale: { type: Type.NUMBER }, focusXPercent: nullableNumber, focusYPercent: nullableNumber },
      required: ["scale"],
    },
    globalShapes: { type: Type.ARRAY, nullable: true, items: shapeItemSchema },
    globalOverlays: { type: Type.ARRAY, nullable: true, items: overlayItemSchema },
    showCaptions: { type: Type.BOOLEAN, nullable: true },
    generatedImageStyle: { type: Type.STRING, format: "enum", enum: ["illustration", "photo"], nullable: true },
    clips: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          sourceStartSeconds: { type: Type.NUMBER },
          sourceEndSeconds: { type: Type.NUMBER },
          speech: nullableString,
          captionAnimation: { type: Type.STRING, format: "enum", enum: CAPTION_ANIMATION_VALUES, nullable: true },
          emphasisWords: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
          emphasisColor: nullableString,
          captionAccentColor: nullableString,
          captionFontFamily: { type: Type.STRING, format: "enum", enum: FONT_FAMILY_VALUES, nullable: true },
          captionGlowColor: nullableString,
          zoom: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
              scale: { type: Type.NUMBER },
              style: { type: Type.STRING, format: "enum", enum: ["punch", "slow"] },
              focusXPercent: { type: Type.NUMBER },
              focusYPercent: { type: Type.NUMBER },
            },
            required: ["scale"],
          },
          overlays: { type: Type.ARRAY, nullable: true, items: overlayItemSchema },
          images: { type: Type.ARRAY, nullable: true, items: imageItemSchema },
          shapes: { type: Type.ARRAY, nullable: true, items: shapeItemSchema },
          sfx: {
            type: Type.ARRAY,
            nullable: true,
            items: {
              type: Type.OBJECT,
              properties: {
                presetId: { type: Type.STRING, format: "enum", enum: SFX_PRESET_IDS },
                offsetSeconds: nullableNumber,
              },
              required: ["presetId"],
            },
          },
          narration: nullableString,
        },
        // Geminiは書いた順に考えるので、クリップの中もプロンプトの手順(①カット・物→②テロップ→
        // ③強調→④寄り→仕上げ)の順に出力させる。指定しないとアルファベット順になってしまう。
        propertyOrdering: [
          "sourceStartSeconds",
          "sourceEndSeconds",
          "speech",
          "captionAnimation",
          "emphasisWords",
          "emphasisColor",
          "captionAccentColor",
          "captionFontFamily",
          "captionGlowColor",
          "overlays",
          "images",
          "shapes",
          "zoom",
          "sfx",
          "narration",
        ],
        required: ["sourceStartSeconds", "sourceEndSeconds"],
      },
    },
  },
  // 参考スクショの読み取り→ずっと置く物→テーマ(テロップの見た目)→クリップ→仕上げ、の順。
  propertyOrdering: [
    "referenceNotes",
    "framing",
    "globalShapes",
    "globalOverlays",
    "theme",
    "showCaptions",
    "generatedImageStyle",
    "clips",
    "hook",
    "cta",
    "summary",
  ],
  required: ["summary", "clips"],
} as const;
