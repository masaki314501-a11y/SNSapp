import { GoogleGenAI, type Part } from "@google/genai";
import {
  CAPTION_ANIMATION_OPTIONS,
  CAPTION_FONT_FAMILY_OPTIONS,
  CAPTION_STYLE_OPTIONS,
} from "@video/shared/schema";
import { SFX_PRESETS } from "@/components/editor/audioPresets";
import { runWithGeminiRateLimit } from "./rateLimiter";
import { isRetryableApiError, toFriendlyGeminiError } from "./geminiErrors";
import { autoEditResponseSchema, rawAutoEditPlanSchema, type RawAutoEditPlan } from "./autoEditTypes";
import {
  editExampleMediaPath,
  updateEditExampleBreakdown,
  uploadExampleVideo,
  type EditExample,
} from "./editExamplesStore";

/**
 * 学習データ(学習動画=素材、正解動画=プロの完成版)の正解動画を、自動編集と同じJSONの形に
 * 「書き起こす」。自動編集のお手本として、動画を見比べさせるだけでなく「この素材ならこう答える」
 * という答えの実例を見せるため(editExamplesStore.tsのloadEditFewShotContext参照)。
 * 以前は2本の動画を低解像度で見せて「差を読み取って」と頼むだけで、文字の位置・色・大きさや
 * 寄りの倍率のような数値まで落とし込めず、自動編集の結果が正解動画に近づかなかった。
 * 書き起こしは学習データ1件につき1回だけ作って保存する(毎回作ると時間とお金がかかるため)。
 * 細部の読み取りが肝なので自動編集と同じProモデルを使い、正解動画は既定の解像度で見せる。
 */
const DEFAULT_MODEL = "gemini-pro-latest";
const GEMINI_TIMEOUT_MS = 420_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 8_000;

const hints = (options: { value: string; label: string }[]): string =>
  options.map((o) => `- ${o.value}: ${o.label}`).join("\n");

const buildPrompt = (example: EditExample): string =>
  `
最初の動画は編集前の素材(学習動画)、2本目はプロがその素材を編集した完成版(正解動画)です
(タイトル: ${example.label}${example.notes ? ` / メモ: ${example.notes}` : ""})。
正解動画の編集を、素材に対する「編集の指示書」としてJSONに正確に書き起こしてください。
これは別の動画を自動編集するときに、この編集者の癖をそのまま真似するためのお手本になります。
推測で盛ったり省いたりせず、正解動画で実際に起きていることだけを、できるだけ細かく正確に書いてください。

## 書き起こし方(画面は縦1920×横1080として測る)
- clips: 正解動画を、場面が切り替わる所(カット)ごとに区切り、再生順に並べる。各クリップが素材のどこから
  どこまでを使っているかを、素材(1本目)上の秒数でsourceStartSeconds/sourceEndSecondsに書く。
  素材の間・言い淀みが切られている所は、その分だけクリップを分ける。
- speech: そのクリップで話している言葉。改行は入れない。
- テロップ(話している言葉を出す字幕)について:
  - theme.captionPosition: テロップの位置(top=上部 / middle=中央 / bottom=下部)
  - theme.captionStyle: テロップの背景の付き方。候補:
${hints(CAPTION_STYLE_OPTIONS)}
  - theme.fontFamily: 一番近いフォントの系統。候補:
${hints(CAPTION_FONT_FAMILY_OPTIONS)}
  - theme.primaryColor: テロップの差し色(#RRGGBB)
  - captionAnimation: テロップの出方。候補:
${hints(CAPTION_ANIMATION_OPTIONS)}
  - emphasisWords / emphasisColor: テロップの中で色や大きさを変えている語と、その色(#RRGGBB)。
  使われていない場合(テロップが無い等)の候補も、正解動画に一番近いものを選ぶ。
- overlays: テロップとは別に、そのクリップの間だけ画面に出ている文字(強調・ツッコミ・見出し・数字・ラベル)。
  文言は画面の通りに書き、改行も画面の通り「\\n」で書く。xPercent/yPercentは文字の中心の位置(0〜100)、
  fontSizePxは横1080pxの画面での文字の高さ、color/strokeColor(縁取り)/backgroundColor(帯)は#RRGGBB、
  rotationDegは傾き、startOffsetSeconds/durationInSecondsはクリップ先頭からの表示タイミング。animationは候補から選ぶ。
  文字の周りが光っている(にじんでいる)ならglowColor、斜体ならitalic、縁取りの見える太さはstrokeWidthPx(px)、テロップと書体が違うならfontFamily(候補はtheme.fontFamilyと同じ)。
  色・縁取り・光は文字ごとに違うことが多いので、1つずつ画面の通りに書く。
  途中で出てから動画の最後まで残り続ける文字(ランキングの空枠に、発表のたびに入っていく項目名など)は、
  出始めたクリップのoverlaysに書いてkeepUntilEnd=trueにする(それ以外はnull)。最後まで残る物を書き漏らさないこと。
  クリップをまたいで出続ける文字(今話している項目名のラベルなど)は、出始めたクリップに書き、
  durationInSecondsに出ている長さ(秒)を書く(クリップより長くてよい)。同じ文字をクリップごとに書き直さない。
- images: 素材に無い画像(写真・図・イラスト)が重なっていれば、出始めたクリップに書く。imageNumberはnull、
  descriptionに何の画像かを具体的に書く(例: 「八重歯の口元のアップ写真」)。xPercent/yPercentは画像の中心、
  widthPercentは画面幅に対する画像の幅、cornerRadiusPxは角の丸み、startOffsetSecondsはクリップ先頭からの秒、
  durationInSecondsは出ている長さ(クリップより長くてよい)。最後まで残る画像(ランキングの枠に入った写真など)は
  keepUntilEnd=true。画像が大きく出てから小さくなって別の場所(枠など)へ移る場合は、別々の2つの画像として書く。
- framing: 正解動画の映像が素材より寄っていて、人物が片側に寄せられているなら、全体の寄せ方。scaleは素材に対する倍率、
  focusXPercent/focusYPercentは拡大の中心(その点は動かず、ほかは点から離れる方向へ広がる)。素材の背景の物(額・ハンガー等)が
  正解動画のどこに映っているかから計算する。寄せていなければnull。
- globalShapes: ずっと出ている図形(ランキングの空の枠・箱・帯など)。位置は中心、widthPercent/heightPercentは画面に対する幅・高さ、
  borderColor/borderWidthPx(横1080pxの画面での線の太さ)/fillColor/fillOpacity/cornerRadiusPxを測って書く。
- globalOverlays: 動画の最初からずっと出ている文字(上部のタイトル帯、ランキングの空枠の「1位」〜など)。秒数は動画の先頭から、最後まで出ているならdurationInSecondsはnull。
- zoom: 素材より画面が寄っているクリップだけ。scaleは素材に対する倍率、punch=切り替わった瞬間から寄っている /
  slow=クリップの中でゆっくり寄っていく、focusXPercent/focusYPercentは寄っている中心。寄っていなければnull。
- sfx: 効果音が鳴っている所。一番近いものを候補から選び、offsetSecondsはクリップ先頭からの秒。候補:
${hints(SFX_PRESETS.map((p) => ({ value: p.id, label: p.label })))}
- narration: 素材に無い声(ナレーション・読み上げ)が足されていれば、その文。無ければnull。
- hook: 冒頭で大きく出している見出しがあれば。無ければnull。
- cta: 最後に出している締めの一言(「保存してね」等)があれば。無ければnull。
- referenceNotes: この編集者の癖を日本語2〜3文で(何をどのくらいの頻度で入れているか、見た目の特徴)。
- summary: どこを切り、何をフックにし、どこで山を作っているかを日本語1〜2文で。

JSON以外の文字列は出力しないでください。
`.trim();

