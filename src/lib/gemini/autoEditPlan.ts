import { GoogleGenAI, PartMediaResolutionLevel, Type, type Content, type Part } from "@google/genai";
import { readFile } from "node:fs/promises";
import {
  CAPTION_ANIMATION_OPTIONS,
  CAPTION_FONT_FAMILY_OPTIONS,
  CAPTION_POSITION_OPTIONS,
  CAPTION_STYLE_OPTIONS,
  clipZoomSchema,
  textOverlaySchema,
  type CaptionAnimation,
  type CaptionFontFamily,
  type CaptionPosition,
  type CaptionStyle,
  type ClipZoom,
  type TextOverlay,
} from "@video/shared/schema";
import { MAX_CLIPS } from "@video/templates/standard/schema";
import { SFX_PRESETS } from "@/components/editor/audioPresets";
import { runWithGeminiRateLimit } from "./rateLimiter";
import { isRetryableApiError, toFriendlyGeminiError } from "./geminiErrors";
import { waitForGeminiFileActive } from "./geminiFiles";
import { loadEditFewShotContext } from "./editExamplesStore";
import { rawAutoEditPlanSchema, type RawAutoEditClip } from "./autoEditTypes";

/**
 * 自動編集は「どこを切り、どこで寄り、何を画面に出すか」という演出判断そのものなので、
 * 文字起こし(GEMINI_MODEL)とは別に最上位のProモデルを既定にする。
 * GEMINI_MODELとは別の環境変数にしているのは、本番でGEMINI_MODELが軽量モデルのまま
 * 残っていても自動編集の質まで巻き込んで落とさないため。
 */
const DEFAULT_MODEL = "gemini-pro-latest";
/**
 * 本人の動画+参考スクショ+編集例のペア(最大6本)を読ませたうえでProモデルに考えさせるため、
 * 応答まで数分かかる。ジョブ化してポーリングしているので、ここは長めに取ってよい。
 */
const GEMINI_TIMEOUT_MS = 420_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 8_000;
const MIN_CLIP_SECONDS = 0.3;
const MAX_CLIP_SECONDS = 30;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** ナレーション自動生成の上限。本人の声と重なるとうるさくなるため無制限にはせず、
 * プロンプト指示だけでなくサーバー側でも切り詰める(二重の歯止め)。 */
export const MAX_AUTO_NARRATION_SEGMENTS = 10;

export type AutoEditPlanInput = {
  video: { absolutePath: string; mimeType: string; durationInSeconds: number };
  /** カット画面で残した範囲(再生順)。Geminiはこの範囲の中からだけ切り出してよい。 */
  keepRanges: { startFromSeconds: number; durationInSeconds: number }[];
  /** スタイル抽出画面で渡した参考スクショ/動画。自動編集の最優先の手本。 */
  styleReference: { absolutePath: string; mimeType: string; kind: "image" | "video" } | null;
};

export type AutoEditClipPlan = {
  startFromSeconds: number;
  durationInSeconds: number;
  /** この区間で話している内容。編集画面の「字幕を一括生成」で使う下書き。 */
  speechText: string;
  captionAnimation?: CaptionAnimation;
  emphasisWords?: string[];
  emphasisColor?: string;
  zoom?: ClipZoom;
  overlays?: TextOverlay[];
  sfx: { presetId: string; offsetSeconds: number }[];
  narration: string | null;
};

export type AutoEditPlan = {
  summary: string;
  referenceNotes: string | null;
  theme: {
    primaryColor?: string;
    fontFamily?: CaptionFontFamily;
    captionPosition?: CaptionPosition;
    captionStyle?: CaptionStyle;
  };
  hook: { headline: string; subline?: string } | null;
  cta: { text: string } | null;
  /** 動画全体に重ね続ける文字(上部のタイトル等)。秒数は動画全体の先頭から。 */
  globalOverlays: TextOverlay[];
  clips: AutoEditClipPlan[];
};

