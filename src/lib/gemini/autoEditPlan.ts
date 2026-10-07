import { GoogleGenAI, PartMediaResolutionLevel, type Content, type Part } from "@google/genai";
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
import { selectEditExamples } from "./editExampleSelection";
import { ensureEditExampleBreakdowns } from "./editExampleBreakdown";
import { autoEditResponseSchema, rawAutoEditPlanSchema, type RawAutoEditClip } from "./autoEditTypes";
import type { EditTemplate } from "@/lib/editTemplates";

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

/** 1クリップ・動画全体に置ける強調テキストの数。描画側のスキーマ(remotionのschema.ts)の上限に合わせる。 */
const MAX_CLIP_OVERLAYS = 20;
/** 自動編集で寄る倍率の上限。 */
const MAX_AUTO_ZOOM_SCALE = 1.35;
const MAX_GLOBAL_OVERLAYS = 12;

export type AutoEditPlanInput = {
  video: { absolutePath: string; mimeType: string; durationInSeconds: number };
  /** カット画面で残した範囲(再生順)。Geminiはこの範囲の中からだけ切り出してよい。 */
  keepRanges: { startFromSeconds: number; durationInSeconds: number }[];
  /** スタイル抽出画面で渡した参考スクショ/動画(複数可)。自動編集の最優先の手本。 */
  styleReferences: { absolutePath: string; mimeType: string; kind: "image" | "video" }[];
  /** 自動編集の画面で選んだテンプレート(よく見るバズ編集の型)。nullならおまかせ。 */
  template: EditTemplate | null;
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

const CAPTION_POSITION_VALUES = CAPTION_POSITION_OPTIONS.map((option) => option.value);

const captionAnimationHints = CAPTION_ANIMATION_OPTIONS.map((o) => `- ${o.value}: ${o.label}`).join("\n");
const fontFamilyHints = CAPTION_FONT_FAMILY_OPTIONS.map((o) => `- ${o.value}: ${o.label}`).join("\n");
const captionStyleHints = CAPTION_STYLE_OPTIONS.map((o) => `- ${o.value}: ${o.label}`).join("\n");
const sfxPresetHints = SFX_PRESETS.map((p) => `- ${p.id}: ${p.label}`).join("\n");

const formatSeconds = (seconds: number): string => seconds.toFixed(2);

const buildPrompt = (input: AutoEditPlanInput, hasExamples: boolean): string => {
  const referenceCount = input.styleReferences.length;
  const keepRangesList = input.keepRanges
    .map(
      (range, i) =>
        `${i + 1}. ${formatSeconds(range.startFromSeconds)}秒〜${formatSeconds(range.startFromSeconds + range.durationInSeconds)}秒`
    )
    .join("\n");

  // 手本の優先順位は「参考スクショ > テンプレート > 編集例」。参考スクショは本人が「この感じにしたい」と
  // 具体的に渡したものなので最優先、テンプレートは本人が選んだ型なので、一般的な編集例よりは優先する。
  const priorityLines = [
    referenceCount > 1
      ? `1. 【最優先・絶対】最初に添付した参考スクショ/参考動画(${referenceCount}個)の「編集の感じ」(テロップや強調テキストの色・縁取り・帯・大きさ・位置・フォントの系統、画面の賑やかさ、寄りの多さ)を忠実に再現すること。複数あるので、1つだけに出てくる物より、複数に共通して出てくる癖を優先する。他の手本と食い違ったら必ずこちらを優先する。`
      : referenceCount === 1
        ? "1. 【最優先・絶対】最初に添付した参考スクショ/参考動画の「編集の感じ」(テロップや強調テキストの色・縁取り・帯・大きさ・位置・フォントの系統、画面の賑やかさ、寄りの多さ)を忠実に再現すること。他の手本と食い違ったら必ずこちらを優先する。"
        : "1. 参考スクショは今回ありません。",
    input.template
      ? `2. 本人が選んだテンプレート「${input.template.label}」の型(下の「テンプレート」の節)に沿って編集すること。${
          referenceCount > 0 ? "参考スクショと食い違う所は参考スクショを優先する。" : "参考スクショが無いので、これを一番の手本にする。"
        }`
      : "2. テンプレートは選ばれていません(おまかせ)。",
    hasExamples
      ? "3. 次に添付した編集例(学習動画=編集前、正解動画=編集後、正解動画の書き起こしJSON)から、編集者がどこを切り、どこで寄り、どんな文字や効果音を足したかの癖を学び、手本にすること。書き起こしがある編集例は、文字の位置・色・大きさ・量、寄りの倍率、効果音の付け方の数値までそのまま真似してよい。本人の動画で「必要な所」を判断するときも、この編集者が正解動画で入れている所(同じような場面)を基準にする。"
      : "3. 編集例は今回ありません。",
    "4. 最後に添付した動画が、今回あなたが編集する本人の動画です。",
  ].join("\n");

  const templateSection = input.template
    ? `
## テンプレート「${input.template.label}」(${input.template.description})
数値は目安。本人の動画の中身に合わせて変えてよいが、この型の見た目・テンポ・配置の雰囲気は必ず守る。
ここに書いてある演出も「入れるならこう見せる」という指示で、入れる場所は上の決まりどおり必要な所だけにする。
参考スクショが無い場合、下の手順①の「参考スクショから読み取る物」は、このテンプレートの指示から作る。
${input.template.instructions}
`
    : "";

  return `
あなたはTikTok・Instagramリール・YouTubeショートで数百万再生を連発している、ショート動画(9:16)の
編集者です。今回は編集の判断をすべてあなたに任せます。目指すのは、見ている人が編集を意識せずに
最後まで見てしまう「違和感が無いのにバズる」編集です。派手さより自然さを優先し、必要な所にだけしっかり手を入れてください。

## 一番大事な決まり: 必要だと思った箇所だけ編集する
- 文字・強調・効果音・寄り・ナレーション・タイトルなど、足す演出はすべて「ここに入れると見ている人にとって
  良くなる理由」(伝わりやすくなる・驚きや笑いが強まる・話の区切りがわかる・続きを見たくなる)がある所にだけ入れる。
- 理由を言えない演出は入れない。「間が空いたから」「数をそろえたいから」「他のクリップに入っているから」は理由にならない。
- 何も足さないクリップがあってよい(むしろ多くて当然)。空の配列やnullは失敗ではない。
- 手本(参考スクショ・テンプレート・編集例)からは「入れるならどんな見た目・位置にするか」を学ぶ。
  手本が賑やかでも、入れる場所は本人の動画の中身を見て必要な所だけにする。

## 手本の優先順位
${priorityLines}

${templateSection}
## 本人の動画について
- 動画全体の長さ: ${formatSeconds(input.video.durationInSeconds)}秒
- 本人がカット画面で「使う」と決めた範囲(再生順)。**クリップはこの範囲の中からだけ切り出すこと**:
${keepRangesList}

## 編集の手順(必ずこの順に、前の手順の結果を土台にして進める)
値はすべて自由。候補が書いてあるものだけは候補から選ぶ。

### 手順① カットと、参考スクショの「物」の読み込み
1. referenceNotes: まず参考スクショ/動画を見て、画面のどこに何が置いてあるか(左上のロゴ・右上の数字・
   上部のタイトル帯・角のアイコンや画像など)と、編集の癖を日本語1〜2文で書く(参考が無ければnull)。
2. clips: 完成動画に使う区間を再生順に並べる。元動画上の秒数(sourceStartSeconds〜sourceEndSeconds)で指定する。
   - 間・言い淀み(「えーっと」「あの」)・言い直し・無音・話がだれる部分は容赦なく切って詰める
   - 1クリップはおおむね1〜4秒(話のひと区切り)。長く話し続ける所も区切ってテンポを出す
   - 範囲の順番は入れ替えてよい(冒頭に一番強い一言を持ってくる等)。ただし同じ区間を二度使わない
   - クリップ数は最大${MAX_CLIPS}個
3. globalOverlays: 1で読み取った「ずっと画面に置いてある物」のうち、この動画にも必要な物を、同じ位置(左上なら左上)・
   同じ見た目で再現する(最大${MAX_GLOBAL_OVERLAYS}個)。参考スクショの上部に「〇〇vs〇〇 どっちがいい?」のような
   テーマのタイトルが常に出ているなら、この動画の内容に合わせたタイトルを作る。何の動画か映像だけで十分わかるなら無くてよい。1行ごとに別要素にして色を変えてもよい。画像やアイコンは用意できないので、
   近い絵文字や短い文字で置き換える。項目はoverlaysと同じ(秒数は動画全体の先頭から。durationInSecondsをnullにすると最後まで表示)。
4. overlays(物): 参考スクショで一時的に出ている物(矢印・ラベル・アイコン等)は、本人の動画にも同じ役割の場面がある
   クリップにだけ、同じ位置で置く。
   文言・位置(xPercent/yPercent、文字の中心)・大きさ(fontSizePx、20〜220)・色・縁取り色・帯の色・傾き(rotationDeg)・
   出すタイミング(クリップ先頭からの秒)はすべて自由。animationは候補から選ぶ:
${captionAnimationHints}

### 手順② テロップ
5. speech: そのクリップで本人が話している言葉をそのまま書き起こす(テロップになる)。
6. theme: テロップの見た目。全体の差し色(primaryColor、#RRGGBB)・フォント・テロップの位置・背景の付き方。参考スクショに合わせる。
   手順①で置いた物と重ならない位置を選ぶ。
   fontFamily候補:
${fontFamilyHints}
   captionPosition候補: ${CAPTION_POSITION_VALUES.join(" / ")}
   captionStyle候補:
${captionStyleHints}
7. captionAnimation: テロップの出現演出(候補は4と同じ)。

### 手順③ テロップの強調
8. emphasisWords / emphasisColor: テロップの中で色を変えて大きく見せる単語と、その色(#RRGGBB)。
   話の要になる数字・結論・キーワードがあるクリップだけ。1クリップ1〜2語まで、無ければ付けない。
   emphasisWordsはspeechの中に実際に出てくる語にすること。
9. overlays(強調): テロップとは別に画面へ出す強調テキスト(「実は3倍!」「ここ重要」「え?」など)。テロップだけでは
   伝わり切らない数字・結論・ツッコミ・問いかけがある所にだけ、手順①の物に足す。同じ時間に出すのは1〜2個まで。
   項目は4と同じ。参考スクショに似た見た目にし、顔や手順①の物・テロップを隠さない位置に置く。

### 手順④ カメラアングル(違和感が出ないことを最優先。迷ったら寄らない)
10. zoom: 手順①〜③で決めた山場(強調した数字・結論・オチ)だけで画面を寄せる。見ている人が「カメラが動いた」と
    意識しないくらいが正解で、寄りすぎ・寄り過多は素人っぽく見えて離脱の原因になる。
    - scaleは1.1〜1.3。1.35を超えない(画質が荒れて顔が切れる)
    - styleはpunch(切り替わった瞬間に寄った絵になる)かslow(クリップ全体でゆっくり寄る)。話の区切り目・
      強い一言の頭はpunch、語りや気持ちが動く所はslow
    - 同じ話が続いているのに、隣のクリップ同士で 寄る→寄らない→寄る と細かく行き来させない。
      寄りを切り替えるのは話題・文の区切り目だけにする。続けて寄るなら倍率と中心をそろえて、同じ構図を保つ
    - focusXPercent/focusYPercentは本人の顔(目のあたり)か手元。顔の位置からずらさず、隣のクリップと中心を大きく変えない
    - 1秒未満の短いクリップには入れない
    - 寄ると画面の端が切れるので、手順①の物やテロップが見えなくならない寄せ方にする

### 仕上げ(①〜④が終わってから)
11. sfx: そのクリップで鳴らす効果音(offsetSecondsはクリップ先頭からの秒)。強調テキストが出る瞬間・話の切り替わり・
    オチなど、音があると気持ちよく伝わる所だけ。意味の無い所では鳴らさない。意味に合うものを選ぶ
    (問いかけ→はてな、良い結果→成功、残念な事実→残念、場面転換→スワイプ/切り替え、発表→決定/ポップ、衝撃→グリッチ)。候補:
${sfxPresetHints}
12. narration: 本人の声とは別にAIナレーションで足す一言。本人の話だけでは足りない説明・ツッコミ・フックの後押しが
    必要な所だけ。数の上限は無いが、必要が無ければ1つも入れなくてよい
    (本人の話し声は編集画面で消せるので、話している所に重ねてもよい)。不要ならnull。
13. hook: 冒頭0〜3秒に本人の映像の上へ重ねる大見出し(スクロールを止める一言。数字・意外性)。subline(補足)は任意。
    冒頭の本人の一言だけで十分に引きがあるならnullでよい。
14. cta: 最後の数秒に重ねる一言(「保存して見返してね」など)。不要ならnull。
15. summary: どこを切ってどこをフックにし、どこで山を作ったかを日本語1〜2文で書く。

## 画面の配置(重なると読めなくなるので必ず守る)
- globalOverlays(ずっと出すタイトル): 画面上部(yPercentが8〜25あたり)
- hook: 冒頭3秒だけ画面中央に大きく出る
- テロップ: themeのcaptionPositionの位置(top=上部 / middle=中央 / bottom=下部)
- cta: 最後の5秒、画面下から2割あたりに出る
- overlays: 上の要素と同じ時間に同じ場所へ置かない。顔も隠さない
- overlaysはテロップ(speech)と同じ文言をそのまま繰り返さず、短い見出し・ツッコミ・数字にする

## 文字の改行(変な所で改行されると読みにくいので必ず守る)
- speechには改行を入れない(画面の幅に合わせて自動で折り返す)
- overlays・globalOverlays・hook・ctaは、なるべく1行(全角10文字以内)に収まる短い言葉にする
- 2行にする時だけ「\\n」で改行し、改行は必ず意味の切れ目(文節・助詞の後)に入れる。
  単語の途中・数字と単位の間(「3/倍」)・1〜2文字だけの行は作らない
  (良い例:「知らないと\\n損する話」 悪い例:「知らないと損す\\nる話」「最\\n強」)

## 量について(違和感のなさが最優先)
- 量の目標は無い。演出の数は、動画の中で「必要だと思った箇所」の数で自然に決まる
- 寄りは多くてもクリップの3割を超えない(これ以上は必要な場合でも違和感が勝つ)。
  ただし編集例の書き起こしがある場合は、その編集者が似た場面で寄っている頻度に合わせてよい
- 寄り・文字・効果音を同じ瞬間に全部重ねるのは、冒頭のフックと一番の山場だけにする

## 設計の考え方
- 冒頭0〜2秒で視聴者を掴む(必要ならhook+寄り+効果音+強調テキストを重ねてよい)
- テンポはまず、間や言い淀みを詰めたカットで作る。演出で無理に変化を足さない
- ランキングの順位・数字・比較の結果・オチ・結論で山を作る
- 最後は保存・シェアしたくなる締めにする

JSON以外の文字列は出力しないでください。
`.trim();
};

/**
 * Geminiが文字に入れた改行を整える。言葉の途中や1〜2文字だけの行で改行してくることがあり、
 * 画面で変な所で改行されて読みにくかったため、短すぎる行は前の行(先頭なら次の行)にくっつけ、
 * 空行は消す。改行の位置は描画側でも文節の切れ目で折り返すので、ここでは明らかに変なものだけ直す。
 */
const MIN_LINE_CHARS = 3;
const tidyLineBreaks = (text: string): string => {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const merged: string[] = [];
  for (const line of lines) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && (Array.from(line).length < MIN_LINE_CHARS || Array.from(previous).length < MIN_LINE_CHARS)) {
      merged[merged.length - 1] = previous + line;
    } else {
      merged.push(line);
    }
  }
  return merged.join("\n");
};

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
    const text = tidyLineBreaks(raw.text);
    if (!text) continue;
    const startOffsetSeconds = clamp(raw.startOffsetSeconds ?? 0, 0, Math.max(0, clipDuration - 0.2));
    const parsed = textOverlaySchema.safeParse({
      text,
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
    // 寄りすぎると画質が荒れて顔が切れ、違和感が強いので、プロンプトの指示に加えてここでも抑える。
    // (編集画面で手で直す分は従来どおり2倍まで選べる)
    scale: clamp(clip.zoom.scale, 1, MAX_AUTO_ZOOM_SCALE),
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
 * 手本の優先順位は「参考スクショ > 選んだテンプレート > 編集例 > 一般的なバズ動画の定石」。
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

    // 1. 参考スクショ/動画(最優先の手本、複数可)。スクショは縁取りの太さなど細部まで読めるよう高解像度で渡す。
    if (input.styleReferences.length > 0) {
      const referenceParts: Part[] = [
        {
          text:
            input.styleReferences.length > 1
              ? `【手本1・最優先】参考スクショ/参考動画(${input.styleReferences.length}個)。共通する編集の感じを最優先で再現してください。`
              : "【手本1・最優先】参考スクショ/参考動画。この投稿者の編集の感じを最優先で再現してください。",
        },
      ];
      for (const [index, reference] of input.styleReferences.entries()) {
        if (input.styleReferences.length > 1) referenceParts.push({ text: `参考${index + 1}:` });
        referenceParts.push(
          reference.kind === "image"
            ? {
                inlineData: {
                  mimeType: reference.mimeType,
                  data: (await readFile(reference.absolutePath)).toString("base64"),
                },
                mediaResolution: { level: PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH },
              }
            : await uploadFileAsPart(ai, reference.absolutePath, reference.mimeType, uploadedFileNames)
        );
      }
      contents.push({ role: "user", parts: referenceParts });
    }

    // 本人の動画は、手本選び(2)と編集の依頼(3)の両方で使うので先に1回だけアップロードする。
    const videoPart = await uploadFileAsPart(ai, input.video.absolutePath, input.video.mimeType, uploadedFileNames);

    // 2. 編集例(学習動画+正解動画のペア)。今回の動画に近いものを選んで見せる(editExampleSelection.ts)。
    // 書き起こし(正解動画を答えの形に起こしたもの)がまだ無い学習データは、ここで一度だけ作る(editExampleBreakdown.ts)。
    const examples = await ensureEditExampleBreakdowns(await selectEditExamples(ai, videoPart));
    const fewShot = await loadEditFewShotContext(ai, examples);
    uploadedFileNames.push(...fewShot.uploadedFileNames);
    contents.push(...fewShot.contents);

    // 3. 本人の動画+依頼文。
    const prompt = buildPrompt(input, fewShot.contents.length > 0);
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
            config: { responseMimeType: "application/json", responseSchema: autoEditResponseSchema },
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
        for (const raw of parsed.data.clips) {
          if (clips.length >= MAX_CLIPS) break;
          const fitted = fitClipToKeepRanges(raw, input.keepRanges);
          if (!fitted) continue;
          const narration = raw.narration?.trim() || null;
          const emphasisWords = (raw.emphasisWords ?? []).map((w) => w.trim()).filter((w) => w.length > 0);
          clips.push({
            ...fitted,
            // テロップは描画側で文節の切れ目で折り返すので、Geminiが入れた改行は外す。
            speechText: raw.speech?.replace(/\s*\n\s*/g, "").trim() ?? "",
            captionAnimation: (raw.captionAnimation ?? undefined) as CaptionAnimation | undefined,
            emphasisWords: emphasisWords.length > 0 ? emphasisWords : undefined,
            emphasisColor: hexOrUndefined(raw.emphasisColor),
            zoom: normalizeZoom(raw),
            overlays: normalizeOverlays(raw.overlays, fitted.durationInSeconds, MAX_CLIP_OVERLAYS),
            sfx: (raw.sfx ?? []).map((s) => ({
              presetId: s.presetId,
              offsetSeconds: clamp(s.offsetSeconds ?? 0, 0, Math.max(0, fitted.durationInSeconds - 0.1)),
            })),
            narration,
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
          hook: parsed.data.hook && tidyLineBreaks(parsed.data.hook.headline)
            ? {
                headline: tidyLineBreaks(parsed.data.hook.headline),
                subline: parsed.data.hook.subline ? tidyLineBreaks(parsed.data.hook.subline) || undefined : undefined,
              }
            : null,
          cta: parsed.data.cta && tidyLineBreaks(parsed.data.cta.text) ? { text: tidyLineBreaks(parsed.data.cta.text) } : null,
          globalOverlays: normalizeOverlays(
            parsed.data.globalOverlays,
            clips.reduce((sum, clip) => sum + clip.durationInSeconds, 0),
            MAX_GLOBAL_OVERLAYS
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