/** 学習データ1件の正解動画を書き起こし、保存して返す。学習動画(素材)が無い学習データは対象外(null)。 */
export const breakdownEditExample = async (example: EditExample): Promise<EditExample | null> => {
  const rawPath = editExampleMediaPath(example, "raw");
  if (!rawPath || !example.rawMimeType) return null;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEYが未設定です");

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_AUTO_EDIT_MODEL || DEFAULT_MODEL;
  const uploadedFileNames: string[] = [];
  try {
    const parts: Part[] = [
      { text: "【学習動画(編集前の素材)】" },
      await uploadExampleVideo(ai, rawPath, example.rawMimeType, uploadedFileNames),
      { text: "【正解動画(プロが編集した完成版)】" },
      await uploadExampleVideo(
        ai,
        editExampleMediaPath(example, "correct")!,
        example.correctMimeType,
        uploadedFileNames,
        "detailed"
      ),
      { text: buildPrompt(example) },
    ];

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await runWithGeminiRateLimit(() =>
          Promise.race([
            ai.models.generateContent({
              model,
              contents: [{ role: "user", parts }],
              config: { responseMimeType: "application/json", responseSchema: autoEditResponseSchema },
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("Gemini API timeout")), GEMINI_TIMEOUT_MS)
            ),
          ])
        );
        const parsed = rawAutoEditPlanSchema.safeParse(JSON.parse(response.text ?? "{}"));
        if (!parsed.success) throw new Error(`書き起こしのスキーマ検証に失敗: ${parsed.error.message}`);
        if (parsed.data.clips.length === 0) throw new Error("書き起こしにクリップがありませんでした");
        return updateEditExampleBreakdown(example.id, parsed.data satisfies RawAutoEditPlan);
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
  } finally {
    for (const name of uploadedFileNames) {
      await ai.files.delete({ name }).catch(() => {});
    }
  }
};

/**
 * 書き起こしがまだ無い学習データの分を作り、作れたものに差し替えた一覧を返す。自動編集の直前に
 * 呼ぶので、一度作れば次からは待たない。作るのに失敗しても自動編集は止めず、その学習データは
 * 従来どおり動画を見せるだけにする。
 */
export const ensureEditExampleBreakdowns = async (examples: EditExample[]): Promise<EditExample[]> => {
  const result: EditExample[] = [];
  for (const example of examples) {
    if (example.breakdown || !example.rawMediaFilename) {
      result.push(example);
      continue;
    }
    try {
      console.info(`[editExampleBreakdown] 学習データ「${example.label}」の正解動画を書き起こします`);
      result.push((await breakdownEditExample(example)) ?? example);
    } catch (error) {
      console.warn(`[editExampleBreakdown] 学習データ「${example.label}」の書き起こしに失敗しました`, error);
      result.push(example);
    }
  }
  return result;
};