const FONT_FAMILY_VALUES = CAPTION_FONT_FAMILY_OPTIONS.map((option) => option.value);
const CAPTION_POSITION_VALUES = CAPTION_POSITION_OPTIONS.map((option) => option.value);
const CAPTION_STYLE_VALUES = CAPTION_STYLE_OPTIONS.map((option) => option.value);
const CAPTION_ANIMATION_VALUES = CAPTION_ANIMATION_OPTIONS.map((option) => option.value);
const SFX_PRESET_IDS = SFX_PRESETS.map((preset) => preset.id);

const captionAnimationHints = CAPTION_ANIMATION_OPTIONS.map((o) => `- ${o.value}: ${o.label}`).join("\n");
const fontFamilyHints = CAPTION_FONT_FAMILY_OPTIONS.map((o) => `- ${o.value}: ${o.label}`).join("\n");
const captionStyleHints = CAPTION_STYLE_OPTIONS.map((o) => `- ${o.value}: ${o.label}`).join("\n");
const sfxPresetHints = SFX_PRESETS.map((p) => `- ${p.id}: ${p.label}`).join("\n");

const formatSeconds = (seconds: number): string => seconds.toFixed(2);

const buildPrompt = (input: AutoEditPlanInput, hasReference: boolean, hasExamples: boolean): string => {
  const keepRangesList = input.keepRanges
    .map(
      (range, i) =>
        `${i + 1}. ${formatSeconds(range.startFromSeconds)}秒〜${formatSeconds(range.startFromSeconds + range.durationInSeconds)}秒`
    )
    .join("\n");

  const priorityLines = [
    hasReference
      ? "1. 【最優先・絶対】最初に添付した参考スクショ/参考動画の「編集の感じ」(テロップや強調テキストの色・縁取り・帯・大きさ・位置・フォントの系統、画面の賑やかさ、寄りの多さ)を忠実に再現すること。他の手本と食い違ったら必ずこちらを優先する。"
      : "1. 参考スクショは今回ありません。",
    hasExamples
      ? "2. 次に添付した編集例(学習動画=編集前、正解動画=編集後)から、編集者がどこを切り、どこで寄り、どんな文字や効果音を足したかの癖を学び、手本にすること。"
      : "2. 編集例は今回ありません。",
    "3. 最後に添付した動画が、今回あなたが編集する本人の動画です。",
  ].join("\n");

  return `
あなたはTikTok・Instagramリール・YouTubeショートで数百万再生を連発している、ショート動画(9:16)の
編集者です。今回は編集の判断をすべてあなたに任せます。遠慮せず、ガッツリ手を入れてください。

## 手本の優先順位
${priorityLines}

## 本人の動画について
- 動画全体の長さ: ${formatSeconds(input.video.durationInSeconds)}秒
- 本人がカット画面で「使う」と決めた範囲(再生順)。**クリップはこの範囲の中からだけ切り出すこと**:
${keepRangesList}

## あなたが決めること(すべて自由。候補が書いてあるものだけは候補から選ぶ)
1. clips: 完成動画に使う区間を再生順に並べる。元動画上の秒数(sourceStartSeconds〜sourceEndSeconds)で指定する。
   - 間・言い淀み(「えーっと」「あの」)・言い直し・無音・話がだれる部分は容赦なく切って詰める
   - 1クリップはおおむね1〜4秒(話のひと区切り)。長く話し続ける所も区切ってテンポを出す
   - 範囲の順番は入れ替えてよい(冒頭に一番強い一言を持ってくる等)。ただし同じ区間を二度使わない
   - クリップ数は最大${MAX_CLIPS}個
2. speech: そのクリップで本人が話している言葉をそのまま書き起こす(字幕の下書きになる)。
3. zoom: 強調したい瞬間に画面を寄せる。scaleは1.05〜1.6程度で自由、styleはpunch(一気に寄る)かslow(じわじわ寄る)。
   focusXPercent/focusYPercentで寄る中心(顔や手元など)を0〜100で指定する。全体の3〜5割のクリップに入れるくらいが目安。
4. overlays: 字幕とは別に画面へ出す強調テキスト(「実は3倍!」「ここ重要」「え?」など)。文言・位置(xPercent/yPercent、
   文字の中心)・大きさ(fontSizePx、20〜220)・色・縁取り色・帯の色・傾き(rotationDeg)・出すタイミング(クリップ先頭からの秒)は
   すべて自由。参考スクショに似た見た目にすること。顔を隠さない位置に置くこと。animationは候補から選ぶ:
${captionAnimationHints}
5. emphasisWords / emphasisColor: 字幕を付けたときに色を変えて大きく見せる単語(数字・キーワード)と、その色(#RRGGBB)。
   emphasisWordsはspeechの中に実際に出てくる語にすること。
6. captionAnimation: 字幕の出現演出(候補は4と同じ)。
7. sfx: そのクリップで鳴らす効果音(offsetSecondsはクリップ先頭からの秒)。意味に合うものを選ぶ
   (問いかけ→はてな、良い結果→成功、残念な事実→残念、場面転換→スワイプ/切り替え、発表→決定/ポップ、衝撃→グリッチ)。候補:
${sfxPresetHints}
8. narration: 本人の声とは別にAIナレーションで足す一言。本人が話していない所や、フック・オチを押したい所だけ。
   合計${MAX_AUTO_NARRATION_SEGMENTS}個まで。不要ならnull。
9. hook: 冒頭0〜3秒に本人の映像の上へ重ねる大見出し(スクロールを止める一言。数字・意外性)。subline(補足)は任意。
10. cta: 最後の数秒に重ねる一言(「保存して見返してね」など)。不要ならnull。
11. globalOverlays: 動画全体を通して出し続ける文字(最大4個)。参考スクショの上部に「〇〇vs〇〇 どっちがいい?」のような
    テーマのタイトルが常に出ているなら、この動画の内容に合わせたタイトルを同じ見た目・同じ位置で必ず作る。
    1行ごとに別要素にして色を変えてもよい。項目はoverlaysと同じ(秒数は動画全体の先頭から。durationInSecondsをnullにすると最後まで表示)。
12. theme: 全体の差し色(primaryColor、#RRGGBB)・フォント・字幕位置・字幕の背景の付き方。参考スクショに合わせる。
    fontFamily候補:
${fontFamilyHints}
    captionPosition候補: ${CAPTION_POSITION_VALUES.join(" / ")}
    captionStyle候補:
${captionStyleHints}

## 画面の配置(重なると読めなくなるので必ず守る)
- globalOverlays(ずっと出すタイトル): 画面上部(yPercentが8〜25あたり)
- hook: 冒頭3秒だけ画面中央に大きく出る
- 字幕: themeのcaptionPositionの位置(top=上部 / middle=中央 / bottom=下部)
- cta: 最後の5秒、画面下から2割あたりに出る
- overlays: 上の要素と同じ時間に同じ場所へ置かない。顔も隠さない
- overlaysは字幕(speech)と同じ文言をそのまま繰り返さず、短い見出し・ツッコミ・数字にする

## 量の目安(控えめすぎる編集は失敗とみなします)
- 寄り(zoom): クリップの4〜6割
- 強調テキスト(overlays): クリップの半分以上。数字・結論・ツッコミ・問いかけは必ず文字にする
- 効果音(sfx): クリップの半分前後。強調テキストが出る瞬間に合わせる
- 参考スクショが賑やかなら、それ以上に賑やかにしてよい

## 設計の考え方
- 冒頭0〜2秒で視聴者を掴む(hook+寄り+効果音+強調テキストを重ねてよい)
- 1〜3秒に1回は何か変化(寄り・強調テキスト・効果音)を入れて視聴維持させる
- ランキングの順位・数字・比較の結果・オチ・結論で山を作る
- 最後は保存・シェアしたくなる締めにする

referenceNotesには、参考スクショ/動画から読み取った編集の癖を日本語1〜2文で書いてください(無ければnull)。
summaryには、どこを切ってどこをフックにし、どこで山を作ったかを日本語1〜2文で書いてください。

JSON以外の文字列は出力しないでください。
`.trim();
};

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
  },
  required: ["text"],
} as const;

