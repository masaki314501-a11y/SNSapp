import { GoogleGenAI, MediaResolution, Type, type Content } from "@google/genai";
import type {
  CaptionAnimation,
  CaptionFontFamily,
  CaptionPosition,
  CaptionStyle,
} from "@video/shared/schema";
import {
  CAPTION_ANIMATION_OPTIONS,
  CAPTION_FONT_FAMILY_OPTIONS,
  CAPTION_POSITION_OPTIONS,
  CAPTION_STYLE_OPTIONS,
} from "@video/shared/schema";
import { SFX_PRESETS } from "@/components/editor/audioPresets";
import { runWithGeminiRateLimit } from "./rateLimiter";
import { isRetryableApiError, toFriendlyGeminiError } from "./geminiErrors";
import { loadEditFewShotContext } from "./editExamplesStore";
import { autoEditPlanSchema } from "./autoEditTypes";

/**
 * 自動編集は「どこで視聴者を掴み、どこで声・効果音を入れるか」という演出判断そのものなので、
 * 文字起こし(GEMINI_MODEL)とは別に最上位のProモデルを既定にする。課金移行前はflash-liteで
 * 動かしていたが、提案がどの動画でも似たり寄ったりになっていた。
 * GEMINI_MODELとは別の環境変数にしているのは、本番でGEMINI_MODELが軽量モデルのまま
 * 残っていても自動編集の質まで巻き込んで落とさないため。
 */
const DEFAULT_MODEL = "gemini-pro-latest";
/**
 * few-shot例(loadEditFewShotContext)が読み込めるようになった後、登録済みの編集例
 * (実際の参考動画、数十〜100MB超)を毎回モデルに読ませるようになったため、テキストのみの
 * 応答より生成に時間がかかる。60秒だと動画込みの実測(約70秒)にすら足りず頻繁にタイムアウト
 * していたため余裕を持たせている。Proモデル+学習動画・正解動画のペア(最大6本)にしてからは
 * さらに思考に時間がかかるため、180秒から延ばした。
 */
const GEMINI_TIMEOUT_MS = 300_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 8_000;

/** ナレーション自動生成の上限。課金移行前は無料枠のTTS上限のため5件に絞っていた。
 * 声を入れすぎると逆にうるさくなるため無制限にはせず、プロンプト指示だけでなく
 * サーバー側でも切り詰める(二重の歯止め)。 */
export const MAX_AUTO_NARRATION_SEGMENTS = 10;

export type AutoEditPlanInput = {
  segments: { key: string; caption: string; durationInSeconds: number }[];
  theme: {
    primaryColor: string;
    fontFamily: CaptionFontFamily;
    captionPosition: CaptionPosition;
    captionStyle: CaptionStyle;
    captionAnimation: CaptionAnimation;
  };
  /** 参考画像/動画からのスタイル抽出が既に成功しているか。trueならtheme欄の判断は不要。 */
  hasStyleReference: boolean;
};

export type AutoEditSegmentPlan = {
  key: string;
  captionAnimation?: CaptionAnimation;
  addNarration: boolean;
  sfxPresetId: string | null;
};

export type AutoEditPlan = {
  segments: AutoEditSegmentPlan[];
  theme?: {
    primaryColor?: string;
    fontFamily?: CaptionFontFamily;
    captionPosition?: CaptionPosition;
    captionStyle?: CaptionStyle;
  };
  summary: string;
};

const FONT_FAMILY_VALUES = CAPTION_FONT_FAMILY_OPTIONS.map((option) => option.value);
const CAPTION_POSITION_VALUES = CAPTION_POSITION_OPTIONS.map((option) => option.value);
const CAPTION_STYLE_VALUES = CAPTION_STYLE_OPTIONS.map((option) => option.value);
const CAPTION_ANIMATION_VALUES = CAPTION_ANIMATION_OPTIONS.map((option) => option.value);
const SFX_PRESET_IDS = SFX_PRESETS.map((preset) => preset.id);

