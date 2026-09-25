import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import {
  CAPTION_ANIMATION_OPTIONS,
  CAPTION_FONT_FAMILY_OPTIONS,
  CAPTION_FONT_SIZE_OPTIONS,
  CAPTION_POSITION_OPTIONS,
  CAPTION_STYLE_OPTIONS,
  clipZoomSchema,
  imageOverlaySchema,
  textOverlaySchema,
  type ImageOverlay,
  type TextOverlay,
} from "@video/shared/schema";
import { SFX_PRESETS } from "@/components/editor/audioPresets";
import { runWithGeminiRateLimit } from "./rateLimiter";
import { isRetryableApiError, toFriendlyGeminiError } from "./geminiErrors";

/**
 * 細かい修正依頼(「3つ目の強調テキストをもっと大きく」等)は、今の編集内容(文字情報)を読んで
 * 該当箇所だけ直せば足り、動画を見せる必要はない。速くて安い最新のFlashを既定にする
 * (1回あたり数千トークン程度)。
 */
const DEFAULT_MODEL = "gemini-flash-latest";
const GEMINI_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 5_000;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const hexColor = z.string().regex(HEX_COLOR);
const captionAnimation = z.enum(CAPTION_ANIMATION_OPTIONS.map((o) => o.value) as [string, ...string[]]);

/** AIに渡し、AIから受け取る編集内容。クリップ・効果音はidで元の要素と対応づける。 */
export const editableStateSchema = z.object({
  theme: z.object({
    primaryColor: hexColor,
    fontFamily: z.enum(CAPTION_FONT_FAMILY_OPTIONS.map((o) => o.value) as [string, ...string[]]),
    captionPosition: z.enum(CAPTION_POSITION_OPTIONS.map((o) => o.value) as [string, ...string[]]),
    captionStyle: z.enum(CAPTION_STYLE_OPTIONS.map((o) => o.value) as [string, ...string[]]),
    fontSize: z.enum(CAPTION_FONT_SIZE_OPTIONS.map((o) => o.value) as [string, ...string[]]),
  }),
  hook: z.object({ headline: z.string(), subline: z.string().optional() }).nullable(),
  cta: z.object({ text: z.string() }).nullable(),
  globalOverlays: z.array(z.unknown()),
  globalImages: z.array(z.unknown()),
  clips: z.array(
    z.object({
      id: z.number().int(),
      startFromSeconds: z.number(),
      durationInSeconds: z.number(),
      caption: z.string(),
      captionAnimation,
      emphasisWords: z.array(z.string()).optional(),
      emphasisColor: z.string().optional(),
      zoom: z.unknown().optional(),
      overlays: z.array(z.unknown()).optional(),
      images: z.array(z.unknown()).optional(),
    })
  ),
  sfx: z.array(
    z.object({
      id: z.number().int().nullable().optional(),
      // 画面側では使わない(新しい効果音の名前はプリセットから付ける)。AIが新しく足した効果音で
      // 省略してくることがあり、必須にしていると依頼全体が失敗していた。
      label: z.string().optional(),
      presetId: z.string().nullable().optional(),
      startFromSeconds: z.number(),
      volume: z.number(),
      isNarration: z.boolean().optional(),
    })
  ),
});

export type EditableState = z.infer<typeof editableStateSchema>;

export type ReviseEditInput = {
  instruction: string;
  /** 依頼時に選択していたクリップのid(「このクリップ」と言われた時の対象)。 */
  selectedClipId: number | null;
  videoDurationInSeconds: number;
  state: EditableState;
};

export type ReviseEditResult = {
  /** AIが何を変えたか(日本語の箇条書き)。反映前に利用者へ見せる。 */
  changes: string[];
  state: {
    theme: EditableState["theme"];
    hook: EditableState["hook"];
    cta: EditableState["cta"];
    globalOverlays: TextOverlay[];
    globalImages: ImageOverlay[];
    clips: {
      id: number;
      startFromSeconds: number;
      durationInSeconds: number;
      caption: string;
      captionAnimation: string;
      emphasisWords?: string[];
      emphasisColor?: string;
      zoom?: z.infer<typeof clipZoomSchema>;
      overlays?: TextOverlay[];
      images?: ImageOverlay[];
    }[];
    sfx: { id: number | null; presetId: string | null; startFromSeconds: number; volume: number }[];
  };
};