const responseSchema = {
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
    globalOverlays: { type: Type.ARRAY, nullable: true, items: overlayItemSchema },
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
        required: ["sourceStartSeconds", "sourceEndSeconds"],
      },
    },
  },
  required: ["summary", "clips"],
} as const;

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
const hexOrUndefined = (value: string | null | undefined): string | undefined =>
  value && HEX_COLOR_PATTERN.test(value) ? value : undefined;

/**
 * Geminiが返したクリップを、カット画面で残した範囲に収める。クリップの中心が入っている
 * 範囲を「属する範囲」とみなし、はみ出した分はその範囲の端で切り詰める(ユーザーが
 * 捨てた部分を勝手に復活させないため)。どの範囲にも属さない・短すぎるクリップはnull。
 */
const fitClipToKeepRanges = (
  clip: RawAutoEditClip,
  keepRanges: AutoEditPlanInput["keepRanges"]
): { startFromSeconds: number; durationInSeconds: number } | null => {
  const start = Math.min(clip.sourceStartSeconds, clip.sourceEndSeconds);
  const end = Math.max(clip.sourceStartSeconds, clip.sourceEndSeconds);
  const middle = (start + end) / 2;
  const range = keepRanges.find(
    (r) => middle >= r.startFromSeconds && middle <= r.startFromSeconds + r.durationInSeconds
  );
  if (!range) return null;
  const fittedStart = Math.max(start, range.startFromSeconds);
  const fittedEnd = Math.min(end, range.startFromSeconds + range.durationInSeconds, fittedStart + MAX_CLIP_SECONDS);
  if (fittedEnd - fittedStart < MIN_CLIP_SECONDS) return null;
  return { startFromSeconds: fittedStart, durationInSeconds: fittedEnd - fittedStart };
};