const captionAnimationHints = CAPTION_ANIMATION_OPTIONS.map((o) => `- ${o.value}: ${o.label}`).join("\n");
const fontFamilyHints = CAPTION_FONT_FAMILY_OPTIONS.map((o) => `- ${o.value}: ${o.label}`).join("\n");
const captionPositionHints = CAPTION_POSITION_OPTIONS.map((o) => `- ${o.value}: ${o.label}`).join("\n");
const captionStyleHints = CAPTION_STYLE_OPTIONS.map((o) => `- ${o.value}: ${o.label}`).join("\n");
const sfxPresetHints = SFX_PRESETS.map((p) => `- ${p.id}: ${p.label}`).join("\n");

const buildPrompt = (input: AutoEditPlanInput): string => {
  const segmentsList = input.segments
    .map((s, i) => `${i}. "${s.caption || "(テロップ無し)"}" (${s.durationInSeconds.toFixed(1)}秒)`)
    .join("\n");

  const themeSection = input.hasStyleReference
    ? "配色・フォント・テロップ位置・背景の付き方は既に参考画像/動画から決定済みです。themeフィールドは省略してください。"
    : `参考画像/動画が無いため、配色・フォント・テロップ位置・背景の付き方もあなたが決めてください。
候補一覧(候補にない値は絶対に使わないこと):
fontFamily:
${fontFamilyHints}
captionPosition:
${captionPositionHints}
captionStyle:
${captionStyleHints}`;

  return `
あなたはTikTok・Instagramリール・YouTubeショートで数百万再生を連発している、ショート動画(9:16)の
編集ディレクターです。以下は既にカット・文字起こし済みのクリップ一覧(再生順)です。
この動画を「最後まで見られ、保存・シェアされる」動画に仕上げるため、各クリップの演出・
AIナレーション・効果音を本気で設計してください。
編集例の動画が添付されている場合は、その編集者の癖(効果音を入れるタイミングと種類、
強調の仕方、テンポ)を最優先の手本にしてください。

## クリップ一覧(index. "テロップ" (尺))
${segmentsList}

## 設計の手順(頭の中で行い、出力には含めない)
1. 全体を読み、この動画の「一番の見どころ・意外性・結論」がどのクリップにあるかを特定する
2. 冒頭0〜2秒(最初の1〜2クリップ)を「フック」として最も強く演出する。スクロールを止めさせる
   問いかけ・意外な事実・数字がある箇所には声と効果音を重ねてよい
3. 中盤は視聴維持のため、およそ3〜5秒に1回は何かが変化するように演出を散らす
   (演出の上書き・効果音・声のいずれか)。ただし全クリップに付けるとメリハリが消えるので、
   何もしないクリップも意図的に残す
4. ランキングの順位・数字・比較の結果・オチ・結論など「ここを聞き逃すと損」な箇所で山を作る
5. 最後のクリップは余韻や保存したくなる締めになるよう演出する

## あなたが決めてよいこと
1. captionAnimation: 強調したい区間だけ演出を上書きする(省略可)。候補:
${captionAnimationHints}
2. addNarration: そのクリップをAIナレーション(読み上げ音声)で強調すべきか。
   フック・問いかけ・順位発表・結論など、声で押すと効く箇所をtrueにしてください。
   **合計で最大${MAX_AUTO_NARRATION_SEGMENTS}クリップまで**です(入れすぎると元の話し声とぶつかってうるさくなるため)。
3. sfxPresetId: そのクリップの開始時点で鳴らす効果音。テロップの意味に合うものを選ぶこと
   (例: 問いかけ→はてな、正解・良い結果→成功、残念な事実→残念、場面転換→スワイプ/切り替え、
   順位や項目の発表→決定/ポップ、衝撃の事実→グリッチ)。候補:
${sfxPresetHints}
   付けない場合はnullにしてください。架空のidは絶対に使わないこと。

## あなたが決めてはいけないこと(必ず守ること)
- クリップの並び替え・トリミング・削除・分割は一切行わない
- テロップの文言は書き換えない
- BGMは提案しない(選択肢が用意されていないため)

${themeSection}

summaryには、どこをフックにし、どこで山を作ったか(なぜこの構成にしたか)を日本語1〜2文で書いてください。

JSON以外の文字列は出力しないでください。
`.trim();
};

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    segments: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          segmentIndex: { type: Type.INTEGER, description: "クリップ一覧のindex(0始まり)" },
          captionAnimation: {
            type: Type.STRING,
            format: "enum",
            enum: CAPTION_ANIMATION_VALUES,
            nullable: true,
            description: "このクリップだけ演出を上書きする場合のみ指定",
          },
          addNarration: { type: Type.BOOLEAN },
          sfxPresetId: {
            type: Type.STRING,
            format: "enum",
            enum: SFX_PRESET_IDS,
            nullable: true,
          },
        },
        required: ["segmentIndex", "addNarration", "sfxPresetId"],
      },
    },
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
    summary: { type: Type.STRING },
  },
  required: ["segments", "summary"],
} as const;