const rawResponseSchema = z.object({
  changes: z.array(z.string()),
  state: editableStateSchema,
});

const sfxPresetHints = SFX_PRESETS.map((p) => `${p.id}(${p.label})`).join(", ");

const buildPrompt = (input: ReviseEditInput): string => `
あなたはショート動画の編集者です。以下は今の編集内容(JSON)です。利用者の修正依頼どおりに直した
編集内容を返してください。

## 修正依頼
${input.instruction}
${input.selectedClipId !== null ? `\n(利用者は今 clips の id=${input.selectedClipId} のクリップを選択しています。「このクリップ」「ここ」はこのクリップを指します)` : ""}

## 守ること
- **依頼に関係ない部分は1文字も変えない**(数値の丸めもしない)。依頼が曖昧なら、一番自然な解釈で最小限だけ直す
- clips は再生順。並べ替え・削除・尺(startFromSeconds / durationInSeconds、元動画上の秒)の変更はしてよいが、
  新しいクリップは作らない(id は元のものだけを使う)。startFromSecondsは0〜${input.videoDurationInSeconds.toFixed(2)}秒、
  durationInSecondsは0.3秒以上
- 画像(images / globalImages)は位置・大きさ・傾き・角の丸み・時刻・演出だけ変えてよい。src は絶対に変えず、画像を増やさない
- 強調テキスト(overlays / globalOverlays)は文言・位置(xPercent/yPercentは0〜100、文字の中心)・大きさ(fontSizePx 20〜220)・
  色(#RRGGBB)・縁取り(strokeColor)・帯(backgroundColor)・傾き(rotationDeg -30〜30)・時刻・演出を自由に変えてよく、増やしても消してもよい
- zoom は scale(1〜2)・style(punch=一気に寄る / slow=じわじわ寄る)・focusXPercent / focusYPercent(寄る中心)。寄りを消すなら zoom を省く
- sfx の id が null のものは新しく足す効果音。presetId は次の中から: ${sfxPresetHints}
  既存の効果音(id あり)は startFromSeconds(動画全体の先頭からの秒)と volume(0〜2)だけ変えてよく、消してもよい。
  isNarration=true はAIナレーション(音声は作り直せないので、時刻・音量・削除のみ)
- 候補がある値(fontFamily / captionPosition / captionStyle / fontSize / captionAnimation / animation)は今と同じ候補の中から選ぶ
  captionAnimation の候補: ${CAPTION_ANIMATION_OPTIONS.map((o) => `${o.value}(${o.label})`).join(", ")}

## 返す形
{"changes": ["何をどう変えたか(日本語で短く、1項目1行)"], "state": { 今の編集内容と同じ形 }}
JSON以外は出力しないこと。

## 今の編集内容
${JSON.stringify(input.state)}
`.trim();

/** AIの返した強調テキスト/画像/寄りを描画側のスキーマで検証し、不正な要素は捨てる。 */
const parseEach = <T>(items: unknown[] | undefined, schema: z.ZodType<T>): T[] =>
  (items ?? []).flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });

/**
 * 今の編集内容と修正依頼をGeminiに渡し、依頼どおりに直した編集内容を返す。反映するかどうかは
 * 利用者が画面で決める(ここでは返すだけ)。画像のsrcは元のものに戻し、存在しないクリップid・
 * 範囲外の秒数は捨てる/丸める(AIの勘違いで素材が差し替わったり動画が壊れたりしないように)。
 */