/** Geminiの強調テキストを描画側のスキーマに合わせて丸め込む。範囲外の数値は端に寄せ、不正な要素は捨てる。 */
const normalizeOverlays = (
  rawOverlays: RawAutoEditClip["overlays"],
  clipDuration: number,
  maxCount: number
): TextOverlay[] | undefined => {
  const overlays: TextOverlay[] = [];
  for (const raw of rawOverlays ?? []) {
    if (!raw.text.trim()) continue;
    const startOffsetSeconds = clamp(raw.startOffsetSeconds ?? 0, 0, Math.max(0, clipDuration - 0.2));
    const parsed = textOverlaySchema.safeParse({
      text: raw.text.trim(),
      startOffsetSeconds,
      durationInSeconds:
        raw.durationInSeconds != null
          ? clamp(raw.durationInSeconds, 0.2, Math.max(0.2, clipDuration - startOffsetSeconds))
          : undefined,
      xPercent: clamp(raw.xPercent ?? 50, 0, 100),
      yPercent: clamp(raw.yPercent ?? 30, 0, 100),
      fontSizePx: clamp(raw.fontSizePx ?? 80, 20, 220),
      color: hexOrUndefined(raw.color) ?? "#FFFFFF",
      strokeColor: hexOrUndefined(raw.strokeColor),
      backgroundColor: hexOrUndefined(raw.backgroundColor),
      rotationDeg: clamp(raw.rotationDeg ?? 0, -30, 30),
      animation: raw.animation ?? "pop",
    });
    if (parsed.success) overlays.push(parsed.data);
  }
  return overlays.length > 0 ? overlays.slice(0, maxCount) : undefined;
};