/**
 * 文字起こし済みのクリップ一覧から、自動編集(演出上書き・AIナレーション追加・効果音配置)の
 * 提案を生成する。コスト抑制のため、ユーザー自身の動画は一切アップロードせず、テロップ文言と
 * 尺(既に手元にある情報)だけをテキストで渡す。登録済みの編集例(editExamplesStore)があれば
 * few-shotとして「良い編集の実例」を先頭に差し込む。
 * フォールバックは持たない(失敗時は呼び出し元でエラー表示し、常にスキップできるようにする)。
 */
export const generateAutoEditPlan = async (input: AutoEditPlanInput): Promise<AutoEditPlan> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEYが未設定です");
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_AUTO_EDIT_MODEL || DEFAULT_MODEL;
  const prompt = buildPrompt(input);

  let fewShotUploadedFileNames: string[] = [];
  try {
    const fewShot = await loadEditFewShotContext(ai);
    fewShotUploadedFileNames = fewShot.uploadedFileNames;
    const contents: Content[] = [...fewShot.contents, { role: "user", parts: [{ text: prompt }] }];

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await runWithGeminiRateLimit(() => {
          const generatePromise = ai.models.generateContent({
            model,
            contents,
            config: {
              responseMimeType: "application/json",
              responseSchema,
              // 添付するのは編集例の動画(最大6本)だけで、読み取りたいのは効果音やテロップ演出の
              // タイミング・テンポであり細部の画質ではない。低解像度にすると動画のトークン数が
              // 約1/3になり、Proモデルでも1回あたりのコストを抑えられる。
              mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
            },
          });
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("Gemini API timeout")), GEMINI_TIMEOUT_MS);
          });
          return Promise.race([generatePromise, timeoutPromise]);
        });

        // プリペイド(800円)で運用しているため、Proモデル+動画few-shotの1回あたりの消費量を
        // サーバーログで追えるようにしておく(残高切れの前に重さに気づけるように)。
        const usage = response.usageMetadata;
        console.info(
          `[autoEditPlan] model=${response.modelVersion ?? model} 入力${usage?.promptTokenCount ?? "?"}トークン` +
            ` 出力${usage?.candidatesTokenCount ?? "?"}トークン 思考${usage?.thoughtsTokenCount ?? "?"}トークン`
        );

        const text = response.text;
        if (!text) {
          throw new Error("Gemini APIから空の応答が返されました");
        }

        const parsed = autoEditPlanSchema.safeParse(JSON.parse(text));
        if (!parsed.success) {
          throw new Error(`Gemini応答のスキーマ検証に失敗: ${parsed.error.message}`);
        }

        // segmentIndexは実在するクリップの範囲に限る。1件のズレで全体を失敗させない。
        const segments: AutoEditSegmentPlan[] = [];
        for (const s of parsed.data.segments) {
          const segment = input.segments[s.segmentIndex];
          if (!segment) continue;
          segments.push({
            key: segment.key,
            captionAnimation: (s.captionAnimation ?? undefined) as CaptionAnimation | undefined,
            addNarration: s.addNarration,
            sfxPresetId: s.sfxPresetId,
          });
        }

        return {
          segments,
          theme: input.hasStyleReference ? undefined : (parsed.data.theme as AutoEditPlan["theme"]),
          summary: parsed.data.summary,
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
    for (const name of fewShotUploadedFileNames) {
      await ai.files.delete({ name }).catch(() => {});
    }
  }
};