export const reviseEdit = async (input: ReviseEditInput): Promise<ReviseEditResult> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEYが未設定です");
  }
  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_REVISE_MODEL || DEFAULT_MODEL;
  const originalClips = new Map(input.state.clips.map((clip) => [clip.id, clip]));
  const originalSfxIds = new Set(input.state.sfx.flatMap((s) => (s.id != null ? [s.id] : [])));
  const presetIds = new Set(SFX_PRESETS.map((p) => p.id));

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await runWithGeminiRateLimit(() => {
        const generatePromise = ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: buildPrompt(input) }] }],
          config: { responseMimeType: "application/json" },
        });
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Gemini API timeout")), GEMINI_TIMEOUT_MS);
        });
        return Promise.race([generatePromise, timeoutPromise]);
      });

      const usage = response.usageMetadata;
      console.info(
        `[reviseEdit] model=${response.modelVersion ?? model} 入力${usage?.promptTokenCount ?? "?"}トークン` +
          ` 出力${usage?.candidatesTokenCount ?? "?"}トークン 思考${usage?.thoughtsTokenCount ?? "?"}トークン`
      );

      const text = response.text;
      if (!text) throw new Error("Gemini APIから空の応答が返されました");
      const parsed = rawResponseSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        throw new Error(`Gemini応答の形が想定と違いました: ${parsed.error.message.slice(0, 300)}`);
      }
      const revised = parsed.data.state;

      const clips: ReviseEditResult["state"]["clips"] = [];
      const usedIds = new Set<number>();
      for (const clip of revised.clips) {
        const original = originalClips.get(clip.id);
        if (!original || usedIds.has(clip.id)) continue;
        usedIds.add(clip.id);
        const start = Math.min(Math.max(clip.startFromSeconds, 0), Math.max(0, input.videoDurationInSeconds - 0.3));
        const duration = Math.min(Math.max(clip.durationInSeconds, 0.3), input.videoDurationInSeconds - start, 30);
        const zoom = clip.zoom === undefined ? undefined : clipZoomSchema.safeParse(clip.zoom);
        // 画像はsrcを元のクリップの同じ番号の画像に戻す(AIに素材を差し替えさせない)。元より多い分は捨てる。
        const originalImages = parseEach(original.images, imageOverlaySchema);
        const images = parseEach(clip.images, imageOverlaySchema)
          .slice(0, originalImages.length)
          .map((image, i) => ({ ...image, src: originalImages[i].src }));
        clips.push({
          id: clip.id,
          startFromSeconds: start,
          durationInSeconds: duration,
          caption: clip.caption,
          captionAnimation: clip.captionAnimation,
          emphasisWords: clip.emphasisWords,
          emphasisColor: clip.emphasisColor && HEX_COLOR.test(clip.emphasisColor) ? clip.emphasisColor : undefined,
          zoom: zoom?.success ? zoom.data : undefined,
          overlays: parseEach(clip.overlays, textOverlaySchema).slice(0, 8),
          images,
        });
      }
      if (clips.length === 0) {
        throw new Error("AIの修正案でクリップがすべて消えてしまったため、反映できません。依頼を変えてお試しください");
      }

      const originalGlobalImages = parseEach(input.state.globalImages, imageOverlaySchema);
      const globalImages = parseEach(revised.globalImages, imageOverlaySchema)
        .slice(0, originalGlobalImages.length)
        .map((image, i) => ({ ...image, src: originalGlobalImages[i].src }));

      const sfx = revised.sfx.flatMap((s) => {
        const isExisting = s.id != null && originalSfxIds.has(s.id);
        const presetId = s.presetId && presetIds.has(s.presetId) ? s.presetId : null;
        if (!isExisting && !presetId) return [];
        return [
          {
            id: isExisting ? (s.id as number) : null,
            presetId: isExisting ? null : presetId,
            startFromSeconds: Math.max(0, s.startFromSeconds),
            volume: Math.min(Math.max(s.volume, 0), 2),
          },
        ];
      });

      return {
        changes: parsed.data.changes,
        state: {
          theme: revised.theme,
          hook: revised.hook?.headline.trim() ? revised.hook : null,
          cta: revised.cta?.text.trim() ? revised.cta : null,
          globalOverlays: parseEach(revised.globalOverlays, textOverlaySchema).slice(0, 4),
          globalImages,
          clips,
          sfx,
        },
      };
    } catch (error) {
      lastError = error;
      if (isRetryableApiError(error) && attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * attempt));
        continue;
      }
      throw toFriendlyGeminiError(error);
    }
  }
  throw toFriendlyGeminiError(lastError);
};