const normalizeZoom = (clip: RawAutoEditClip): ClipZoom | undefined => {
  if (!clip.zoom || clip.zoom.scale <= 1.001) return undefined;
  const parsed = clipZoomSchema.safeParse({
    scale: clamp(clip.zoom.scale, 1, 2),
    style: clip.zoom.style ?? "punch",
    focusXPercent: clamp(clip.zoom.focusXPercent ?? 50, 0, 100),
    focusYPercent: clamp(clip.zoom.focusYPercent ?? 40, 0, 100),
  });
  return parsed.success ? parsed.data : undefined;
};

/**
 * Gemini File APIへ1本アップロードしてACTIVEになるまで待ち、Partとして返す。
 * 本人の動画・参考動画の読み込みで共通に使う。
 */
const uploadFileAsPart = async (
  ai: GoogleGenAI,
  absolutePath: string,
  mimeType: string,
  uploadedFileNames: string[]
): Promise<Part> => {
  const uploaded = await ai.files.upload({ file: absolutePath, config: { mimeType } });
  if (!uploaded.name || !uploaded.uri) {
    throw new Error("動画のアップロードに失敗しました");
  }
  uploadedFileNames.push(uploaded.name);
  await waitForGeminiFileActive(ai, uploaded.name);
  return { fileData: { fileUri: uploaded.uri, mimeType } };
};

/**
 * 本人の動画・参考スクショ/動画・編集例(学習動画+正解動画のペア)をGeminiに見せ、切り方・寄り・
 * 強調テキスト・効果音・ナレーション・フック・CTA・全体の見た目まで、編集の判断をすべて任せる。
 * 手本の優先順位は「参考スクショ > 編集例 > 一般的なバズ動画の定石」。
 * フォールバックは持たない(失敗時は呼び出し元でエラー表示し、常にスキップできるようにする)。
 */
export const generateAutoEditPlan = async (input: AutoEditPlanInput): Promise<AutoEditPlan> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEYが未設定です");
  }
  if (input.keepRanges.length === 0) {
    throw new Error("使う範囲がありません。カット画面で範囲を残してください");
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_AUTO_EDIT_MODEL || DEFAULT_MODEL;

  const uploadedFileNames: string[] = [];
  try {
    const contents: Content[] = [];

    // 1. 参考スクショ/動画(最優先の手本)。スクショは縁取りの太さなど細部まで読めるよう高解像度で渡す。
    if (input.styleReference) {
      const referencePart: Part =
        input.styleReference.kind === "image"
          ? {
              inlineData: {
                mimeType: input.styleReference.mimeType,
                data: (await readFile(input.styleReference.absolutePath)).toString("base64"),
              },
              mediaResolution: { level: PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH },
            }
          : await uploadFileAsPart(ai, input.styleReference.absolutePath, input.styleReference.mimeType, uploadedFileNames);
      contents.push({
        role: "user",
        parts: [
          { text: "【手本1・最優先】参考スクショ/参考動画。この投稿者の編集の感じを最優先で再現してください。" },
          referencePart,
        ],
      });
    }

    // 2. 編集例(学習動画+正解動画のペア)。
    const fewShot = await loadEditFewShotContext(ai);
    uploadedFileNames.push(...fewShot.uploadedFileNames);
    contents.push(...fewShot.contents);

    // 3. 本人の動画+依頼文。
    const videoPart = await uploadFileAsPart(ai, input.video.absolutePath, input.video.mimeType, uploadedFileNames);
    const prompt = buildPrompt(input, input.styleReference !== null, fewShot.contents.length > 0);
    contents.push({
      role: "user",
      parts: [{ text: "【今回編集する本人の動画】" }, videoPart, { text: prompt }],
    });

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await runWithGeminiRateLimit(() => {
          const generatePromise = ai.models.generateContent({
            model,
            contents,
            config: { responseMimeType: "application/json", responseSchema },
          });
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("Gemini API timeout")), GEMINI_TIMEOUT_MS);
          });
          return Promise.race([generatePromise, timeoutPromise]);
        });

        // プリペイド(800円)で運用しているため、1回あたりの消費量をサーバーログで追えるようにしておく
        // (残高切れの前に重さに気づけるように)。
        const usage = response.usageMetadata;
        console.info(
          `[autoEditPlan] model=${response.modelVersion ?? model} 入力${usage?.promptTokenCount ?? "?"}トークン` +
            ` 出力${usage?.candidatesTokenCount ?? "?"}トークン 思考${usage?.thoughtsTokenCount ?? "?"}トークン`
        );

        const text = response.text;
        if (!text) {
          throw new Error("Gemini APIから空の応答が返されました");
        }

        const parsed = rawAutoEditPlanSchema.safeParse(JSON.parse(text));
        if (!parsed.success) {
          throw new Error(`Gemini応答のスキーマ検証に失敗: ${parsed.error.message}`);
        }

        const clips: AutoEditClipPlan[] = [];
        let narrationCount = 0;
        for (const raw of parsed.data.clips) {
          if (clips.length >= MAX_CLIPS) break;
          const fitted = fitClipToKeepRanges(raw, input.keepRanges);
          if (!fitted) continue;
          const narration = raw.narration?.trim() || null;
          const acceptNarration = narration !== null && narrationCount < MAX_AUTO_NARRATION_SEGMENTS;
          if (acceptNarration) narrationCount++;
          const emphasisWords = (raw.emphasisWords ?? []).map((w) => w.trim()).filter((w) => w.length > 0);
          clips.push({
            ...fitted,
            speechText: raw.speech?.trim() ?? "",
            captionAnimation: (raw.captionAnimation ?? undefined) as CaptionAnimation | undefined,
            emphasisWords: emphasisWords.length > 0 ? emphasisWords : undefined,
            emphasisColor: hexOrUndefined(raw.emphasisColor),
            zoom: normalizeZoom(raw),
            overlays: normalizeOverlays(raw.overlays, fitted.durationInSeconds, 8),
            sfx: (raw.sfx ?? []).map((s) => ({
              presetId: s.presetId,
              offsetSeconds: clamp(s.offsetSeconds ?? 0, 0, Math.max(0, fitted.durationInSeconds - 0.1)),
            })),
            narration: acceptNarration ? narration : null,
          });
        }
        if (clips.length === 0) {
          throw new Error("Geminiの編集案に使えるクリップがありませんでした。もう一度お試しください");
        }

        const theme = parsed.data.theme ?? {};
        return {
          summary: parsed.data.summary,
          referenceNotes: parsed.data.referenceNotes?.trim() || null,
          theme: {
            primaryColor: hexOrUndefined(theme.primaryColor),
            fontFamily: (theme.fontFamily ?? undefined) as CaptionFontFamily | undefined,
            captionPosition: (theme.captionPosition ?? undefined) as CaptionPosition | undefined,
            captionStyle: (theme.captionStyle ?? undefined) as CaptionStyle | undefined,
          },
          hook: parsed.data.hook?.headline.trim()
            ? { headline: parsed.data.hook.headline.trim(), subline: parsed.data.hook.subline?.trim() || undefined }
            : null,
          cta: parsed.data.cta?.text.trim() ? { text: parsed.data.cta.text.trim() } : null,
          globalOverlays: normalizeOverlays(
            parsed.data.globalOverlays,
            clips.reduce((sum, clip) => sum + clip.durationInSeconds, 0),
            4
          ) ?? [],
          clips,
        };
      } catch (error) {
        lastError = error;
        if (isRetryableApiError(error) && attempt < MAX_ATTEMPTS) {
          const delayMs = RETRY_BASE_DELAY_MS * attempt;
          console.warn(
            `[autoEditPlan] Geminiが混雑しているため${delayMs}ms後に再試行します(試行${attempt}/${MAX_ATTEMPTS})`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw toFriendlyGeminiError(error);
      }
    }
    throw toFriendlyGeminiError(lastError);
  } finally {
    for (const name of uploadedFileNames) {
      await ai.files.delete({ name }).catch(() => {});
    }
  }
};
