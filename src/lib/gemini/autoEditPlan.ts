import { GoogleGenAI, PartMediaResolutionLevel, Type, type Content, type GenerateContentResponse, type Part } from "@google/genai";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import path from "node:path";
import {
  CAPTION_ANIMATION_OPTIONS,
  CAPTION_POSITION_OPTIONS,
  CAPTION_STYLE_OPTIONS,
  CAPTION_FONT_SIZE_SCALE,
  clipZoomSchema,
  faceBoxSchema,
  imageOverlaySchema,
  shapeOverlaySchema,
  textOverlaySchema,
  videoFramingSchema,
  type CaptionAnimation,
  type CaptionFontFamily,
  type CaptionFontSize,
  type CaptionPosition,
  type CaptionStyle,
  type ClipZoom,
  type FaceBox,
  type ImageOverlay,
  type ShapeOverlay,
  type TextOverlay,
  type VideoFraming,
} from "@video/shared/schema";
import { MAX_CLIPS } from "@video/templates/standard/schema";
import { VIDEO_HEIGHT, VIDEO_WIDTH } from "@video/shared/constants";
import { breakIntoLines, estimateOverlayBox, estimateTextWidthPx, type BoxPercent } from "@video/shared/textWrap";
import { SFX_PRESETS } from "@/components/editor/audioPresets";
import { runWithGeminiRateLimit, type GeminiRateLimitLane } from "./rateLimiter";
import { isRetryableApiError, toFriendlyGeminiError } from "./geminiErrors";
import { waitForGeminiFileActive } from "./geminiFiles";
import { loadEditFewShotContext, roundNumbers } from "./editExamplesStore";
import { selectEditExamples } from "./editExampleSelection";
import { ensureEditExampleBreakdowns } from "./editExampleBreakdown";
import { removeCaptionLikeOverlays } from "./captionOverlays";
import {
  autoEditResponseSchema,
  rawAutoEditPlanSchema,
  type RawAutoEditClip,
  type RawAutoEditImage,
  type RawAutoEditPlan,
  type RawAutoEditShape,
} from "./autoEditTypes";
import type { EditTemplate } from "@/lib/editTemplates";
import type { ResolvedMaterialImage } from "@/lib/materialImage";
import { getOrGenerateImage, type GeneratedImageStyle } from "./generateImage";
import { matchLibraryImages } from "./imageLibraryMatch";
import { libraryImageSrc, loadImageLibrary } from "@/lib/imageLibrary";
import { applyCameraRule, cameraRuleForTemplate } from "@/lib/cameraRules";
import type { AutoEditProgress } from "@/lib/autoEditProgress";

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
/**
 * 答えが届き始めてから、次のかけらがこの時間来なければ止まったとみなす。Geminiが途中で止まると、
 * 以前は全体の制限(7分)まで待っていて、2案目まで合わせると10分以上かかることがあった。
 */
const GEMINI_STALL_MS = 90_000;
/**
 * 答えの終わりが、同じ文字のかたまりの繰り返しになっていないか。Geminiが同じ要素(同じ位置の図形など)や同じ文字を
 * 延々と書き続けることがあり、答えの長さの上限に届くまで数分待ってから頼み直していたので、見つけた時点で止める。
 */
const isRepeating = (text: string): boolean => {
  if (text.length < 3000) return false;
  const tail = text.slice(-2400);
  // 40〜400文字のかたまりが、3回以上そのまま続いていれば繰り返しとみなす
  for (let size = 40; size <= 400; size++) {
    const unit = tail.slice(-size);
    if (tail.endsWith(unit.repeat(3)) && unit.trim().length > 20) return true;
  }
  return false;
};

/** 編集案の答えの長さの上限(トークン)。Geminiは考える分(思考、多い時1.3万)もこれに含めるので、余裕を持たせる。 */
const MAX_PLAN_OUTPUT_TOKENS = 32_000;
/** 1案目が使える時の2案目の制限。2案目は良くするための作り直しなので、長くは待たせない。 */
const SECOND_PLAN_TIMEOUT_MS = 240_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 8_000;
const MIN_CLIP_SECONDS = 0.3;
const MAX_CLIP_SECONDS = 30;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** 1クリップ・動画全体に置ける強調テキスト・画像の数。描画側のスキーマ(remotionのschema.ts)の上限に合わせる。 */
const MAX_CLIP_OVERLAYS = 20;
const MAX_CLIP_IMAGES = 20;
const MAX_GLOBAL_IMAGES = 24;
const MAX_GLOBAL_SHAPES = 24;
/** 動画全体の画角の上限。寄せすぎると画質が荒れるので、クリップごとの寄りより少し大きい程度に抑える。 */
const MAX_FRAMING_SCALE = 1.5;
/** 1回の自動編集でAIに作らせる画像の種類の上限(1枚数円〜十円かかるため。ランキング6〜8項目が収まる数)。 */
const MAX_GENERATED_IMAGES = 8;
/** 1回の自動編集で出す、作った画像(棚の画像を含む)の種類の上限。棚の画像は無料なので、作る上限より多くてよい。 */
const MAX_REQUESTED_IMAGES = 16;
/** 冒頭の見出しの候補の数(本人が選ぶ)。 */
const MAX_HOOK_CANDIDATES = 3;
/** 自動編集で寄る倍率の上限。 */
const MAX_AUTO_ZOOM_SCALE = 1.35;
/** ランキングの空枠(6個)と、そこを埋める項目名(6個)、タイトルが同時に置けるだけの数。描画側の上限と合わせる。 */
const MAX_GLOBAL_OVERLAYS = 24;

export type AutoEditPlanInput = {
  video: { absolutePath: string; mimeType: string; durationInSeconds: number };
  /** カット画面で残した範囲(再生順)。Geminiはこの範囲の中からだけ切り出してよい。 */
  keepRanges: { startFromSeconds: number; durationInSeconds: number }[];
  /** スタイル抽出画面で渡した参考スクショ/動画(複数可)。自動編集の最優先の手本。 */
  styleReferences: { absolutePath: string; mimeType: string; kind: "image" | "video" }[];
  /** 自動編集の画面で選んだテンプレート(よく見るバズ編集の型)。nullならおまかせ。 */
  template: EditTemplate | null;
  /** 本人が渡した「使える画像」(症例写真・商品写真など)。番号(1始まり)で指定させて動画に重ねる。 */
  materialImages: ResolvedMaterialImage[];
  /** 使える画像が足りない所に、AIが作った画像(画像の棚・新しく作る画像)を出してよいか(generateImage.ts)。 */
  generateMissingImages: boolean;
  /**
   * 1回の自動編集で新しく作ってよい画像の数(0〜MAX_GENERATED_IMAGES)。1枚約10円かかるため、本人が上限を決める。
   * 0なら棚に貯めた画像だけを使う。上限を超えた分は画像を出さない(ランキングの枠は項目名の文字で埋める)。
   */
  maxGeneratedImages: number;
  /** 本人が決めた、左上に出すタイトル。空ならAIが動画の内容から決める。 */
  title?: string;
  /** 完成動画をこの秒数くらいに収める。nullなら長さはAIにまかせる。 */
  targetDurationSeconds?: number | null;
  /** 今どの段階かを知らせる(画面に進み具合を出すため)。 */
  onProgress?: (progress: AutoEditProgress) => void;
  /**
   * カットの位置(元の動画の秒数)を、近くの音の切れ目へ寄せる(speechActivity.tsのsnapToQuiet)。
   * AIが動画を見て決めた秒数のままだと、言葉の頭や語尾が少し切れることがあったため。音を調べられなかった時は無し。
   */
  snapCut?: (seconds: number) => number;
  /** 本人がAIへの要望として書いた文(「保証は日本の方に〇」等)。手本より優先する。 */
  userRequest?: string;
  /**
   * 手本から外す学習データのid。質の測定(scripts/eval)で、手本の学習動画そのものを編集させる時に、
   * その手本の答えを見せないために使う。
   */
  excludeExampleIds?: string[];
  /**
   * 手直し。前回の案(Geminiの生の答え)と「ここを直して」の指示を渡すと、全部作り直さずに言われた所だけ変える。
   * 作り直すと良かった所まで毎回変わってしまうため。手本はすでに前回の案に反映されているので、手本選び・編集例は省く。
   */
  revision?: { previousPlan: RawAutoEditPlan; instruction: string };
};

export type AutoEditClipPlan = {
  startFromSeconds: number;
  durationInSeconds: number;
  /** この区間で話している内容。編集画面の「字幕を一括生成」で使う下書き。 */
  speechText: string;
  captionAnimation?: CaptionAnimation;
  emphasisWords?: string[];
  emphasisColor?: string;
  captionAccentColor?: string;
  captionFontFamily?: CaptionFontFamily;
  captionGlowColor?: string;
  zoom?: ClipZoom;
  overlays?: TextOverlay[];
  images?: ImageOverlay[];
  /** 顔の位置(元の動画の画面に対する割合)。 */
  faceBox?: FaceBox;
  /** テロップを全体の位置に出すと顔に重なる時の、このクリップだけの位置。 */
  clipCaptionPosition?: CaptionPosition;
  /** 話の山場(順位の発表・結論など)。カメラワークのルールで寄る所。 */
  cameraHighlight?: boolean;
  sfx: { presetId: string; offsetSeconds: number }[];
};

export type AutoEditPlan = {
  summary: string;
  referenceNotes: string | null;
  theme: {
    primaryColor?: string;
    fontFamily?: CaptionFontFamily;
    captionPosition?: CaptionPosition;
    captionStyle?: CaptionStyle;
    captionFontSize?: CaptionFontSize;
  };
  hook: { headline: string; subline?: string } | null;
  /** 冒頭の見出しの候補(AIのおすすめ=hookが先頭。最大3つ)。本人が選ぶ。 */
  hookCandidates: string[];
  cta: { text: string } | null;
  /** 動画全体に重ね続ける文字(上部のタイトル等)。秒数は動画全体の先頭から。 */
  globalOverlays: TextOverlay[];
  /** 動画全体に重ねる画像(ランキングの枠に入れて最後まで残す写真、話題の間ずっと出す写真など)。 */
  globalImages: ImageOverlay[];
  /** 動画全体に重ねる図形(ランキングの空の枠など)。 */
  globalShapes: ShapeOverlay[];
  /** 動画全体の画角。寄せないならnull。 */
  framing: VideoFraming | null;
  /** 話している言葉(speechText)を字幕として出すか。 */
  showCaptions: boolean;
  /** AIが作って動画に使った画像の枚数(種類)。 */
  generatedImageCount: number;
  /** 動画に使った画像(種類)の出どころ。本人の画像・画像の棚(無料)・新しく作った画像(1枚約10円)。 */
  imageSources: { material: number; library: number; generated: number };
  clips: AutoEditClipPlan[];
  /** 丸め込む前のGeminiの答え。手直し(revision)のときに前回の案として渡し直す。 */
  rawPlan: RawAutoEditPlan;
};

const CAPTION_POSITION_VALUES = CAPTION_POSITION_OPTIONS.map((option) => option.value);

const captionAnimationHints = CAPTION_ANIMATION_OPTIONS.map((o) => `- ${o.value}: ${o.label}`).join("\n");
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
      ? `1. 【最優先・絶対】最初に添付した参考スクショ/参考動画(${referenceCount}個)の見た目(テロップや強調テキストの色・縁取り・帯・大きさ・位置・フォントの系統、ずっと置いてある物の配置)を忠実に再現すること(量とタイミングは編集例の書き起こしに合わせる)。複数あるので、1つだけに出てくる物より、複数に共通して出てくる癖を優先する。他の手本と食い違ったら必ずこちらを優先する。`
      : referenceCount === 1
        ? "1. 【最優先・絶対】最初に添付した参考スクショ/参考動画の見た目(テロップや強調テキストの色・縁取り・帯・大きさ・位置・フォントの系統、ずっと置いてある物の配置)を忠実に再現すること(量とタイミングは編集例の書き起こしに合わせる)。見た目が他の手本と食い違ったら必ずこちらを優先する。"
        : "1. 参考スクショは今回ありません。",
    input.template
      ? `2. 本人が選んだテンプレート「${input.template.label}」の型(下の「テンプレート」の節)に沿って編集すること。${
          referenceCount > 0 ? "参考スクショと食い違う所は参考スクショを優先する。" : "参考スクショが無いので、これを一番の手本にする。"
        }`
      : "2. テンプレートは選ばれていません(おまかせ)。",
    hasExamples
      ? "3. 次に添付した編集例(学習動画=編集前、正解動画=編集後、正解動画の書き起こしJSON)から、編集者がどこを切り、どこで寄り、どんな文字や効果音を足したかの癖を学び、手本にすること。書き起こしがある編集例は、文字の位置・色・大きさ・量、寄りの倍率、効果音の付け方の数値までそのまま真似してよい。本人の動画で「必要な所」を判断するときも、この編集者が正解動画で入れている所(同じような場面)を基準にする。ただし編集例は本人とは別の動画なので、真似するのは見た目・量・タイミングだけ。編集例に出てくる文言・タイトル・題材・固有の言葉(国名・商品名・項目名など)は本人の動画に持ち込まない。"
      : "3. 編集例は今回ありません。",
    "4. 最後に添付した動画が、今回あなたが編集する本人の動画です。テロップ・タイトル・強調テキストなど画面に出す言葉は、すべてこの動画で本人が話している内容から作ること。",
  ].join("\n");

  const materialImageCount = input.materialImages.length;
  const canGenerate = input.generateMissingImages;
  const howToShowImages = `   - 本人がその物(症状・商品・場所など)の話を始めたクリップに、顔やテロップと重ならない所へ大きく出す(widthPercent 40〜60)。
     その話の間ずっと出すなら、出し始めるクリップに置いてdurationInSecondsをその話の長さ(秒)にする(クリップより長くてよい)。
   - ランキングの枠をずっと出しているなら、順位が発表されたクリップで同じ画像をもう1つ置き、keepUntilEnd=trueと、
     slotRank(その画像が何位か。発表された順位の数)を必ず書いて枠を画像で埋めていく(位置・大きさは枠に合わせて自動で決まる)。
     発表の順番と順位は違う(2位→3位→5位…と発表されることもある)ので、slotRankは話の中で言われた順位にする。話の間出していた大きい画像は、そこで終わるようにdurationInSecondsを決める。
   - 話の内容に合う画像が無い場面には出さない。同じ画像を関係ない話に使い回さない。
   - 使える画像に治療前後の写真や患者の口元の症例写真があっても、前と後を並べたり「Before」「After」の文字を付けたりしない。
     症例写真は、治療の効果を言い切る言葉と同じ時間に出さない。実在の有名人の名前・写真・似顔絵は、文字でも画像でも出さない。
     編集例に「Before/After」「有名人の写真」があっても、その演出は真似しない。
   位置(xPercent/yPercent、画像の中心)・幅(widthPercent、画面幅に対する割合)・角の丸み(cornerRadiusPx)・出すタイミングは自由。
   枠に入れる画像は、heightPercent(画面の高さに対する割合)も枠と同じにする(枠いっぱいに切り抜いて収まる)。`;
  const materialLine =
    materialImageCount > 0
      ? `本人の動画の直前に添付した「使える画像」(${materialImageCount}枚)は、imageNumberでその番号を指定して使う
   (descriptionには何の画像かを書く。名前の無い画像は、画像を見て何が写っているかを判断する)。`
      : "使える画像は今回ありません。";
  const generateLine = canGenerate
    ? `使える画像に合う物が無いが、画像があると伝わりやすくなる場面(ランキングの各項目、話している物の見た目など)は、
   AIに画像を作らせてよい。imageNumberをnullにし、descriptionに描いてほしい内容を具体的に書き(何を・どの向きから・
   どこが特徴か。文字は入れない前提で。「バニーティース」のような比喩の名前はそのまま書かず、「上の前歯2本が
   ほかの歯より大きく長い口元」のように見た目で書く)、nameにその画像の短い名前を付ける。同じ画像を2回出す(大きく出す→枠に入れる)
   ときは、nameとdescriptionを同じにする。前に作った画像を貯めてあり、同じ物の画像はそれを使う(無料)。
   お金・時計・カレンダー・王冠・トロフィー・メダル・チェック・バツ・注意・電球・グラフ・スマホ・病院・薬・歯・歯ブラシ・
   驚く顔・考える顔などの絵文字のアイコンと、日本・韓国・アメリカ・中国・台湾・イギリス・フランス・ドイツ・イタリア・タイの国旗も
   用意してある(無料)。話の要点を一目で伝えたい所は、こうしたアイコン・国旗で足りるなら、descriptionに「〇〇のアイコン」「〇〇の国旗」と書く。
   新しく作れるのは${input.maxGeneratedImages}種類までで、1枚ごとに料金がかかるので、画像があると本当に伝わりやすくなる場面に絞る。
   画像を作るなら、generatedImageStyleで画風を選ぶ: 歯科医院の動画では、商品・器具も含めて必ずillustration(図解風イラスト)。
   作った画像を本物の症例写真や実在の商品のように見せると誤解を招くため(歯科以外の料理・場所などはphotoでもよい)。
   治療後の口元・治った状態・治療前後の比較の絵は作らない(効果を約束しているように見えるため)。人の顔は作らず、口元か歯だけにする。
   症状の絵は、本人が話した特徴だけを、実際より大げさにせずに描く。血・ひどい虫歯のような怖がらせる絵は作らない。
   画像を作らないならgeneratedImageStyleはnull。`
    : `使える画像が無い場面には画像を出さない(imageNumberをnullにしない)。編集例の書き起こしに画像が出てきても、
   その役割は文字で代わりにする(ランキングの枠は、順位が発表されたクリップで項目名の文字をkeepUntilEnd=trueで置いて埋める)。
   generatedImageStyleはnull。`;
  const imageSection =
    materialImageCount > 0 || canGenerate
      ? `4-2. images(画像): ${materialLine}
   ${generateLine}
${howToShowImages}`
      : `4-2. images(画像): ${materialLine}imagesは空にする。${generateLine}`;

  // 本人が書いた要望は、本人が「こうしたい」と言っている事なので、手本(参考スクショ・テンプレート・編集例)より優先する。
  const userRequest = input.userRequest?.trim();
  const userRequestSection = userRequest
    ? `## 本人からの要望(手本より優先)
本人がこの動画の編集について、次のように書いています。手本と食い違う所は、この要望に従ってください。
ただし「使う範囲の中からだけ切り出す」決まりと、答えのJSONの形は守ってください。
---
${userRequest}
---

`
    : "";

  const keepTotal = input.keepRanges.reduce((sum, range) => sum + range.durationInSeconds, 0);
  const target = input.targetDurationSeconds;
  const lengthLine =
    target && target < keepTotal - 1
      ? `\n- **完成動画の長さは${formatSeconds(target)}秒前後(長くても${formatSeconds(target * 1.1)}秒まで)にする**。使う範囲は合計${formatSeconds(keepTotal)}秒あるので、
  話の要点(フック・順位や結論・オチ)を残し、前置き・繰り返し・脇道の話からクリップごと削って収める。話の途中で切れて意味が通らなくならないようにする。`
      : "";
  const userTitle = input.title?.trim();
  const titleInstruction = userTitle
    ? `本人がタイトルを「${userTitle}」と決めているので、titleにはそのまま書く(言い換えない)。`
    : "この動画が何の話かが一目でわかる短い言葉(全角16文字以内。2行にするなら意味の切れ目に「\\n」を1つ)を、本人の話から作る。治療名・症状名(「マウスピース矯正」「ラミネートベニア」など)を、本人が言った言葉のまま1つ入れる(検索で見つかるように)。聞き手の質問から始まる動画は、その質問を短くしてタイトルにしてよい。参考スクショにタイトルがあっても文言は真似しない。";

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

## 一番大事な決まり: 本人の動画の中身に合わせて編集する
- まず本人の動画を最後まで見て、何の話か・どんな型か(ランキング・比較・採点・手順・割合・Q&Aなど)・どこに
  項目(項目名・順位・数字・判定)・答え合わせ・本音・オチがあるかをつかむ。演出はすべて、この中身から決める。
- どう見せるか(見た目・音・画面の組み立て・雰囲気・テンポ)は、末尾の「編集のクセ帳」の編集者になりきって決める。
  「この編集者なら、この場面をどう見せるか」を考えて編集する。ただし本人の動画に無い場面の演出は入れない
  (手本にあるからという理由だけで入れない)。
- 量は数で決めず、中身で決める。ただし控えめにしすぎない。見ている人が「今何の話か」「大事な言葉は何か」を画面だけで
  分かるように、項目名・キーワード・数字・答えが出るたびに文字で添えるのが自然な編集。説明の部分も、要点の言葉があれば
  短いラベルで添える。字幕だけの画面が長く続く(10秒以上)のは、この編集者らしくない。理由の言えない演出は入れない。
- 演出は2種類に分けて考える。
  (a) 情報を見せる演出(ずっと出す枠・一覧・項目名のラベル・順位・点数・数字・手順の番号)は、歯科の動画では一番の
      離脱防止なので、本人の話に項目があれば最初から最後まで省かずに入れる。
  (b) 気持ちを動かす演出(寄り・ツッコミの文字・傾き)は、感情の山にだけ絞る。リスク・副作用・注意を話している所には、
      笑いの効果音やツッコミを入れない。

## 絶対の決まり(どんな演出・手本よりも優先し、例外なく守る)
- 文字どうし(タイトル・ラベル・見出し・強調テキスト・ずっと出す文字・字幕)を重ねない。
- 字幕(テロップ)を顔に重ねない。字幕を、枠・カード・画像・図形にも重ねない。字幕は必ず出るので、顔の位置(5-2)と、
  ずっと出す枠・カード・画像の位置を見て、どれにも重ならない帯(captionPosition)を選ぶ。枠やカードを字幕の帯に置かない。
- 文字・画像を置く時は、その時間に画面にある物(字幕・顔・ずっと出ている文字・枠)を全部避ける。置ける場所が無い物は入れない
  (サーバー側でも最後に重なりを確かめ、字幕・顔に重なる文字や画像は出さない)。

## 医療広告の決まり(この動画は歯科医院の広告として扱われる。演出・手本・テンプレートより必ず優先する)
あなたが作る文字(title・hook・hookAlternatives・overlays・globalOverlays・cta)には、次の言葉・表現を使わない。
- 誇大・断定: 「絶対」「必ず」「100%」「完全」「確実に治る」「痛くない」「誰でも」「一生もの」「最高」「最強」「究極」「圧倒的」
- 他との比較で優れていると言う: 「No.1」「日本一」「地域一番」「唯一」「他院より」「どこよりも」
- 患者の体験談・感想を治療の効果として見せる言葉(「やってよかった」「人生変わった」など)
- 費用で急がせる言葉: 「激安」「最安」「今だけ」「期間限定」「先着」「半額」「無料で治る」
- 怖さで受診を迫る言葉(「放置すると歯が全部なくなる」など)
本人が話の中で上の言葉を使っていても、字幕(speech)は話したとおりにし、overlays・hook・titleで繰り返したり大きくしたりしない。
言い換えるなら「最強」→「歯科医師の一押し」、「絶対治る」→「改善が期待できる」、「痛くない」→「痛みに配慮した方法」。
数字・割合・期間・回数・「意外な事実」は、本人が動画の中で実際に言ったものだけを使う。言っていない数字は作らない。
本人が費用を話していて金額を文字で出すなら「自由診療」「目安」を添え、金額だけを大きく出さない。
summaryの最後に、気になる表現があれば「要確認: 〇秒『〇〇』」と書き出す。症例写真を使った時は
「症例写真を使用: 治療内容・費用・期間・リスクの説明を投稿文に入れてください」と書く。

${userRequestSection}## 手本の優先順位
${priorityLines}

${templateSection}
## 本人の動画について
- 動画全体の長さ: ${formatSeconds(input.video.durationInSeconds)}秒
- 本人がカット画面で「使う」と決めた範囲(再生順)。**クリップはこの範囲の中からだけ切り出すこと**:
${keepRangesList}${lengthLine}

## 編集の手順(必ずこの順に、前の手順の結果を土台にして進める)
値はすべて自由。候補が書いてあるものだけは候補から選ぶ。
数字はすべて小数点以下1桁まで(「70」「12.5」)で書く。「70.00000001」のような長い小数は書かない。

### 手順① カットと、参考スクショの「物」の読み込み
1. referenceNotes: まず参考スクショ/動画を見て、画面のどこに何が置いてあるか(左上のロゴ・右上の数字・
   上部のタイトル帯・角のアイコンや画像など)と、編集の癖を日本語1〜2文で書く(参考が無ければnull)。
1-2. framing: 動画全体の画角。参考で人物が画面の片側に寄せられ、空いた側に枠・一覧・画像が置いてあるなら、全クリップの映像を
   寄せて同じ構図にする。scale(1.0〜1.5)倍に、focusXPercent/focusYPercentの点を中心に拡大する(その点は動かず、
   ほかは点から離れる方向へ広がる)。人物を右へ寄せたいなら中心を左寄り(focusXPercent 0〜20)、上下は人物の顔が
   画面の上から3〜4割に来るように選ぶ。参考も本人の動画も人物が中央で、空ける必要が無ければnull。
1-3. globalShapes: 参考にずっと出ている図形(ランキングの空の枠・一覧の箱・帯など)を、同じ位置・大きさ・線の太さ・
   角の丸み・色で置く(秒数は動画全体の先頭から。durationInSecondsをnullにすると最後まで)。xPercent/yPercentは図形の中心、
   widthPercentは画面幅に対する幅、heightPercentは画面の高さに対する高さ、borderWidthPxは横1080pxの画面での線の太さ。
   枠の中に後から画像を入れるなら、塗り(fillColor)は付けず線だけにする。比べる物を並べるカード(白い箱に画像と名前)なら、
   白い塗り(fillColor)と薄い線にし、画像(4-2)と名前の文字(3)を同じ位置に重ねる。kindは四角ならrect、丸ならcircle
   (circleはwidthPercentを直径にし、heightPercentは使わない)。無ければ空にする。
2. clips: 完成動画に使う区間を再生順に並べる。元動画上の秒数(sourceStartSeconds〜sourceEndSeconds)で指定する。
   - 間・言い淀み(「えーっと」「あの」)・言い直し・無音・話がだれる部分は容赦なく切って詰める。
     ただし本人がカット画面ですでに切ってあり、間が詰まっているなら、それ以上は切らない(完成動画の長さを変えず、
     クリップは文字・画像・寄りを切り替える区切りとして分けるだけにする。編集例の正解動画もそうなっていれば同じにする)
   - 1クリップはおおむね1〜4秒(話のひと区切り)。長く話し続ける所も区切ってテンポを出す
   - 項目名・順位・数字・判定の言葉を言い始める瞬間で、必ずクリップを切る。その言葉がクリップの先頭に来るようにし、
     その項目のラベル・効果音・画像はそのクリップの先頭(startOffsetSeconds=0 / offsetSeconds=0)に置く。
     言葉より前に出さない(ネタバレになる)。言葉から0.5秒以上遅らせもしない
   - 範囲の順番は入れ替えてよい(冒頭に一番強い一言を持ってくる等)。ただし同じ区間を二度使わない
   - クリップ数は最大${MAX_CLIPS}個
3. title: 画面の左上に最初から最後まで出すタイトル。${titleInstruction}
   位置・大きさ・見た目はサーバー側で決まった形にするので、文言だけ書く。
3-2. globalOverlays: 1で読み取った「ずっと画面に置いてある物」のうち、この動画にも必要な物を、同じ位置(左上なら左上)・
   同じ見た目で再現する(4の「最後まで残す物」と合わせて最大${MAX_GLOBAL_OVERLAYS}個)。ただし動画のテーマを表すタイトルは
   3のtitleに書いたので、globalOverlaysには入れない。画像は4-2の「使える画像」だけ置ける。
   それ以外のアイコンや図は、近い意味の短い文字で置き換える。項目はoverlaysと同じ(秒数は動画全体の先頭から。durationInSecondsをnullにすると最後まで表示)。
   ランキングの「1位」〜の文字は、1-3の枠の中(左下など参考と同じ所)に置く。
4. overlays(物): 参考スクショで一時的に出ている物(矢印・ラベル・アイコン等)は、本人の動画にも同じ役割の場面がある
   クリップにだけ、同じ位置で置く。
   出てから動画の最後まで残る物は、出し始めるクリップに置いてkeepUntilEnd=trueにする(残す以外の物はnull)。
   話題の間ずっと出しておく物(今話している項目名のラベルなど)は、出し始めるクリップに置いてdurationInSecondsを
   その話題の長さ(秒)にする(クリップより長くてよい)。比べる動画で、今どの項目の話か(「価格」「スピード」等)を
   見出しで出しているなら、その項目の話が始まるクリップに置き、durationInSecondsをその項目の話の長さにする。
   冒頭にタイトルを画面中央へ大きく出してから上部へ移しているなら、中央の大きいタイトル(durationInSecondsは出している長さ)と、
   それが消える時刻から出す上部のタイトル(globalOverlays)を、同じ文言で別々に置く(移る動きはサーバー側で付ける)。
4-1. shapes(図形): 参考が、結論の出た所で勝った方・おすすめの方に〇印などの図形を重ねているなら、結論を言ったクリップに置く。
   位置・大きさ・線の太さ・色は参考と同じにし、durationInSecondsは次の項目の話が始まるまでの長さにする(クリップより長くてよい)。
   kind・線の色などの項目は1-3と同じ。結論がはっきりしない項目(どちらとも言えない)には置かない。
   〇をどちらの側に付けるかは、本人の動画で話し手が良いと言った側で決める(手本の〇の位置は真似しない)。
   特にランキングで「1位」〜「〇位」の空の枠をずっと出すなら、順位が発表されたクリップで、その順位の枠を
   keepUntilEnd=trueの物で埋め、発表のたびに埋めていく(使える画像があれば4-2のとおり画像で、無ければ枠の中か
   すぐ横に項目名の文字で)。埋める物には必ずslotRank(何位の枠か)を書く。空の枠を出したまま埋めないのは不可。
   文言・位置(xPercent/yPercent、文字の中心)・大きさ(fontSizePx、20〜220)・色・縁取り色・帯の色・傾き(rotationDeg)・
   出すタイミング(クリップ先頭からの秒)はすべて自由。参考の見た目を細かく再現するため、文字ごとに光(glowColor、
   文字の周りのにじみ)・斜体(italic)・縁取りの見える太さ(strokeWidthPx、横1080pxの画面でのpx。省略すると文字の大きさの約8%)も指定できる。
   書体は動画全体でそろえる(文字ごとに変えない)。
   animationは候補から選ぶ:
${captionAnimationHints}
${imageSection}

### 手順①-2 項目ラベル(参考スクショの有無に関係なく必ず入れる)
8. ランキング・比較・採点・手順・割合などで、話の中に「項目」(順位・国・職業・治療名・比べる観点・手順名)が出る動画では、
   本人がその項目名や答え(順位・数字・判定)を言った瞬間のクリップの先頭に、項目名(と数字)の短いラベルをoverlaysで出す。
   ラベルの役割は次の2つだけ。
   (a) 枠・一覧を埋める物: keepUntilEnd=trueとslotRank
   (b) 今どの観点の話かを示す見出し: durationInSecondsをその観点の話が終わるまでの長さにする
   文言は本人が言った名詞・数字だけにし、説明文にしない(「学生\n40%」「費用」「4位 ドイツ」)。
   項目が出ているのにラベルが無い動画は失敗とみなす。

### 手順② テロップ
4-9. showCaptions: 常にtrue。本人の話している言葉は、speechがそのまま字幕として必ず出る(本人が編集画面で見た目を選ぶ)。
   字幕と同じ文言(話している言葉をそのまま・少し縮めた物)をoverlaysに書かない。書くと同じ文字が二重に出る
   (サーバー側でも外す)。ただしoverlays自体は減らさない: 項目名・数字(「40%」「20/20点」)・工程名・人や物の名前・
   見出し・注釈は、本人の話に出てくる場面で必ず入れる。
5. speech: そのクリップで本人が話している言葉をそのまま書き起こす(テロップになる)。字幕として読みやすい長さ
   (1〜2行、全角25文字くらいまで)に収まるよう、長く話す所はクリップを分ける。
   字幕を2行にする時は、speechの中の意味の切れ目に「\\n」を1つだけ入れてよい(例:「日本の方が\\n通いやすい」)。
5-2. face: そのクリップで話している人の顔の位置。添付した本人の動画の画面(寄りを付ける前)に対する割合で、
   xPercent/yPercentは顔の中心、widthPercent/heightPercentは顔(髪・あごを含む)の幅・高さ。顔が映っていなければnull。
   文字・画像を顔に重ねないよう、サーバー側でこの位置を避けて配置し直すので、正確に書く。
6. theme: テロップの見た目。全体の差し色(primaryColor、#RRGGBB)・テロップの位置・背景の付き方。参考スクショに合わせる。
   手順①で置いた物と重ならない位置を選ぶ。フォントは本人が決めた物を動画全体で使うので選ばない。
   captionPosition候補: ${CAPTION_POSITION_VALUES.join(" / ")}
   captionStyle候補:
${captionStyleHints}
   captionFontSize(字幕の大きさ): small / medium / large / xlarge。字幕を画面中央に大きく出す参考ならlarge〜xlarge。
7. captionAnimation: テロップの出現演出(候補は4と同じ)。

### 手順③ 強調テキスト
テロップの中の強調(色を変える語・書体・光)は、本人が後で選ぶので付けない。テロップの書体・色は動画全体で1つにそろえる。
9. overlays(強調): 項目ラベル(8)以外に足す文字は、本人の本音・ツッコミ・注釈(「※個人の感想です」など)だけで、
   本人の動画に本音・ツッコミ・注釈の場面がある所にだけ入れる。字幕の言い換えや煽り文句は入れない。
   項目は4と同じ。顔や手順①の物・テロップを隠さない位置に置く。

### 手順④ カメラアングル(寄りは感情の山にだけ。迷ったら寄らない)
10. zoom: 寄りは「感情の山」にだけ使う(本音・ツッコミ・オチ・答え合わせの後のリアクション)。順位や数字を発表する瞬間は、
    ラベルと効果音で見せ、寄らない。globalShapesやglobalOverlays(枠・一覧・比較カード)をずっと出している動画では、
    寄ると人物と枠の位置関係が崩れるので、寄りは動画全体で0〜1回にする。テンプレートによっては、寄り方はサーバー側の
    カメラワークのルールで決め直す。
    - 寄るならpunchで1.2〜1.3倍、効果音(impactなど)と同時にする。1.35を超えない
    - focusXPercent/focusYPercentは本人の顔(目のあたり)。1秒未満の短いクリップには入れない

### 仕上げ(①〜④が終わってから)
11. sfx: 効果音は「画面に新しい物が出る瞬間」の合図としてだけ鳴らす(offsetSecondsはクリップ先頭からの秒)。新しい物とは、
    項目ラベル・枠を埋める物・見出し・画像・〇印・答え合わせの一覧のこと。offsetSecondsは、その物のstartOffsetSecondsと同じ値にする。
    話の内容(お金の話・問いかけ・驚き)だけを理由に、画面が何も変わらない所で鳴らさない。目安は「項目1つにつき1〜2個、
    項目と項目の間の説明の部分は0個」。同じ役割の出来事には、動画全体で同じ音を使う(例: 項目ラベルが出る=pop、
    勝ち・判定が決まる=decide、答え合わせ・一覧の公開=reveal、一番のオチ=impact)。音の種類は動画全体で2〜4種類に収める。候補:
${sfxPresetHints}
12. narration: 常にnull。AIナレーション(読み上げ音声)は本人が編集画面で必要な所にだけ付けるので、自動編集では入れない。
    編集例の書き起こしにnarrationが入っていても真似しない。
13. hook: 冒頭0〜3秒に本人の映像の上へ重ねる大見出し(スクロールを止める一言)。subline(補足)は任意。
    歯科の動画では、見る人が「自分のことかも」と思う切り口を優先する(悩みの言葉=「出っ歯」「黄ばみ」「すきっ歯」、
    当てはまるかの問いかけ=「この歯並び当てはまる?」)。聞き手の質問から始まる動画は、その質問を短くして見出しにする。
    枠・一覧・グラフを冒頭から見せる動画は、それ自体がつかみ(埋まるのを見たくなる)なので、hookはnullでよい。
    冒頭の本人の一言だけで十分に引きがあるならnullでよい。上部のタイトルをずっと出しているなら、同じ言葉を繰り返さない(null)。
    参考や編集例に冒頭の大見出しが無いなら、真似してnullにする。
13-2. hookAlternatives: 冒頭の見出しの別の案を2つ。hookと切り口を変える(自分のことかもと思わせる問いかけ・結論を先に言う・
    「現役歯科医師が答える〇〇」のような専門家としての切り口、など。数字・事実は本人が言った物だけ)。
    hookをnullにした時も、本人が選べるように2つ書く。titleと同じ言葉は使わない。どれも全角15文字くらいまでの短い一言にする。
14. cta: 最後の数秒に、画面下から2割あたりへ帯付きで重ねる一言。不要ならnull。見た人が次にする事を1つだけ、落ち着いた言い方で書く
    (情報系なら「保存してあとで見返してね」、悩みに触れた動画なら「気になる症状はコメントで質問してね」、医院へ誘導するなら
    「詳しくはプロフィールから」)。「今すぐ」「先着」「限定」のような急がせる言葉は使わない。
    最後のクリップのoverlaysで締めの言葉をすでに出しているなら、同じ内容を繰り返さない(null)。
    参考や編集例に下の帯の締めの一言が無いなら、真似してnullにする。
15. summary: どこを切ってどこをフックにし、どこで山を作ったかを日本語1〜2文で書く。

## 画面の配置(重なると読めなくなるので必ず守る)
- title: 画面の左上にずっと出る(サーバー側で置く)
- globalOverlays(ずっと出す物): titleと重ならない所
- hook: 冒頭3秒だけ画面中央に大きく出る
- テロップ: themeのcaptionPositionの位置(top=上部 / middle=中央 / bottom=下部)
- cta: 最後の5秒、画面下から2割あたりに出る
- overlays・images: 上の要素と同じ時間に同じ場所へ置かない。5-2で書いた顔も隠さない
- 先に役割ごとの場所(縦の帯)を決めてから置く: タイトル=上0〜12%、枠・一覧=globalShapesの場所、字幕=captionPositionの帯、
  ラベル・見出し=字幕とも枠とも重ならない帯。右端の12%と下端の15%はアプリのボタンや説明文で隠れるので、文字を置かない
- 文字の箱の大きさは、横=文字数×fontSizePx÷1080×100(%)、縦=行数×fontSizePx×1.3÷1920×100(%)で見積もり、
  中心(xPercent/yPercent)からその半分ずつ広がるとして、ほかと重ならない位置にする
- keepUntilEnd=trueの物は、出た時刻から最後までその場所を使い続ける。後から出す物は、すでに残っている物を全部避ける
- 同じ文言・同じ位置のoverlayを隣り合うクリップに書き直さない(続けて出すならdurationInSecondsを伸ばす)

## 文字の改行(変な所で改行されると読みにくいので必ず守る)
- speech: 全角25文字まで。2行にするなら意味の切れ目に「\\n」を1つだけ(入れなければ画面の幅で自動で折り返す)
- title: 全角16文字まで / hook・hookAlternatives: 全角15文字まで / overlays・globalOverlays・cta: 全角10文字まで
- 2行にする時だけ「\\n」で改行し、改行は必ず意味の切れ目(文節・助詞の後)に入れる。
  単語の途中・数字と単位の間(「3/倍」)・1〜2文字だけの行は作らない
  (良い例:「知らないと\\n損する話」 悪い例:「知らないと損す\\nる話」「最\\n強」)

## 量について
- 量は数で決めず、中身で決める(一番大事な決まりのとおり)。目安は「近い手本の入れ方」の密度。それより大きく少ないのも、
  多すぎるのも不自然
- 寄りは感情の山にだけ。枠や一覧をずっと出す動画では0〜1回
- 寄り・文字・効果音を同じ瞬間に全部重ねるのは、一番の山場だけにする

## 設計の考え方
- 冒頭0〜2秒のつかみは、テーマの問い(タイトル)と、これから埋まる空の枠・一覧・グラフを最初から見せる事で作る
  (最後まで見ないと答えがそろわない形)。hookの大見出しは、枠や一覧が無く、冒頭の一言だけでは弱い時にだけ使う
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
    // Geminiは改行を「\n」の2文字のまま書いてくることがあり、そのまま画面に「\n」と出ていた。
    .replace(/\\n/g, "\n")
    .replace(/\r\n?/g, "\n")
    // 日本語の間に入った空白(「全員 知っている」)は、画面で変な隙間・変な改行になるので消す
    .replace(/([^\x00-\x7F])[ \u3000]+(?=[^\x00-\x7F])/g, "$1")
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

/** 改行を最初の1つだけ残す(字幕は2行まで)。 */
const keepFirstLineBreak = (text: string): string => {
  const [first, ...rest] = text.split("\n");
  return rest.length > 0 ? `${first}\n${rest.join("")}` : first;
};

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#FF0000",
  blue: "#0000FF",
  yellow: "#FFFF00",
  green: "#008000",
};

/**
 * Geminiが書いた色を#RRGGBBにそろえる。#RGB(3桁)・#RRGGBBAA(透明度付き)・black等の名前で書いてくることがあり、
 * 6桁以外を捨てていた頃は、ランキングの枠の線の色が読めずに枠ごと消えていた。読めなければundefined。
 */
const hexOrUndefined = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (HEX_COLOR_PATTERN.test(trimmed)) return trimmed;
  const named = NAMED_COLORS[trimmed.toLowerCase()];
  if (named) return named;
  const short = /^#?([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(trimmed);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const longish = /^#?([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?$/.exec(trimmed);
  return longish ? `#${longish[1]}` : undefined;
};

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
      fontFamily: raw.fontFamily ?? undefined,
      glowColor: hexOrUndefined(raw.glowColor),
      italic: raw.italic ?? undefined,
      strokeWidthPx: raw.strokeWidthPx != null ? clamp(raw.strokeWidthPx, 1, 40) : undefined,
    });
    if (parsed.success) overlays.push(parsed.data);
  }
  return overlays.length > 0 ? overlays.slice(0, maxCount) : undefined;
};

/** Geminiが置いた画像を、実際のファイル(使える画像 or AIが作った画像)に結び付ける。結び付けられなければundefined。 */
type ImageSourceResolver = (raw: RawAutoEditImage) => string | undefined;

/**
 * ランキングの枠に入れる画像か(何位の枠かが書いてある画像)。最後まで出すだけの画像(比べる動画のカードの国旗など)は
 * 含めない(含めていた頃は、使い回す元の画像が無いので作られず、国旗が消えていた)。
 */
const isSlotImage = (image: RawAutoEditImage): boolean => image.slotRank != null;

/** AIに作らせる画像の目印。同じ画像を2回出す時は同じnameを付けさせているので、nameで1枚にまとめる。 */
const generatedImageKey = (raw: RawAutoEditImage): string => raw.name?.trim() || raw.description.trim();

const findMaterialImage = (raw: RawAutoEditImage, materialImages: ResolvedMaterialImage[]) =>
  raw.imageNumber != null ? materialImages[raw.imageNumber - 1] : undefined;

/** AIが作った画像の出どころ。棚(前に作った画像)は無料、新しく作った画像は1枚約10円。 */
type GeneratedImageSource = { path: string; source: "library" | "generated" | "icon" };

/**
 * 使える画像に無い画像(imageNumberがnull)を、画像の棚から探し、無い分だけAIに作らせる。目印→画像のパスを返す。
 * 新しく作るのは本人が決めた上限(maxGeneratedImages)まで。1枚失敗しても他は続け、作れなかった画像はその場所に出さない
 * (自動編集全体は止めない)。完成動画に入らないクリップ(使う範囲の外など)の画像は作らない。
 */
const generateMissingImages = async (
  plan: { clips: RawAutoEditClip[]; generatedImageStyle?: GeneratedImageStyle | null },
  input: Pick<AutoEditPlanInput, "keepRanges" | "materialImages" | "maxGeneratedImages" | "onProgress">
): Promise<Map<string, GeneratedImageSource>> => {
  const requests = new Map<string, { name: string; description: string }>();
  const usedClips = plan.clips.filter((clip) => fitClipToKeepRanges(clip, input.keepRanges)).slice(0, MAX_CLIPS);
  for (const clip of usedClips) {
    for (const image of clip.images ?? []) {
      if (findMaterialImage(image, input.materialImages)) continue;
      // 枠に入れる画像は、その前に大きく出していた画像を使い回す(finalizeAutoEditPlan)ので、別には作らない。
      if (isSlotImage(image)) continue;
      const key = generatedImageKey(image);
      if (key && !requests.has(key) && requests.size < MAX_REQUESTED_IMAGES) {
        requests.set(key, { name: image.name?.trim() ?? "", description: image.description });
      }
    }
  }
  if (requests.size === 0) return new Map();
  // 画風の指定が無ければ、誤解を招きにくいイラストにする。
  const style = plan.generatedImageStyle ?? "illustration";
  const sources = new Map<string, GeneratedImageSource>();

  // まず画像の棚から探す(同じ物の画像が前に作ってあれば、作らずに使う)。画風が違う画像は混ぜない。
  const entries = [...requests.entries()];
  // アイコン・国旗(icon)は、どちらの画風の動画にも合うので一緒に探す
  const library = (await loadImageLibrary()).filter((image) => image.style === style || image.style === "icon");
  const exact = new Map(library.map((image) => [image.description.trim(), image]));
  const unmatched = entries.filter(([key, request]) => {
    const image = exact.get(request.description.trim());
    if (image) sources.set(key, { path: libraryImageSrc(image), source: image.style === "icon" ? "icon" : "library" });
    return !image;
  });
  const usedPaths = new Set([...sources.values()].map((entry) => entry.path));
  const matches = await matchLibraryImages(
    unmatched.map(([, request]) => request),
    library.filter((image) => !usedPaths.has(libraryImageSrc(image)))
  );
  for (const [index, image] of matches) {
    sources.set(unmatched[index][0], { path: libraryImageSrc(image), source: image.style === "icon" ? "icon" : "library" });
  }

  // 棚に無い分だけ、上限まで作る(作った画像は棚に足される)。話に出てくる順に作る。
  const limit = clamp(Math.floor(input.maxGeneratedImages), 0, MAX_GENERATED_IMAGES);
  const toGenerate = Math.min(limit, entries.filter(([key]) => !sources.has(key)).length);
  let generated = 0;
  let skipped = 0;
  let attempted = 0;
  if (toGenerate > 0) input.onProgress?.({ stage: "images", done: 0, total: toGenerate });
  for (const [key, request] of entries) {
    if (sources.has(key)) continue;
    if (generated >= limit) {
      skipped++;
      continue;
    }
    attempted++;
    try {
      const result = await getOrGenerateImage(request.description, style, request.name);
      if (!result.cached) generated++;
      sources.set(key, { path: result.path, source: result.cached ? "library" : "generated" });
    } catch (error) {
      console.warn(`[autoEditPlan] 画像「${key}」を作れなかったため、その画像は出しません`, error);
    }
    input.onProgress?.({ stage: "images", done: Math.min(attempted, toGenerate), total: toGenerate });
  }
  console.info(
    `[autoEditPlan] 画像${requests.size}種類: 棚から${requests.size - generated - skipped}種類・新しく作った${generated}種類` +
      (skipped > 0 ? `・上限(${limit}枚)を超えて出さない${skipped}種類` : "")
  );
  return sources;
};

/** AIが作った画像を使った動画に添える注意書き。作った画像を本物の写真と誤解させないため。 */
const GENERATED_IMAGE_NOTICE: TextOverlay = {
  text: "※画像はイメージです",
  startOffsetSeconds: 0,
  xPercent: 14,
  yPercent: 97.5,
  fontSizePx: 26,
  color: "#FFFFFF",
  strokeColor: "#000000",
  rotationDeg: 0,
  animation: "fade",
};

/** Geminiが置いた画像を実際のファイルに結び付け、描画側のスキーマに合わせて丸め込む。 */
const normalizeImages = (
  rawImages: RawAutoEditImage[] | null | undefined,
  clipDuration: number,
  maxCount: number,
  resolveSrc: ImageSourceResolver
): ImageOverlay[] | undefined => {
  const images: ImageOverlay[] = [];
  for (const raw of rawImages ?? []) {
    // 書き起こしの手本と違い、自動編集では実際のファイルが無い画像は置けない(捨てる)。
    const src = resolveSrc(raw);
    if (!src) continue;
    const startOffsetSeconds = clamp(raw.startOffsetSeconds ?? 0, 0, Math.max(0, clipDuration - 0.2));
    const parsed = imageOverlaySchema.safeParse({
      src,
      startOffsetSeconds,
      durationInSeconds:
        raw.durationInSeconds != null
          ? clamp(raw.durationInSeconds, 0.2, Math.max(0.2, clipDuration - startOffsetSeconds))
          : undefined,
      xPercent: clamp(raw.xPercent ?? 50, 0, 100),
      yPercent: clamp(raw.yPercent ?? 50, 0, 100),
      widthPercent: clamp(raw.widthPercent ?? 50, 5, 100),
      heightPercent: raw.heightPercent != null ? clamp(raw.heightPercent, 2, 100) : undefined,
      cornerRadiusPx: clamp(raw.cornerRadiusPx ?? 0, 0, 200),
      animation: raw.animation ?? "pop",
    });
    if (parsed.success) images.push(parsed.data);
  }
  return images.length > 0 ? images.slice(0, maxCount) : undefined;
};

/**
 * クリップに置かれた文字・画像のうち、クリップの外まで出し続ける物(最後まで残す物、話題の間ずっと出す物)か。
 * クリップの文字・画像はそのクリップの間しか出せないので、こういう物は全体の文字・画像に移す。
 */
const outlivesClip = (
  item: { keepUntilEnd?: boolean | null; startOffsetSeconds?: number | null; durationInSeconds?: number | null },
  clipDuration: number
): boolean =>
  Boolean(item.keepUntilEnd) ||
  (item.durationInSeconds != null && (item.startOffsetSeconds ?? 0) + item.durationInSeconds > clipDuration + 0.05);

/**
 * クリップ先頭からの秒数で書かれた文字・画像を、完成動画の先頭からの秒数に直す。
 * 動画全体の秒数をGeminiに数えさせるとずれるので、出し始めるクリップに置かせたまま、ここで計算する。
 */
const toWholeVideoTiming = <T extends { keepUntilEnd?: boolean | null; startOffsetSeconds?: number | null; durationInSeconds?: number | null }>(
  item: T,
  clipOutputStart: number,
  clipDuration: number
): T => ({
  ...item,
  startOffsetSeconds: clipOutputStart + clamp(item.startOffsetSeconds ?? 0, 0, Math.max(0, clipDuration - 0.2)),
  // nullにすると描画側で動画の最後まで出す
  durationInSeconds: item.keepUntilEnd ? null : item.durationInSeconds,
});

/** Geminiの図形を描画側のスキーマに合わせて丸め込む。 */
const normalizeShapes = (rawShapes: RawAutoEditShape[] | null | undefined, videoDuration: number): ShapeOverlay[] => {
  const shapes: ShapeOverlay[] = [];
  // Geminiは同じ形の枠を並べる時、2つ目以降(時には全部)の色・大きさを省いて位置だけ書くことがある。
  // 省かれた項目は、色まで書いてある最初の図形から引き継ぎ、それも無ければ黒い線の枠として描く
  // (以前は色が無い図形を「見えない」として捨てていたため、ランキングの枠ごと消えることがあった)。
  const template = (rawShapes ?? []).find((shape) => hexOrUndefined(shape.borderColor) || hexOrUndefined(shape.fillColor));
  const withoutNulls = (shape: RawAutoEditShape) =>
    Object.fromEntries(Object.entries(shape).filter(([, value]) => value !== null && value !== undefined));
  for (const original of rawShapes ?? []) {
    const raw: RawAutoEditShape = {
      ...(template ? withoutNulls({ ...template, xPercent: null, yPercent: null, startOffsetSeconds: null, durationInSeconds: null }) : { borderColor: "#000000" }),
      ...withoutNulls(original),
    };
    const startOffsetSeconds = clamp(raw.startOffsetSeconds ?? 0, 0, Math.max(0, videoDuration - 0.2));
    const parsed = shapeOverlaySchema.safeParse({
      kind: raw.kind ?? "rect",
      startOffsetSeconds,
      durationInSeconds:
        raw.durationInSeconds != null
          ? clamp(raw.durationInSeconds, 0.2, Math.max(0.2, videoDuration - startOffsetSeconds))
          : undefined,
      xPercent: clamp(raw.xPercent ?? 50, 0, 100),
      yPercent: clamp(raw.yPercent ?? 50, 0, 100),
      widthPercent: clamp(raw.widthPercent ?? 30, 1, 100),
      heightPercent: clamp(raw.heightPercent ?? 10, 1, 100),
      borderColor: hexOrUndefined(raw.borderColor),
      borderWidthPx: clamp(raw.borderWidthPx ?? 8, 0, 40),
      fillColor: hexOrUndefined(raw.fillColor),
      fillOpacity: clamp(raw.fillOpacity ?? 1, 0, 1),
      cornerRadiusPx: clamp(raw.cornerRadiusPx ?? 24, 0, 200),
      animation: "fade",
    });
    // 枠線も塗りも無い図形は見えないので捨てる。
    if (parsed.success && (parsed.data.borderColor || parsed.data.fillColor)) {
      shapes.push(parsed.data);
    } else {
      console.info(
        `[autoEditPlan] 図形を捨てました: ${parsed.success ? "枠線も塗りも無い" : parsed.error.message} ${JSON.stringify(raw)}`
      );
    }
  }
  return shapes.slice(0, MAX_GLOBAL_SHAPES);
};

const normalizeFraming = (raw: RawAutoEditPlan["framing"]): VideoFraming | null => {
  if (!raw || raw.scale <= 1.001) return null;
  const parsed = videoFramingSchema.safeParse({
    scale: clamp(raw.scale, 1, MAX_FRAMING_SCALE),
    focusXPercent: clamp(raw.focusXPercent ?? 50, 0, 100),
    focusYPercent: clamp(raw.focusYPercent ?? 50, 0, 100),
  });
  return parsed.success ? parsed.data : null;
};

/** 比べるために、空白・記号・改行を除いた文字だけにする。 */
const comparableText = (text: string): string => text.replace(/[\s!！?？。、・…「」『』()（）\-ー〜~]/g, "");

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

/** Geminiが書いた顔の位置を丸め込む。小さすぎる・読めない物は無かったことにする。 */
const normalizeFace = (raw: RawAutoEditClip["face"]): FaceBox | undefined => {
  if (!raw) return undefined;
  const parsed = faceBoxSchema.safeParse({
    xPercent: clamp(raw.xPercent, 0, 100),
    yPercent: clamp(raw.yPercent, 0, 100),
    widthPercent: clamp(raw.widthPercent, 1, 100),
    heightPercent: clamp(raw.heightPercent, 1, 100),
  });
  return parsed.success && parsed.data.widthPercent >= 3 && parsed.data.heightPercent >= 2 ? parsed.data : undefined;
};

/** 顔の位置の見積もりの誤差を見込んで、顔の範囲を上下左右に広げる割合。 */
const FACE_MARGIN_RATIO = 0.15;

/**
 * 顔が完成動画の画面のどこに映るか(%)。映像には画角(framing)と寄り(zoom)が付くので、その分だけ動かす
 * (描画側のMediaBackground.tsxと同じ計算。中心の点は動かず、ほかは中心から離れる方向へ広がる)。
 * ゆっくり寄る(slow)クリップは、寄る前と寄った後の両方を含む範囲にする。
 */
export const faceOnScreen = (face: FaceBox, framing: VideoFraming | null, zoom: ClipZoom | undefined): BoxPercent => {
  const halfWidth = (face.widthPercent / 2) * (1 + FACE_MARGIN_RATIO * 2);
  const halfHeight = (face.heightPercent / 2) * (1 + FACE_MARGIN_RATIO * 2);
  const scaleAround = (value: number, focus: number, scale: number) => focus + (value - focus) * scale;
  const project = (zoomScale: number, panOffset = 0): BoxPercent => {
    const toScreen = (x: number, y: number) => {
      let px = zoom ? scaleAround(x, clamp(zoom.focusXPercent + panOffset, 0, 100), zoomScale) : x;
      let py = zoom ? scaleAround(y, zoom.focusYPercent, zoomScale) : y;
      if (framing) {
        px = scaleAround(px, framing.focusXPercent, framing.scale);
        py = scaleAround(py, framing.focusYPercent, framing.scale);
      }
      return { x: px, y: py };
    };
    const topLeft = toScreen(face.xPercent - halfWidth, face.yPercent - halfHeight);
    const bottomRight = toScreen(face.xPercent + halfWidth, face.yPercent + halfHeight);
    return { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y };
  };
  const end = project(zoom?.scale ?? 1);
  // ゆっくり寄るなら寄る前から後まで、横に流すなら流す範囲の両端を含める(描画側のPAN_RANGE_PERCENTと同じ幅)
  const box =
    zoom?.style === "slow"
      ? unionBox(project(1), end)
      : zoom?.style === "pan"
        ? unionBox(project(zoom.scale, -15), project(zoom.scale, 15))
        : end;
  return {
    left: clamp(box.left, 0, 100),
    top: clamp(box.top, 0, 100),
    right: clamp(box.right, 0, 100),
    bottom: clamp(box.bottom, 0, 100),
  };
};

const unionBox = (a: BoxPercent, b: BoxPercent): BoxPercent => ({
  left: Math.min(a.left, b.left),
  top: Math.min(a.top, b.top),
  right: Math.max(a.right, b.right),
  bottom: Math.max(a.bottom, b.bottom),
});

/** 左上のタイトルの決まった形。白い文字に黒い縁取りで、どんな映像の上でも読めるようにする。 */
const TITLE_FONT_SIZE_PX = 64;
/** タイトルの1行の最大幅(px)。左上に収め、画面の右半分(顔のある所)まで伸ばさない。 */
const TITLE_MAX_WIDTH_PX = 620;
/** タイトルの左端・上端の位置(%)。 */
const TITLE_LEFT_PERCENT = 4;
const TITLE_TOP_PERCENT = 5;

/** 左上のタイトルを作る。位置は文字の中心で持つので、文字の大きさの見積もりから左上が決まった所に来るよう中心を決める。 */
const buildTitleOverlay = (text: string): TextOverlay => {
  const lines = breakIntoLines(text, TITLE_FONT_SIZE_PX, TITLE_MAX_WIDTH_PX).slice(0, 3);
  const base: TextOverlay = {
    text: lines.join("\n"),
    startOffsetSeconds: 0,
    xPercent: 50,
    yPercent: 50,
    fontSizePx: TITLE_FONT_SIZE_PX,
    color: "#FFFFFF",
    strokeColor: "#000000",
    rotationDeg: 0,
    animation: "fade",
    textAlign: "left",
  };
  const box = estimateOverlayBox(base);
  return {
    ...base,
    xPercent: TITLE_LEFT_PERCENT + (box.right - box.left) / 2,
    yPercent: TITLE_TOP_PERCENT + (box.bottom - box.top) / 2,
  };
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

/** 前の画像が消えてから、同じ画像が別の所に出るまでを「動いて移った」とみなす間(秒)。 */
const MOVE_LINK_GAP_SECONDS = 0.6;

/**
 * 大きく出していた写真が消えるのと同時に、同じ写真が別の所(ランキングの枠など)に出たら、
 * 前の位置・大きさから動いてくるようにする(完成動画の手本では、写真が縮みながら枠へ入っていく)。
 * Geminiには「どこからどこへ」を考えさせず、出す時刻と画像の一致から決める。
 */
const linkImageMoves = (globalImages: ImageOverlay[], clips: AutoEditClipPlan[]): ImageOverlay[] => {
  const shown: { image: ImageOverlay; start: number; end: number }[] = [];
  let clipStart = 0;
  for (const clip of clips) {
    for (const image of clip.images ?? []) {
      const start = clipStart + image.startOffsetSeconds;
      shown.push({ image, start, end: start + (image.durationInSeconds ?? clip.durationInSeconds - image.startOffsetSeconds) });
    }
    clipStart += clip.durationInSeconds;
  }
  for (const image of globalImages) {
    shown.push({
      image,
      start: image.startOffsetSeconds,
      end: image.durationInSeconds !== undefined ? image.startOffsetSeconds + image.durationInSeconds : Infinity,
    });
  }
  return globalImages.map((image) => {
    if (image.moveFrom) return image;
    const previous = shown.find(
      (other) =>
        other.image !== image &&
        other.image.src === image.src &&
        other.start < image.startOffsetSeconds &&
        Math.abs(other.end - image.startOffsetSeconds) <= MOVE_LINK_GAP_SECONDS
    )?.image;
    if (!previous) return image;
    return {
      ...image,
      moveFrom: {
        xPercent: previous.xPercent,
        yPercent: previous.yPercent,
        widthPercent: previous.widthPercent,
        heightPercent: previous.heightPercent,
      },
    };
  });
};

/**
 * 冒頭に大きく出していた文字が消えるのと同時に、同じ文字が別の所(上部など)に出たら、前の位置・大きさから動いてくるようにする
 * (比較動画の手本では、冒頭に中央へ大きく出したタイトルが、縮みながら上へ移っていく)。画像のlinkImageMovesと同じ考え方。
 */
const linkTextMoves = (overlays: TextOverlay[]): TextOverlay[] =>
  overlays.map((overlay) => {
    if (overlay.moveFrom) return overlay;
    const previous = overlays.find(
      (other) =>
        other !== overlay &&
        other.durationInSeconds !== undefined &&
        comparableText(other.text) === comparableText(overlay.text) &&
        other.startOffsetSeconds < overlay.startOffsetSeconds &&
        Math.abs(other.startOffsetSeconds + other.durationInSeconds - overlay.startOffsetSeconds) <= MOVE_LINK_GAP_SECONDS
    );
    return previous
      ? { ...overlay, moveFrom: { xPercent: previous.xPercent, yPercent: previous.yPercent, fontSizePx: previous.fontSizePx } }
      : overlay;
  });

/** ランキングの枠1つの位置と大きさ(%)。 */
type RankSlot = { xPercent: number; yPercent: number; widthPercent?: number; heightPercent?: number };

/** 「1位」「第3位」「３位」のような順位の文字なら、その数。 */
const rankOfLabel = (text: string): number | null => {
  const normalized = text.replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0)).replace(/\s/g, "");
  const match = /^第?(\d{1,2})位$/.exec(normalized);
  return match ? Number(match[1]) : null;
};

/**
 * ずっと出している「N位」の文字と枠の図形から、順位→枠の位置を作る。枠の図形があれば、その順位の文字に一番近い
 * 図形を枠とし、無ければ文字の位置そのものを枠とする。
 */
const findRankSlots = (data: RawAutoEditPlan): Map<number, RankSlot> => {
  const shapes = (data.globalShapes ?? []).filter((shape) => (shape.kind ?? "rect") === "rect" && shape.xPercent != null && shape.yPercent != null);
  // 位置だけ書いて大きさを省いた枠は、大きさまで書いてある枠から引き継ぐ(normalizeShapesと同じ扱い)
  const sized = shapes.find((shape) => shape.widthPercent != null && shape.heightPercent != null);
  const slots = new Map<number, RankSlot>();
  for (const label of data.globalOverlays ?? []) {
    const rank = rankOfLabel(label.text);
    if (rank === null || slots.has(rank) || label.xPercent == null || label.yPercent == null) continue;
    const nearest = shapes
      .map((shape) => ({ shape, distance: Math.hypot(shape.xPercent! - label.xPercent!, (shape.yPercent! - label.yPercent!) * 1.78) }))
      .sort((a, b) => a.distance - b.distance)[0];
    // 枠の大きさの半分くらいまでの近さなら、その枠のラベルとみなす
    if (nearest && nearest.distance < 25) {
      slots.set(rank, {
        xPercent: nearest.shape.xPercent!,
        yPercent: nearest.shape.yPercent!,
        widthPercent: nearest.shape.widthPercent ?? sized?.widthPercent ?? undefined,
        heightPercent: nearest.shape.heightPercent ?? sized?.heightPercent ?? undefined,
      });
    } else {
      slots.set(rank, { xPercent: label.xPercent, yPercent: label.yPercent });
    }
  }
  return slots;
};

/**
 * 「何位の枠に入れるか(slotRank)」を書いた画像・文字を、その順位の枠の位置へ合わせる。
 * Geminiに座標で書かせると、発表の順番(2位→3位→5位…)と枠の並び(1位が一番上)の取り違えで、
 * 別の順位の枠に入ってしまうことがあった。順位だけ書かせ、位置はここで決める。
 */
const snapToRankSlots = <T extends { slotRank?: number | null; xPercent?: number | null; yPercent?: number | null }>(
  item: T,
  slots: Map<number, RankSlot>,
  kind: "image" | "text"
): T => {
  if (item.slotRank == null) return item;
  const slot = slots.get(item.slotRank);
  if (!slot) return item;
  if (kind === "text") {
    // 枠の中には「N位」の文字もあるので、名前は枠の高さに収まる大きさにして、枠の上寄りに置く
    const textItem = item as T & { fontSizePx?: number | null };
    const maxFontSizePx = slot.heightPercent != null ? Math.round((slot.heightPercent / 100) * VIDEO_HEIGHT * 0.35) : undefined;
    return {
      ...item,
      xPercent: slot.xPercent,
      yPercent: slot.heightPercent != null ? slot.yPercent - slot.heightPercent * 0.18 : slot.yPercent,
      ...(maxFontSizePx !== undefined ? { fontSizePx: Math.min(textItem.fontSizePx ?? 80, maxFontSizePx) } : {}),
    };
  }
  return {
    ...item,
    xPercent: slot.xPercent,
    yPercent: slot.yPercent,
    ...(slot.widthPercent != null ? { widthPercent: slot.widthPercent } : {}),
    ...(slot.heightPercent != null ? { heightPercent: slot.heightPercent } : {}),
  };
};

type TimedBox = BoxPercent & { start: number; end: number };

/** 重なりとみなす最小の食い込み(%)。見積もりの誤差で、ぴったり並べた文字どうしまで重なりと判定しないため。 */
const OVERLAP_TOLERANCE_X = 1;
const OVERLAP_TOLERANCE_Y = 0.5;
/** 文字が画面の上下からはみ出さないための余白(%)。 */
const SCREEN_MARGIN_PERCENT = 2;

const boxesOverlap = (a: TimedBox, b: TimedBox, gapPercent = 0): boolean =>
  a.start < b.end &&
  b.start < a.end &&
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > OVERLAP_TOLERANCE_X - gapPercent &&
  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > OVERLAP_TOLERANCE_Y - gapPercent;

/** ずらして置く文字と、ほかの物の間に空ける隙間(%)。見積もりの誤差で、ぎりぎりに置いた文字が描くと重なっていたため。 */
const PLACEMENT_GAP_PERCENT = 0.8;

/**
 * 画像を、ずっと出る文字に重ならないよう切り詰める(ランキングの枠に入れた写真が「1位」の文字を隠していた)。
 * 文字のある側を除いた残りのうち一番広い所に、画像を収め直す(高さを決めて枠いっぱいに切り抜くので、絵は歪まない)。
 */
const trimImageAwayFromText = (image: ImageOverlay, imageTimes: { start: number; end: number }, texts: TimedBox[]): ImageOverlay => {
  let current = image;
  for (const text of texts) {
    const box = imageBox(current, imageTimes.start, imageTimes.end);
    if (!boxesOverlap(box, text)) continue;
    const gap = 0.4;
    const candidates: BoxPercent[] = [
      { ...box, bottom: Math.min(box.bottom, text.top - gap) },
      { ...box, top: Math.max(box.top, text.bottom + gap) },
      { ...box, right: Math.min(box.right, text.left - gap) },
      { ...box, left: Math.max(box.left, text.right + gap) },
    ].filter((candidate) => candidate.right - candidate.left > 2 && candidate.bottom - candidate.top > 1);
    if (candidates.length === 0) continue;
    const area = (b: BoxPercent) => ((b.right - b.left) * VIDEO_WIDTH) * ((b.bottom - b.top) * VIDEO_HEIGHT);
    const best = candidates.reduce((a, b) => (area(b) > area(a) ? b : a));
    // 元の半分より小さくなるなら、切り詰めずにそのまま(文字の方を動かす方がまし)
    if (area(best) < area(box) * 0.5) continue;
    current = {
      ...current,
      xPercent: (best.left + best.right) / 2,
      yPercent: (best.top + best.bottom) / 2,
      widthPercent: best.right - best.left,
      heightPercent: best.bottom - best.top,
    };
  }
  return current;
};

const textBox = (overlay: TextOverlay, start: number, end: number): TimedBox => ({ ...estimateOverlayBox(overlay), start, end });

/** 画像の範囲。高さの指定が無い画像は縦横比が分からないので、幅の3/4の高さ(4:3)とみなす。 */
const imageBox = (image: ImageOverlay, start: number, end: number): TimedBox => {
  const heightPercent = image.heightPercent ?? (image.widthPercent * 0.75 * VIDEO_WIDTH) / VIDEO_HEIGHT;
  return {
    left: image.xPercent - image.widthPercent / 2,
    right: image.xPercent + image.widthPercent / 2,
    top: image.yPercent - heightPercent / 2,
    bottom: image.yPercent + heightPercent / 2,
    start,
    end,
  };
};

const shapeBox = (shape: ShapeOverlay, start: number, end: number): TimedBox => {
  const heightPercent = shape.kind === "circle" ? (shape.widthPercent * VIDEO_WIDTH) / VIDEO_HEIGHT : shape.heightPercent;
  return {
    left: shape.xPercent - shape.widthPercent / 2,
    right: shape.xPercent + shape.widthPercent / 2,
    top: shape.yPercent - heightPercent / 2,
    bottom: shape.yPercent + heightPercent / 2,
    start,
    end,
  };
};

/**
 * 文字を、ほかの物と重ならない一番近い位置・大きさへ直す。元の位置で重ならなければそのまま。
 * 少し小さくする・上下左右にずらす、の組み合わせから、元の見た目から一番変わらない物を選ぶ。どうしても空きが無ければそのまま。
 */
const placeWithoutOverlap = (
  overlay: TextOverlay,
  start: number,
  end: number,
  obstacles: TimedBox[],
  { scales = [1, 0.9, 0.8, 0.7], quiet = false }: { scales?: number[]; quiet?: boolean } = {}
): TextOverlay | null => {
  const fits = (candidate: TextOverlay) => {
    const box = textBox(candidate, start, end);
    return (
      box.top >= SCREEN_MARGIN_PERCENT &&
      box.bottom <= 100 - SCREEN_MARGIN_PERCENT &&
      !obstacles.some((obstacle) => boxesOverlap(box, obstacle, PLACEMENT_GAP_PERCENT))
    );
  };
  if (!obstacles.some((obstacle) => boxesOverlap(textBox(overlay, start, end), obstacle))) return overlay;

  // 行の折り返し方の候補: そのまま、または短い幅で折り返し直した物(長い文を、空いている狭い所へ収めるため)
  const wrapVariants = [
    { text: overlay.text, cost: 0 },
    ...[640, 520, 420].map((widthPx, index) => ({
      text: breakIntoLines(overlay.text, overlay.fontSizePx, widthPx).join("\n"),
      cost: 4 + index * 2,
    })),
  ].filter((variant, index, all) => all.findIndex((other) => other.text === variant.text) === index);

  let best: { overlay: TextOverlay; cost: number } | null = null;
  for (const wrap of wrapVariants) {
    for (const scale of scales) {
      for (let dy = 0; dy <= 45; dy += 0.5) {
        for (const signY of dy === 0 ? [1] : [1, -1]) {
          for (const dx of [0, 3, -3, 6, -6, 10, -10, 15, -15, 20, -20, 25, -25]) {
            const cost = wrap.cost + dy + Math.abs(dx) * 1.2 + (1 - scale) * 40;
            if (best && cost >= best.cost) continue;
            const candidate: TextOverlay = {
              ...overlay,
              text: wrap.text,
              fontSizePx: Math.max(20, Math.round(overlay.fontSizePx * scale)),
              xPercent: clamp(overlay.xPercent + dx, 0, 100),
              yPercent: clamp(overlay.yPercent + signY * dy, 0, 100),
            };
            if (fits(candidate)) best = { overlay: candidate, cost };
          }
        }
      }
    }
  }
  if (!best) {
    if (quiet) return null;
    // 文字どうし・文字と顔・字幕が重ならないことは絶対に守る決まりなので、置き場所が無い文字は出さない
    console.info(`[autoEditPlan] 文字「${overlay.text}」の重ならない置き場所が見つからなかったため、出しません`);
    return null;
  }
  if (process.env.AUTO_EDIT_DEBUG_DIR) {
    console.info(
      `[autoEditPlan] 重なりを避けて「${overlay.text.replace(/\n/g, "")}」を (${overlay.xPercent},${overlay.yPercent},${overlay.fontSizePx}px)` +
        ` → (${best.overlay.xPercent},${best.overlay.yPercent},${best.overlay.fontSizePx}px) へ`
    );
  }
  return best.overlay;
};

/** テロップの文字の大きさ・余白・画面の端からの距離。描画側(AnimatedCaption.tsx)と同じ値。 */
const CAPTION_BASE_FONT_PX: Record<CaptionStyle, number> = { outline: 48, pill: 44 };
const CAPTION_OFFSET_FROM_EDGE_PX = 160;
const CAPTION_MAX_WIDTH_PX = VIDEO_WIDTH - 48 * 2;

/** テロップがその位置で画面のどこを占めるかの見積もり(%)。 */
const captionBox = (text: string, position: CaptionPosition, style: CaptionStyle, fontSize: CaptionFontSize): BoxPercent => {
  const fontPx = CAPTION_BASE_FONT_PX[style] * CAPTION_FONT_SIZE_SCALE[fontSize];
  const padding = style === "pill" ? 32 : 0;
  const lines = breakIntoLines(text || "あ", fontPx, CAPTION_MAX_WIDTH_PX - padding * 2);
  const widthPx = Math.min(CAPTION_MAX_WIDTH_PX, estimateTextWidthPx(lines.join("\n"), fontPx) + padding * 2);
  const heightPercent = ((lines.length * fontPx * 1.35 + padding) / VIDEO_HEIGHT) * 100;
  const edgePercent = (CAPTION_OFFSET_FROM_EDGE_PX / VIDEO_HEIGHT) * 100;
  const top = position === "top" ? edgePercent : position === "middle" ? 50 - heightPercent / 2 : 100 - edgePercent - heightPercent;
  const halfWidth = (widthPx / VIDEO_WIDTH) * 50;
  return { left: 50 - halfWidth, right: 50 + halfWidth, top, bottom: top + heightPercent };
};

/**
 * クリップごとに、テロップ(字幕)の位置を決める。字幕が顔に重ならないこと・ほかの文字や物(枠・カード・画像)に重ならないことは、
 * どんな時も守る決まり。全体で決めた位置(theme)で重ならなければそのまま、重なるなら下→上→中央の順に、
 * 顔にも文字にも重ならない位置を探す。そういう位置が無ければ、顔に重ならない位置のうち文字との重なりが一番小さい所、
 * それも無ければ顔との重なりが一番小さい所にする(顔を隠すより、文字の方を後から動かす・消す方がまし)。
 * テロップの位置は全体で1つだが、寄ったクリップや顔が下の方に映るクリップでは、決まった位置だと顔を隠していた。
 */
const chooseCaptionPositions = (
  clips: AutoEditClipPlan[],
  framing: VideoFraming | null,
  theme: { position: CaptionPosition; style: CaptionStyle; fontSize: CaptionFontSize },
  texts: TimedBox[],
  objects: TimedBox[] = []
): { clips: AutoEditClipPlan[]; captionBoxes: TimedBox[] } => {
  let clipStart = 0;
  const captionBoxes: TimedBox[] = [];
  const result = clips.map((clip) => {
    const start = clipStart;
    clipStart += clip.durationInSeconds;
    const timed = (box: BoxPercent): TimedBox => ({ ...box, start, end: start + clip.durationInSeconds });
    const face = clip.faceBox ? timed(faceOnScreen(clip.faceBox, framing, clip.zoom)) : null;
    const boxAt = (position: CaptionPosition) => timed(captionBox(clip.speechText, position, theme.style, theme.fontSize));
    const overlapArea = (box: TimedBox, others: TimedBox[]) =>
      others
        .filter((item) => item.start < box.end && box.start < item.end)
        .reduce(
          (sum, item) =>
            sum +
            Math.max(0, Math.min(box.right, item.right) - Math.max(box.left, item.left)) *
              Math.max(0, Math.min(box.bottom, item.bottom) - Math.max(box.top, item.top)),
          0
        );
    const faceArea = (position: CaptionPosition) => (face ? overlapArea(boxAt(position), [face]) : 0);
    const textArea = (position: CaptionPosition) => overlapArea(boxAt(position), texts);
    const objectArea = (position: CaptionPosition) => overlapArea(boxAt(position), objects);
    const candidates = [theme.position, ...(["bottom", "top", "middle"] as const).filter((p) => p !== theme.position)];
    const clear = (position: CaptionPosition) =>
      !(face && boxesOverlap(boxAt(position), face)) &&
      !texts.some((text) => boxesOverlap(boxAt(position), text)) &&
      !objects.some((object) => boxesOverlap(boxAt(position), object));
    // 全部を避けられない時は、顔→文字→物の順に重なりの小さい位置。残った重なりは、最後に字幕以外の方を消して必ずなくす
    const chosen =
      candidates.find(clear) ??
      [...candidates].sort((a, b) => faceArea(a) - faceArea(b) || textArea(a) - textArea(b) || objectArea(a) - objectArea(b))[0];
    if (chosen !== theme.position && face && faceArea(chosen) > 0) {
      console.info(`[autoEditPlan] 字幕が顔に重ならない位置が無かったため、重なりが一番小さい位置にしました(${start.toFixed(1)}秒〜)`);
    }
    if (clip.speechText.trim()) captionBoxes.push(boxAt(chosen));
    return chosen === theme.position ? clip : { ...clip, clipCaptionPosition: chosen };
  });
  return { clips: result, captionBoxes };
};

/**
 * 画像を、顔に重ならない一番近い位置・大きさへ動かす。元の位置で重ならなければそのまま。
 * 切り抜きはせず、少し小さくする・上下左右にずらす、の組み合わせから元の見た目から一番変わらない物を選ぶ。
 */
const placeImageAwayFromFaces = (image: ImageOverlay, start: number, end: number, faces: TimedBox[]): ImageOverlay => {
  const overlapsFace = (candidate: ImageOverlay) =>
    faces.some((face) => boxesOverlap(imageBox(candidate, start, end), face, PLACEMENT_GAP_PERCENT));
  if (!faces.some((face) => boxesOverlap(imageBox(image, start, end), face))) return image;
  let best: { image: ImageOverlay; cost: number } | null = null;
  for (const scale of [1, 0.85, 0.7, 0.55]) {
    for (let dy = 0; dy <= 50; dy += 2) {
      for (const signY of dy === 0 ? [1] : [1, -1]) {
        for (const dx of [0, 10, -10, 20, -20, 30, -30]) {
          const cost = dy + Math.abs(dx) * 1.2 + (1 - scale) * 60;
          if (best && cost >= best.cost) continue;
          const candidate: ImageOverlay = {
            ...image,
            xPercent: image.xPercent + dx,
            yPercent: image.yPercent + signY * dy,
            widthPercent: Math.max(5, image.widthPercent * scale),
            ...(image.heightPercent !== undefined ? { heightPercent: Math.max(2, image.heightPercent * scale) } : {}),
          };
          const box = imageBox(candidate, start, end);
          const inside = box.left >= 0 && box.right <= 100 && box.top >= SCREEN_MARGIN_PERCENT && box.bottom <= 100 - SCREEN_MARGIN_PERCENT;
          if (inside && !overlapsFace(candidate)) best = { image: candidate, cost };
        }
      }
    }
  }
  if (!best) {
    console.info(`[autoEditPlan] 画像の、顔に重ならない置き場所が見つからなかったため、そのままにします`);
    return image;
  }
  return best.image;
};

/**
 * ずっと出る文字(タイトル・順位の文字など)に、ほかの文字が重ならないようにする(ルール)。
 * 1. ずっと出る文字どうし: 先に置いた方を優先し、後の方をずらす
 * 2. それ以外の文字(話題の見出し・強調テキストなど): ずっと出る文字・枠・画像・先に置いた文字と重ならない所へずらす
 * Geminiに「重ねないで」と頼んでも、文字の大きさの見積もりが苦手で重なることがあったため、最後にここで確かめて直す。
 * 冒頭の見出し(hook)・締めの一言(cta)・字幕は決まった位置に出るので、ここでは動かさない。
 */
export const avoidTextOverlaps = (
  globalOverlays: TextOverlay[],
  clips: AutoEditClipPlan[],
  globalShapes: ShapeOverlay[],
  globalImages: ImageOverlay[],
  totalSeconds: number,
  framing: VideoFraming | null = null,
  captionTheme: { position: CaptionPosition; style: CaptionStyle; fontSize: CaptionFontSize } | null = null
): { globalOverlays: TextOverlay[]; clips: AutoEditClipPlan[]; globalImages: ImageOverlay[] } => {
  const endOf = (item: { startOffsetSeconds: number; durationInSeconds?: number }, fallbackEnd: number) =>
    item.durationInSeconds !== undefined ? item.startOffsetSeconds + item.durationInSeconds : fallbackEnd;
  // 「ずっと出る」は、最後まで出す物か、動画の半分以上出している物
  const isPersistent = (item: { startOffsetSeconds: number; durationInSeconds?: number }) =>
    item.durationInSeconds === undefined || item.durationInSeconds >= totalSeconds / 2;

  let clipStart = 0;
  const clipTimes = clips.map((clip) => {
    const start = clipStart;
    clipStart += clip.durationInSeconds;
    return start;
  });
  // 顔の範囲(クリップごと)。文字・画像はこれを避ける(Geminiに「顔を隠さないで」と頼むだけでは顔に重なることがあった)。
  const faces: TimedBox[] = clips.flatMap((clip, clipIndex) =>
    clip.faceBox
      ? [{ ...faceOnScreen(clip.faceBox, framing, clip.zoom), start: clipTimes[clipIndex], end: clipTimes[clipIndex] + clip.durationInSeconds }]
      : []
  );

  const placedPersistent: TimedBox[] = [];
  const resultGlobal: (TextOverlay | null)[] = globalOverlays.map((overlay) => overlay);
  for (const [index, overlay] of globalOverlays.entries()) {
    if (!isPersistent(overlay)) continue;
    const end = endOf(overlay, totalSeconds);
    // 「1位」などの順位の文字は枠と組なので、顔を理由には動かさない(枠ごと人物を避けて置いてある)
    const obstacles = rankOfLabel(overlay.text) === null ? [...placedPersistent, ...faces] : placedPersistent;
    // タイトルなどのずっと出す文字は、動画の中身そのものなので消さない。顔を避ける場所が無ければもっと小さくして探し、
    // それでも無ければ文字どうしだけ避けて置く(以前は、寄りのカットで顔が上まで来るとタイトルごと消えていた)
    const placed =
      placeWithoutOverlap(overlay, overlay.startOffsetSeconds, end, obstacles, { scales: [1, 0.9, 0.8, 0.7, 0.6, 0.5], quiet: true }) ??
      placeWithoutOverlap(overlay, overlay.startOffsetSeconds, end, placedPersistent, { scales: [1, 0.9, 0.8, 0.7, 0.6, 0.5], quiet: true }) ??
      overlay;
    resultGlobal[index] = placed;
    placedPersistent.push(textBox(placed, overlay.startOffsetSeconds, end));
  }

  // 字幕の位置は、ずっと出る文字を置いた後に、顔とその文字を避けて決める。残りの文字は字幕も避けて置く
  // 字幕が避ける物: 図形(枠・カード・〇印)と画像。字幕と重なると、どちらも見えなくなっていた
  const objects: TimedBox[] = [
    ...globalShapes.map((shape) => shapeBox(shape, shape.startOffsetSeconds, endOf(shape, totalSeconds))),
    ...globalImages.map((image) => imageBox(image, image.startOffsetSeconds, endOf(image, totalSeconds))),
    ...clips.flatMap((clip, clipIndex) =>
      (clip.images ?? []).map((image) => {
        const start = clipTimes[clipIndex] + image.startOffsetSeconds;
        return imageBox(image, start, start + (image.durationInSeconds ?? clip.durationInSeconds - image.startOffsetSeconds));
      })
    ),
  ];
  const captions = captionTheme
    ? chooseCaptionPositions(clips, framing, captionTheme, placedPersistent, objects)
    : { clips, captionBoxes: [] as TimedBox[] };
  clips = captions.clips;
  // 話の間だけ出す画像は、顔と字幕の両方を避けて動かす
  const facesAndCaptions = [...faces, ...captions.captionBoxes];

  // ずっと出す画像(ランキングの枠に入れた写真など)は、ずっと出る文字を隠さないよう切り詰める。
  // 話の間だけ出す画像は、顔に重なるなら顔の無い所へずらす。
  const arrangedImages = globalImages.map((image) => {
    const end = endOf(image, totalSeconds);
    return isPersistent(image)
      ? trimImageAwayFromText(image, { start: image.startOffsetSeconds, end }, placedPersistent)
      : placeImageAwayFromFaces(image, image.startOffsetSeconds, end, facesAndCaptions);
  });
  const clipsWithImagesPlaced = clips.map((clip, clipIndex) =>
    clip.images
      ? {
          ...clip,
          images: clip.images.map((image) => {
            const start = clipTimes[clipIndex] + image.startOffsetSeconds;
            return placeImageAwayFromFaces(image, start, start + (image.durationInSeconds ?? clip.durationInSeconds - image.startOffsetSeconds), facesAndCaptions);
          }),
        }
      : clip
  );

  const obstacles: TimedBox[] = [
    ...placedPersistent,
    ...faces,
    ...captions.captionBoxes,
    ...globalShapes
      .filter((shape) => shape.kind !== "circle")
      .map((shape) => shapeBox(shape, shape.startOffsetSeconds, endOf(shape, totalSeconds))),
    ...arrangedImages.map((image) => imageBox(image, image.startOffsetSeconds, endOf(image, totalSeconds))),
  ];
  clipsWithImagesPlaced.forEach((clip, clipIndex) => {
    for (const image of clip.images ?? []) {
      const start = clipTimes[clipIndex] + image.startOffsetSeconds;
      obstacles.push(imageBox(image, start, start + (image.durationInSeconds ?? clip.durationInSeconds - image.startOffsetSeconds)));
    }
  });

  for (const [index, overlay] of globalOverlays.entries()) {
    if (isPersistent(overlay)) continue;
    const end = endOf(overlay, totalSeconds);
    const placed = placeWithoutOverlap(overlay, overlay.startOffsetSeconds, end, obstacles);
    resultGlobal[index] = placed;
    if (placed) obstacles.push(textBox(placed, overlay.startOffsetSeconds, end));
  }
  const resultClips = clipsWithImagesPlaced.map((clip, clipIndex) => {
    if (!clip.overlays) return clip;
    const overlays = clip.overlays.flatMap((overlay) => {
      const start = clipTimes[clipIndex] + overlay.startOffsetSeconds;
      const end = start + (overlay.durationInSeconds ?? clip.durationInSeconds - overlay.startOffsetSeconds);
      const placed = placeWithoutOverlap(overlay, start, end, obstacles);
      if (!placed) return [];
      obstacles.push(textBox(placed, start, end));
      return [placed];
    });
    return { ...clip, overlays };
  });
  // 最後の確認(必ず守る決まり): 字幕に重なる文字・画像、顔に重なる画像が残っていたら、字幕・顔ではなくそちらを出さない。
  // ずっと出す枠の写真(ランキングの枠など)は動かせないので、字幕の位置の方で避けている
  const captionBoxes = captions.captionBoxes;
  const hitsCaption = (box: TimedBox) => captionBoxes.some((caption) => boxesOverlap(box, caption));
  const hitsFace = (box: TimedBox) => faces.some((face) => boxesOverlap(box, face));
  const dropped: string[] = [];
  const keepText = (overlay: TextOverlay, start: number, end: number) => {
    const ok = !hitsCaption(textBox(overlay, start, end));
    if (!ok) dropped.push(`文字「${overlay.text.replace(/\n/g, "")}」`);
    return ok;
  };
  const keepImage = (image: ImageOverlay, start: number, end: number, persistent: boolean) => {
    const box = imageBox(image, start, end);
    const ok = persistent || (!hitsCaption(box) && !hitsFace(box));
    if (!ok) dropped.push(`画像「${image.src.split("/").pop()}」`);
    return ok;
  };
  // ずっと出す文字は消さない(字幕の位置の方が、ずっと出す文字を避けて選んでいる)
  const finalGlobal = resultGlobal.filter(
    (overlay): overlay is TextOverlay =>
      overlay !== null && (isPersistent(overlay) || keepText(overlay, overlay.startOffsetSeconds, endOf(overlay, totalSeconds)))
  );
  const finalImages = arrangedImages.filter((image) =>
    keepImage(image, image.startOffsetSeconds, endOf(image, totalSeconds), isPersistent(image))
  );
  const finalClips = resultClips.map((clip, clipIndex) => ({
    ...clip,
    overlays: clip.overlays?.filter((overlay) => {
      const start = clipTimes[clipIndex] + overlay.startOffsetSeconds;
      return keepText(overlay, start, start + (overlay.durationInSeconds ?? clip.durationInSeconds - overlay.startOffsetSeconds));
    }),
    images: clip.images?.filter((image) => {
      const start = clipTimes[clipIndex] + image.startOffsetSeconds;
      return keepImage(image, start, start + (image.durationInSeconds ?? clip.durationInSeconds - image.startOffsetSeconds), false);
    }),
  }));
  if (dropped.length > 0) console.info(`[autoEditPlan] 字幕・顔に重なるため出さない物: ${dropped.join(" / ")}`);
  return { globalOverlays: finalGlobal, clips: finalClips, globalImages: finalImages };
};

/**
 * Geminiの編集案(生のJSON)を、プロジェクトにそのまま書き込める形に直す。足りない画像はここで作る。
 * 学習データの書き起こしも同じ形なので、手本がどう描かれるかの確認にも使える。
 */
export const finalizeAutoEditPlan = async (
  answer: RawAutoEditPlan,
  input: Pick<AutoEditPlanInput, "keepRanges" | "materialImages" | "generateMissingImages"> &
    Partial<Pick<AutoEditPlanInput, "maxGeneratedImages" | "title" | "template" | "onProgress" | "snapCut">>,
  options: { resolveImage?: ImageSourceResolver } = {}
): Promise<AutoEditPlan> => {
  // 字幕は話に合わせて必ず出すので、字幕と同じ文言の強調テキストは外す(同じ文字が二重に出るため)
  const { plan: data, removed: removedCaptionLike } = removeCaptionLikeOverlays(answer);
  if (removedCaptionLike > 0) console.info(`[autoEditPlan] 字幕と同じ文言の強調テキスト${removedCaptionLike}個を外しました`);
  const generatedImageSources = input.generateMissingImages
    ? await generateMissingImages(data, { ...input, maxGeneratedImages: input.maxGeneratedImages ?? MAX_GENERATED_IMAGES })
    : new Map<string, GeneratedImageSource>();
  input.onProgress?.({ stage: "finishing" });
  // 枠に入れる画像のうち、番号も作った画像も結び付かない物は、直前に大きく出していた画像を使う。
  // 枠用の画像を、大きく出した画像と違う説明・名前で書いてくることがあり、以前はそのまま別の画像として作ろうとして
  // (作る数の上限で)作られず、枠が空のままになっていた。
  const slotFallbackSrc = new WeakMap<RawAutoEditImage, string>();
  const resolveImageSrc: ImageSourceResolver = (raw) =>
    options.resolveImage?.(raw) ??
    findMaterialImage(raw, input.materialImages)?.path ??
    (raw.imageNumber == null ? generatedImageSources.get(generatedImageKey(raw))?.path : undefined) ??
    slotFallbackSrc.get(raw);
  let lastShownImageSrc: string | undefined;

  const rankSlots = findRankSlots(data);

  const clips: AutoEditClipPlan[] = [];
  // クリップの外まで出し続ける文字・画像(最後まで残す物、話題の間ずっと出す物)。
  // 出すクリップの完成動画上の開始秒に足して、全体の文字・画像へ移す。
  const liftedOverlays: NonNullable<RawAutoEditClip["overlays"]> = [];
  const liftedImages: RawAutoEditImage[] = [];
  // クリップに置いた図形(〇印など)は描画側にクリップごとの図形が無いので、すべて全体の図形へ移す。
  const liftedShapes: RawAutoEditShape[] = [];
  let outputStartSeconds = 0;
  for (const original of data.clips) {
    if (clips.length >= MAX_CLIPS) break;
    // カットの位置を音の切れ目へ寄せる。続けて使う区間どうし(前のクリップの終わり=次の頭)は同じ位置へ寄るので、間は空かない
    const raw = input.snapCut
      ? {
          ...original,
          sourceStartSeconds: input.snapCut(original.sourceStartSeconds),
          sourceEndSeconds: input.snapCut(original.sourceEndSeconds),
        }
      : original;
    const fitted = fitClipToKeepRanges(raw, input.keepRanges);
    if (!fitted) continue;
    const clipDuration = fitted.durationInSeconds;
    const overlays = (raw.overlays ?? []).map((overlay) => snapToRankSlots(overlay, rankSlots, "text"));
    const images = (raw.images ?? []).map((image) => snapToRankSlots(image, rankSlots, "image"));
    for (const image of images) {
      if (isSlotImage(image)) {
        if (lastShownImageSrc) slotFallbackSrc.set(image, lastShownImageSrc);
      } else {
        // 出せなかった画像(作る上限を超えた等)の後の枠に、その前の話題の画像が入らないよう、出せない時は空にする。
        lastShownImageSrc = resolveImageSrc(image);
      }
    }
    for (const overlay of overlays) {
      if (outlivesClip(overlay, clipDuration)) liftedOverlays.push(toWholeVideoTiming(overlay, outputStartSeconds, clipDuration));
    }
    for (const image of images) {
      if (!outlivesClip(image, clipDuration)) continue;
      const lifted = toWholeVideoTiming(image, outputStartSeconds, clipDuration);
      // 使い回す画像の結び付けは、全体へ移した後の物にも引き継ぐ
      const fallback = slotFallbackSrc.get(image);
      if (fallback) slotFallbackSrc.set(lifted, fallback);
      liftedImages.push(lifted);
      // 枠に入れる画像が出せない(作る上限を超えた等)なら、代わりに項目名の文字で枠を埋める(空の枠を残さない)。
      const name = image.name?.trim();
      if (isSlotImage(image) && !resolveImageSrc(lifted) && name && !overlays.some((overlay) => overlay.slotRank === image.slotRank)) {
        liftedOverlays.push(
          snapToRankSlots(
            {
              text: name,
              slotRank: image.slotRank,
              keepUntilEnd: true,
              startOffsetSeconds: lifted.startOffsetSeconds,
              fontSizePx: 56,
              color: "#FFFFFF",
              strokeColor: "#000000",
              animation: "pop",
              xPercent: lifted.xPercent,
              yPercent: lifted.yPercent,
            },
            rankSlots,
            "text"
          )
        );
      }
    }
    for (const shape of raw.shapes ?? []) {
      const lifted = toWholeVideoTiming(shape, outputStartSeconds, clipDuration);
      // 長さの指定が無ければ、そのクリップの終わりまで出す。
      liftedShapes.push(
        shape.keepUntilEnd || shape.durationInSeconds != null
          ? lifted
          : { ...lifted, durationInSeconds: Math.max(0.2, clipDuration - (shape.startOffsetSeconds ?? 0)) }
      );
    }
    outputStartSeconds += clipDuration;
    clips.push({
      ...fitted,
      // テロップは描画側で文節の切れ目で折り返すが、参考に合わせて意味の切れ目で2行にしたい時のために、
      // Geminiが入れた改行は最初の1つだけ残す(変な所の改行・短すぎる行はtidyLineBreaksで直す)。
      speechText: keepFirstLineBreak(tidyLineBreaks(raw.speech ?? "")),
      captionAnimation: (raw.captionAnimation ?? undefined) as CaptionAnimation | undefined,
      // テロップの強調語・クリップごとの書体や色は付けない(本人が後で選ぶ。途中でテロップの書体が変わらないように)。
      zoom: normalizeZoom(raw),
      faceBox: normalizeFace(raw.face),
      // 山場: AIが寄せたクリップ(AIが山場と判断した所)と、順位を発表したクリップ(枠を埋める物・順位の文字がある)
      cameraHighlight:
        Boolean(raw.zoom && raw.zoom.scale > 1.001) ||
        images.some(isSlotImage) ||
        overlays.some((overlay) => overlay.slotRank != null || rankOfLabel(overlay.text) !== null) ||
        undefined,
      overlays: normalizeOverlays(
        overlays.filter((overlay) => !outlivesClip(overlay, clipDuration)),
        clipDuration,
        MAX_CLIP_OVERLAYS
      ),
      images: normalizeImages(
        images.filter((image) => !outlivesClip(image, clipDuration)),
        clipDuration,
        MAX_CLIP_IMAGES,
        resolveImageSrc
      ),
      sfx: (raw.sfx ?? []).map((s) => ({
        presetId: s.presetId,
        offsetSeconds: clamp(s.offsetSeconds ?? 0, 0, Math.max(0, fitted.durationInSeconds - 0.1)),
      })),
    });
  }
  if (clips.length === 0) {
    throw new Error("Geminiの編集案に使えるクリップがありませんでした。もう一度お試しください");
  }
  // カメラワークは、動画の形式ごとのルールで決め直す(AIの寄りは山場の印として使う)。顔を避ける配置より先に決める
  // (寄ると顔の映る位置が変わるため)。
  const cameraRule = cameraRuleForTemplate(input.template?.id);
  applyCameraRule(cameraRule, clips).forEach((zoom, index) => {
    clips[index] = { ...clips[index], zoom };
  });

  const globalImages = linkImageMoves(
    normalizeImages(liftedImages, outputStartSeconds, MAX_GLOBAL_IMAGES, resolveImageSrc) ?? [],
    clips
  );
  const sourceByPath = new Map([...generatedImageSources.values()].map((entry) => [entry.path, entry.source]));
  const materialPaths = new Set(input.materialImages.map((image) => image.path));
  const usedSrcs = new Set([...globalImages, ...clips.flatMap((clip) => clip.images ?? [])].map((image) => image.src));
  const usedGeneratedPaths = new Set([...usedSrcs].filter((src) => sourceByPath.has(src)));
  const imageSources = {
    material: [...usedSrcs].filter((src) => materialPaths.has(src)).length,
    library: [...usedGeneratedPaths].filter((src) => sourceByPath.get(src) !== "generated").length,
    generated: [...usedGeneratedPaths].filter((src) => sourceByPath.get(src) === "generated").length,
  };

  // 左上のタイトル。本人が決めた文言があればそれを、無ければAIが決めた文言を、決まった形で置く。
  // AIがタイトルと同じ文言をglobalOverlaysにも書いてきたら(編集例の書き起こしを真似た等)、二重に出ないよう外す。
  const titleText = tidyLineBreaks(input.title?.trim() || data.title?.trim() || "");
  const titleComparable = comparableText(titleText);
  const isTitleCopy = (overlay: NonNullable<RawAutoEditPlan["globalOverlays"]>[number]) => {
    const text = comparableText(overlay.text.replace(/\\n/g, ""));
    return (
      titleComparable.length > 0 &&
      text.length >= 2 &&
      rankOfLabel(overlay.text) === null &&
      (overlay.startOffsetSeconds ?? 0) < 1 &&
      titleComparable.includes(text)
    );
  };
  const globalOverlays = linkTextMoves(
    normalizeOverlays(
      [...(data.globalOverlays ?? []).filter((overlay) => !isTitleCopy(overlay)), ...liftedOverlays],
      outputStartSeconds,
      MAX_GLOBAL_OVERLAYS
    ) ?? []
  );
  // 注意書きは、AIが描いた画像を使った時だけ(アイコン・国旗だけなら本物の写真と誤解されないので付けない)
  if ([...usedGeneratedPaths].some((src) => sourceByPath.get(src) !== "icon")) {
    // 注意書きは上限で切られないよう先頭に入れる。
    globalOverlays.unshift(GENERATED_IMAGE_NOTICE);
  }
  // タイトルは一番先に置く(重なりを避ける時に、ほかの文字の方をずらす)。
  if (titleText) globalOverlays.unshift(buildTitleOverlay(titleText));
  globalOverlays.splice(MAX_GLOBAL_OVERLAYS);

  // 冒頭の見出し・締めの一言が、すでに画面に出している文字(タイトル・最後のクリップの文字)と同じ内容なら出さない。
  // 同じ言葉が2か所に出ると読みにくいうえ、締めの一言は画面下の決まった位置に出るので、左に並べた枠などとも重なる。
  const repeatsShownText = (text: string, shownTexts: string[]): boolean => {
    const target = comparableText(text);
    return (
      target.length > 0 &&
      shownTexts.map(comparableText).some((shown) => shown.length >= 4 && (shown.includes(target) || target.includes(shown)))
    );
  };
  const hookHeadline = data.hook ? tidyLineBreaks(data.hook.headline) : "";
  const titleTexts = globalOverlays.filter((overlay) => overlay.startOffsetSeconds < 1).map((overlay) => overlay.text);
  const hook =
    hookHeadline && !repeatsShownText(hookHeadline, titleTexts)
      ? {
          headline: hookHeadline,
          subline: data.hook?.subline ? tidyLineBreaks(data.hook.subline) || undefined : undefined,
        }
      : null;
  // 冒頭の見出しの候補: おすすめ(hook)と別の案。タイトルと同じ言葉の案・同じ案は外す
  const hookCandidates = [hookHeadline, ...(data.hookAlternatives ?? []).map((text) => tidyLineBreaks(text))]
    .filter((text) => text.length > 0 && !repeatsShownText(text, titleTexts))
    .filter((text, index, all) => all.findIndex((other) => comparableText(other) === comparableText(text)) === index)
    .slice(0, MAX_HOOK_CANDIDATES);
  const ctaText = data.cta ? tidyLineBreaks(data.cta.text) : "";
  const endingTexts = clips.slice(-3).flatMap((clip) => (clip.overlays ?? []).map((overlay) => overlay.text));
  const cta = ctaText && !repeatsShownText(ctaText, endingTexts) ? { text: ctaText } : null;

  // 省いた見た目の引き継ぎ(normalizeShapes)は、ずっと出す枠とクリップの〇印のように役割の違う図形の間では行わない。
  const globalShapes = mergeFlickeringMarks([
    ...normalizeShapes(data.globalShapes, outputStartSeconds),
    ...normalizeShapes(liftedShapes, outputStartSeconds),
  ]).slice(0, MAX_GLOBAL_SHAPES);
  const framing = normalizeFraming(data.framing);
  const theme = data.theme ?? {};
  // 文字どうし・字幕と顔・字幕と文字が重ならないように、ずっと出る文字→字幕→残りの文字の順に置く(必ず守る決まり)
  const arranged = avoidTextOverlaps(globalOverlays, clips, globalShapes, globalImages, outputStartSeconds, framing, {
    position: (theme.captionPosition ?? "bottom") as CaptionPosition,
    style: (theme.captionStyle ?? "pill") as CaptionStyle,
    fontSize: (theme.captionFontSize ?? "medium") as CaptionFontSize,
  });
  const arrangedClips = arranged.clips;
  return {
    summary: data.summary,
    referenceNotes: data.referenceNotes?.trim() || null,
    theme: {
      primaryColor: hexOrUndefined(theme.primaryColor),
      // 字幕の書体は本人が決めた物を動画全体で使う(AIには選ばせない)
      fontFamily: undefined,
      captionPosition: (theme.captionPosition ?? undefined) as CaptionPosition | undefined,
      captionStyle: (theme.captionStyle ?? undefined) as CaptionStyle | undefined,
      captionFontSize: (theme.captionFontSize ?? undefined) as CaptionFontSize | undefined,
    },
    hook,
    hookCandidates,
    cta,
    globalOverlays: arranged.globalOverlays,
    globalImages: arranged.globalImages,
    globalShapes,
    showCaptions: Boolean(data.showCaptions),
    framing,
    generatedImageCount: usedGeneratedPaths.size,
    imageSources,
    clips: arrangedClips,
    rawPlan: data,
  };
};

/** 枠の順位を聞き直す軽いモデル(書き起こしの文字を読むだけなので、Proでなくてよい)。 */
const RANK_FILL_MODEL = "gemini-flash-latest";

const rankAnswerSchema = z.object({
  items: z.array(z.object({ topic: z.number().int(), rank: z.number().int().nullable(), clip: z.number().int().nullable() })),
});

/**
 * ランキングの枠をずっと出しているのに、話題ごとに大きく出した画像が枠に入っていない(枠に入れる画像を書き忘れた)答えのとき、
 * 書き起こしから「どの話題が何位で、どのクリップで発表されたか」を軽いモデルに聞き、その話題の画像を枠に入れる。
 * 本番で、同じ依頼でも枠に入れる画像を丸ごと書かない答えが返り、枠が最後まで空のままになったため。
 * 失敗しても自動編集は止めない(元の答えのまま返す)。
 */
export const fillMissingRankImages = async (ai: GoogleGenAI, data: RawAutoEditPlan): Promise<RawAutoEditPlan> => {
  const rankCount = (data.globalOverlays ?? []).filter((overlay) => rankOfLabel(overlay.text) !== null).length;
  if (rankCount < 2) return data;
  const topics = data.clips.flatMap((clip, clipIndex) =>
    (clip.images ?? []).filter((image) => !isSlotImage(image) && !image.keepUntilEnd).map((image) => ({ image, clipIndex }))
  );
  // 同じ画像を何度も出していても、話題としては1つにまとめる
  const uniqueTopics = topics.filter(
    (topic, index) => topics.findIndex((other) => generatedImageKey(other.image) === generatedImageKey(topic.image)) === index
  );
  const filled = new Set(
    data.clips.flatMap((clip) =>
      (clip.images ?? []).filter((image) => isSlotImage(image) || image.keepUntilEnd).map((image) => generatedImageKey(image))
    )
  );
  const missing = uniqueTopics.filter((topic) => !filled.has(generatedImageKey(topic.image)));
  if (missing.length === 0) return data;

  const transcript = data.clips.map((clip, index) => `${index}: ${(clip.speech ?? "").replace(/\n/g, "")}`).join("\n");
  const topicList = missing
    .map((topic, index) => `${index}: ${topic.image.name ?? ""} ${topic.image.description}(クリップ${topic.clipIndex}から話し始める)`)
    .join("\n");
  try {
    const response = await runWithGeminiRateLimit(() =>
      ai.models.generateContent({
        model: RANK_FILL_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `ランキング形式のショート動画の書き起こし(クリップ番号: 話している言葉)と、話題の一覧です。
各話題が何位と発表されたか(rank)と、その順位を言ったクリップの番号(clip)を答えてください。
順位がはっきり言われていない話題はrankとclipをnullにしてください。

## 書き起こし
${transcript}

## 話題
${topicList}`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    topic: { type: Type.INTEGER },
                    rank: { type: Type.INTEGER, nullable: true },
                    clip: { type: Type.INTEGER, nullable: true },
                  },
                  required: ["topic", "rank", "clip"],
                },
              },
            },
            required: ["items"],
          },
        },
      })
    );
    const parsed = rankAnswerSchema.safeParse(JSON.parse(response.text ?? "{}"));
    if (!parsed.success) throw new Error("順位の答えを読み取れませんでした");
    const clips = data.clips.map((clip) => ({ ...clip, images: [...(clip.images ?? [])] }));
    let added = 0;
    for (const item of parsed.data.items) {
      const topic = missing[item.topic];
      if (!topic || item.rank == null || item.clip == null) continue;
      // 発表は話し始めより後のはず。範囲外のクリップ番号は、話し始めのクリップに丸める
      const clipIndex = Math.min(Math.max(item.clip, topic.clipIndex), clips.length - 1);
      clips[clipIndex].images.push({
        ...topic.image,
        startOffsetSeconds: 0,
        durationInSeconds: null,
        keepUntilEnd: true,
        slotRank: item.rank,
      });
      added++;
    }
    console.info(`[autoEditPlan] 枠に入っていなかった${missing.length}件のうち${added}件を、順位を聞き直して枠に入れました`);
    return { ...data, clips };
  } catch (error) {
    console.warn("[autoEditPlan] 枠の順位の聞き直しに失敗したため、そのまま使います", error);
    return data;
  }
};

const markAnswerSchema = z.object({
  items: z.array(z.object({ mark: z.number().int(), side: z.string().nullable() })),
});

/** ずっと出しているカード(比べる物を並べる箱)と、その中に書いてある名前。 */
const findComparisonCards = (data: RawAutoEditPlan): { label: string; xPercent: number; yPercent: number }[] => {
  const persistentTexts = (data.globalOverlays ?? []).filter(
    (overlay) => overlay.xPercent != null && overlay.yPercent != null && (overlay.durationInSeconds == null || overlay.durationInSeconds > 20)
  );
  const cards: { label: string; xPercent: number; yPercent: number }[] = [];
  // 2つ目以降のカードは大きさを省いて書かれることがあるので、大きさまで書いてあるカードから引き継ぐ
  const sized = (data.globalShapes ?? []).find((shape) => shape.widthPercent != null && shape.heightPercent != null);
  for (const shape of data.globalShapes ?? []) {
    if ((shape.kind ?? "rect") !== "rect" || shape.xPercent == null || shape.yPercent == null) continue;
    const width = shape.widthPercent ?? sized?.widthPercent ?? 0;
    const height = shape.heightPercent ?? sized?.heightPercent ?? 0;
    if (width < 15 || height < 8) continue;
    const label = persistentTexts.find(
      (text) =>
        Math.abs(text.xPercent! - shape.xPercent!) <= width / 2 &&
        Math.abs(text.yPercent! - shape.yPercent!) <= height / 2 &&
        rankOfLabel(text.text) === null
    );
    if (label) cards.push({ label: label.text.replace(/\n/g, ""), xPercent: shape.xPercent, yPercent: shape.yPercent });
  }
  return cards;
};

/**
 * 比べる動画で、結論の所に付ける〇印を、話の中身どおりの側に付け直す。Geminiは手本の〇の位置をそのまま真似して、
 * 話と逆の側(「保証は日本が安心」なのに韓国)に付けることがあったため、〇を付けたクリップごとに、
 * 書き起こしから「話し手がどちらを良いと言ったか」だけを軽いモデルに聞き直し、その側のカードへ動かす
 * (どちらとも言っていなければ〇を外す)。失敗しても自動編集は止めない。
 */
export const verifyComparisonMarks = async (
  ai: GoogleGenAI,
  data: RawAutoEditPlan,
  userNotes = ""
): Promise<RawAutoEditPlan> => {
  const cards = findComparisonCards(data);
  if (cards.length < 2) return data;
  const marks = data.clips.flatMap((clip, clipIndex) =>
    (clip.shapes ?? []).map((shape, shapeIndex) => ({ clipIndex, shapeIndex, shape })).filter(({ shape }) => shape.kind === "circle")
  );
  if (marks.length === 0) return data;

  const transcript = data.clips.map((clip, index) => `${index}: ${(clip.speech ?? "").replace(/\n/g, "")}`).join("\n");
  const markList = marks.map((mark, index) => `${index}: クリップ${mark.clipIndex}`).join("\n");
  const labels = cards.map((card) => card.label);
  try {
    const response = await runWithGeminiRateLimit(() =>
      ai.models.generateContent({
        model: RANK_FILL_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `「${labels.join("」と「")}」を比べるショート動画の書き起こし(クリップ番号: 話している言葉)です。
次の各クリップの時点で、話し手が今の項目について「${labels.join("」「")}」のどちらの方が良い(勝ち)と言ったかを答えてください。
そのクリップの前後の話の流れから判断し、どちらとも言っていない・判断できないならsideをnullにしてください。
sideは「${labels.join("」「")}」のどれかをそのまま書いてください。

## 書き起こし
${transcript}

## 確かめるクリップ
${markList}${
                  userNotes
                    ? `

## 本人からの指示(〇の付け方について書いてあれば、話の流れより優先してそのとおりに答える)
${userNotes}`
                    : ""
                }`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: { mark: { type: Type.INTEGER }, side: { type: Type.STRING, nullable: true } },
                  required: ["mark", "side"],
                },
              },
            },
            required: ["items"],
          },
        },
      })
    );
    const parsed = markAnswerSchema.safeParse(JSON.parse(response.text ?? "{}"));
    if (!parsed.success) throw new Error("〇印の答えを読み取れませんでした");
    const clips = data.clips.map((clip) => ({ ...clip, shapes: clip.shapes ? [...clip.shapes] : clip.shapes }));
    const removed = new Set<string>();
    let moved = 0;
    for (const item of parsed.data.items) {
      const mark = marks[item.mark];
      if (!mark) continue;
      const card = item.side ? cards.find((candidate) => candidate.label === item.side!.trim()) : undefined;
      if (!card) {
        removed.add(`${mark.clipIndex}:${mark.shapeIndex}`);
        continue;
      }
      if (mark.shape.xPercent == null || Math.abs(mark.shape.xPercent - card.xPercent) > 10) moved++;
      clips[mark.clipIndex].shapes![mark.shapeIndex] = { ...mark.shape, xPercent: card.xPercent, yPercent: card.yPercent };
    }
    clips.forEach((clip, clipIndex) => {
      if (clip.shapes) clip.shapes = clip.shapes.filter((_, shapeIndex) => !removed.has(`${clipIndex}:${shapeIndex}`));
    });
    console.info(`[autoEditPlan] 〇印${marks.length}個を話の中身で確かめ、${moved}個を反対側へ動かし、${removed.size}個を外しました`);
    return { ...data, clips };
  } catch (error) {
    console.warn("[autoEditPlan] 〇印の確かめ直しに失敗したため、そのまま使います", error);
    return data;
  }
};

/** 同じ場所の〇印が、少しだけ消えてまた出る(ちらつく)時は、1つにつなげる。 */
const MARK_MERGE_GAP_SECONDS = 3;

const mergeFlickeringMarks = (shapes: ShapeOverlay[]): ShapeOverlay[] => {
  const circles = shapes.filter((shape) => shape.kind === "circle").sort((a, b) => a.startOffsetSeconds - b.startOffsetSeconds);
  const merged: ShapeOverlay[] = [];
  for (const circle of circles) {
    const previous = merged[merged.length - 1];
    const previousEnd = previous?.durationInSeconds !== undefined ? previous.startOffsetSeconds + previous.durationInSeconds : Infinity;
    if (
      previous &&
      Math.abs(previous.xPercent - circle.xPercent) < 1 &&
      Math.abs(previous.yPercent - circle.yPercent) < 1 &&
      circle.startOffsetSeconds - previousEnd <= MARK_MERGE_GAP_SECONDS
    ) {
      const end = circle.durationInSeconds !== undefined ? circle.startOffsetSeconds + circle.durationInSeconds : Infinity;
      const newEnd = Math.max(previousEnd, end);
      merged[merged.length - 1] = {
        ...previous,
        durationInSeconds: Number.isFinite(newEnd) ? newEnd - previous.startOffsetSeconds : undefined,
      };
    } else {
      merged.push(circle);
    }
  }
  return [...shapes.filter((shape) => shape.kind !== "circle"), ...merged];
};

/** 自動編集の案を最大いくつ作るか(1か2)。2なら、1案目が良くなかった時だけ2案目を作る。 */
const AUTO_EDIT_CANDIDATES = Math.min(2, Math.max(1, Number(process.env.AUTO_EDIT_CANDIDATES) || 2));
/**
 * 1案目の手本との近さ(similarityToExamples)がこれ以上なら、2案目を作らずに使う。
 * 以前は毎回2案を同時に作っていたが、7回中5回は1案目が満点(1.00)で、2案目の料金が無駄になっていた。
 */
const GOOD_ENOUGH_SIMILARITY = 0.95;

/** Geminiに編集案を1つ作らせ、生のJSONのまま返す。混雑などの一時的な失敗は少し待ってやり直す。 */
const requestRawPlan = async (
  ai: GoogleGenAI,
  model: string,
  contents: Content[],
  lane: GeminiRateLimitLane,
  label: string,
  timeoutMs: number = GEMINI_TIMEOUT_MS
): Promise<RawAutoEditPlan> => {
  let lastError: unknown;
  let lastText = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // 少しずつ受け取る形(stream)で頼む。まとめて受け取る形だと、Geminiが考え込んで5分以上何も返さない時に
      // Node.jsの通信が「応答が来ない」として打ち切ってしまい(HeadersTimeoutError)、案が作れないことがあった。
      const response = await runWithGeminiRateLimit(() => {
        // 時間切れの時は通信も打ち切る(止まった答えを裏で待ち続けないように)
        const controller = new AbortController();
        let rejectTimeout: (error: Error) => void = () => {};
        const timeoutPromise = new Promise<never>((_, reject) => {
          rejectTimeout = reject;
        });
        const fail = (message: string) => {
          controller.abort();
          rejectTimeout(new Error(message));
        };
        const overallTimer = setTimeout(() => fail("Gemini API timeout"), timeoutMs);
        let stallTimer: NodeJS.Timeout | undefined;
        const startedAt = Date.now();
        const generatePromise = (async () => {
          const stream = await ai.models.generateContentStream({
            model,
            contents,
            config: {
              responseMimeType: "application/json",
              responseSchema: autoEditResponseSchema,
              abortSignal: controller.signal,
              // 普通の答えは3千〜1万トークン。同じ物を書き続ける暴走(5万トークン超)で10分以上かかり時間切れになっていたので、
              // 上限で止めて(形が崩れた扱いになり)1回だけ頼み直す
              maxOutputTokens: MAX_PLAN_OUTPUT_TOKENS,
            },
          });
          let text = "";
          let last: GenerateContentResponse | undefined;
          for await (const chunk of stream) {
            if (!last) console.info(`[autoEditPlan] ${label}: ${Math.round((Date.now() - startedAt) / 1000)}秒で答えが届き始めました`);
            clearTimeout(stallTimer);
            stallTimer = setTimeout(() => fail("Gemini API timeout(途中で止まった)"), GEMINI_STALL_MS);
            text += chunk.text ?? "";
            last = chunk;
            if (isRepeating(text)) fail("Gemini API timeout(同じ物の繰り返し)");
          }
          return { text, usage: last?.usageMetadata, modelVersion: last?.modelVersion };
        })();
        return Promise.race([generatePromise, timeoutPromise]).finally(() => {
          clearTimeout(overallTimer);
          clearTimeout(stallTimer);
        });
      }, lane);

      // 1回あたりの消費量をサーバーログで追えるようにしておく(残高切れの前に重さに気づけるように)。
      const usage = response.usage;
      console.info(
        `[autoEditPlan] ${label} model=${response.modelVersion ?? model} 入力${usage?.promptTokenCount ?? "?"}トークン` +
          ` 出力${usage?.candidatesTokenCount ?? "?"}トークン 思考${usage?.thoughtsTokenCount ?? "?"}トークン`
      );

      const text = response.text;
      lastText = text;
      if (!text) {
        throw new Error("Gemini APIから空の応答が返されました");
      }
      const parsed = rawAutoEditPlanSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        throw new Error(`Gemini応答のスキーマ検証に失敗: ${parsed.error.message}`);
      }
      return parsed.data;
    } catch (error) {
      lastError = error;
      // 答えの形が崩れた(JSONが途中で切れた等)時は、1回だけ頼み直す(たまに起き、頼み直せばほぼ直るため)
      const malformed =
        error instanceof SyntaxError ||
        (error instanceof Error && (error.message.includes("スキーマ検証に失敗") || error.message.includes("同じ物の繰り返し")));
      if (malformed && lastText && process.env.AUTO_EDIT_DEBUG_DIR) {
        // 調整用: 形が崩れた答えを残す(どの項目で崩れたかを確かめるため)
        await writeFile(path.join(process.env.AUTO_EDIT_DEBUG_DIR, `malformed-${Date.now()}.txt`), lastText).catch(() => {});
      }
      if (malformed && attempt === 1) {
        console.warn(`[autoEditPlan] ${label}: 答えの形が崩れていたため、もう一度頼みます`, error);
        continue;
      }
      if (isRetryableApiError(error) && attempt < MAX_ATTEMPTS) {
        const delayMs = RETRY_BASE_DELAY_MS * attempt;
        console.warn(`[autoEditPlan] ${label}: Geminiが混雑しているため${delayMs}ms後に再試行します(試行${attempt}/${MAX_ATTEMPTS})`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

/**
 * 手本の書き起こしから、この編集者の「入れ方の癖」(1分あたりの量と、何を同時に入れているか)を数えて、
 * 具体的な目安の文章にする。書き起こしのJSONを見せるだけでは、AIが量やリズムを真似せず、
 * 「全部の文に強調と効果音を付ける」「順位の発表で寄らない」など、正解から大きく外れていたため。
 */
export const describeExampleRhythm = (label: string, plan: RawAutoEditPlan): string => {
  const minutes = Math.max(0.25, plan.clips.reduce((sum, clip) => sum + Math.max(0, clip.sourceEndSeconds - clip.sourceStartSeconds), 0) / 60);
  const times = { overlay: [] as number[], sfx: [] as number[], zoom: [] as number[], image: [] as number[] };
  const overlaySizes: number[] = [];
  const overlayYs: number[] = [];
  const zoomScales: number[] = [];
  for (const clip of plan.clips) {
    const start = clip.sourceStartSeconds;
    for (const overlay of clip.overlays ?? []) {
      times.overlay.push(start + (overlay.startOffsetSeconds ?? 0));
      if (overlay.fontSizePx) overlaySizes.push(overlay.fontSizePx);
      if (overlay.yPercent !== null && overlay.yPercent !== undefined) overlayYs.push(overlay.yPercent);
    }
    for (const effect of clip.sfx ?? []) times.sfx.push(start + (effect.offsetSeconds ?? 0));
    for (const image of clip.images ?? []) times.image.push(start + (image.startOffsetSeconds ?? 0));
    if (clip.zoom && clip.zoom.scale > 1.001) {
      times.zoom.push(start);
      zoomScales.push(clip.zoom.scale);
    }
  }
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  };
  const rate = (count: number) => (count / minutes).toFixed(1);
  const near = (from: number[], to: number[], tolerance = 0.6) =>
    from.length ? Math.round((from.filter((t) => to.some((u) => Math.abs(t - u) <= tolerance)).length / from.length) * 100) : 0;
  const lines = [
    `- 手本「${label}」(約${Math.round(minutes * 60)}秒・${plan.clips.length}クリップ):`,
    `  強調テキスト${times.overlay.length}個(1分あたり${rate(times.overlay.length)}個` +
      (overlaySizes.length ? `、大きさは${Math.round(median(overlaySizes)!)}px前後、縦の位置は${Math.round(median(overlayYs) ?? 50)}%前後` : "") +
      `)・効果音${times.sfx.length}個(1分あたり${rate(times.sfx.length)}個)・寄り${times.zoom.length}回(1分あたり${rate(times.zoom.length)}回` +
      (zoomScales.length ? `、${median(zoomScales)!.toFixed(2)}倍前後` : "") +
      `)・画像${times.image.length}枚・ずっと出す文字${plan.globalOverlays?.length ?? 0}個・枠の図形${plan.globalShapes?.length ?? 0}個。` +
      `字幕の位置は${{ top: "上部", middle: "中央", bottom: "下部" }[plan.theme?.captionPosition ?? ""] ?? "(不明)"}` +
      `・大きさは${plan.theme?.captionFontSize ?? "(不明)"}(themeをこれに合わせる)。`,
  ];
  if (times.zoom.length > 0) {
    lines.push(`  寄りのうち${near(times.zoom, times.sfx)}%は同じ瞬間に効果音、${near(times.zoom, times.overlay)}%は同じ瞬間に強調テキスト${times.image.length ? `、${near(times.zoom, times.image)}%は画像` : ""}が出る。`);
  }
  if (times.sfx.length > 0) {
    lines.push(`  効果音のうち${near(times.sfx, times.overlay)}%は強調テキストが出る瞬間、${near(times.sfx, times.zoom)}%は寄る瞬間${times.image.length ? `、${near(times.sfx, times.image)}%は画像が出る瞬間` : ""}に鳴らしている(それ以外の所では鳴らしていない)。`);
  }
  return lines.join("\n");
};

/**
 * 手本の編集者の「編集のクセ帳」(scripts/eval/build-style-guide.ts で、手本の完成動画と書き起こしから作った文章)。
 * 量を合わせるより、この編集者が場面をどう見せるかというクセと雰囲気を真似させるため、毎回見せる。無ければ空。
 */
const STYLE_GUIDE_PATH = path.join(process.cwd(), "data", "edit-examples", "style-guide.md");
const loadStyleGuide = (): Promise<string> => readFile(STYLE_GUIDE_PATH, "utf8").then((text) => text.trim(), () => "");

const buildStyleGuideSection = (guide: string): string =>
  guide
    ? `

## 編集のクセ帳(この編集者になりきって、どう見せるかを決める)
次は、この投稿者の動画を編集している編集者のクセと雰囲気をまとめた物です。本人の動画の中身に合わせて、
「この編集者なら、この場面をこう見せる」という判断に使ってください。本人の動画に無い場面の見せ方は使わない。
例として出てくる文言(項目名・国名など)は別の動画の物なので、持ち込まない。
上の「絶対の決まり」と「医療広告の決まり」とぶつかる所は、そちらを優先する。

${guide}`
    : "";

/** 手本の癖の目安の節。近い手本ほど後ろに置く(最後が一番近い)。 */
const buildRhythmSection = (examples: { label: string; breakdown?: RawAutoEditPlan }[]): string => {
  const described = examples.flatMap((example) => (example.breakdown ? [describeExampleRhythm(example.label, example.breakdown)] : []));
  if (described.length === 0) return "";
  return `

## 近い手本の入れ方(書き起こしから数えた実際の様子。数をそろえる必要は無いが、密度・リズムの目安にする)
この編集者が、どういう瞬間に何を組み合わせているかの参考にする(一番最後に書いた手本が今回の動画に一番近い)。
数を合わせるのではなく、本人の動画の中身に合わせて、同じような瞬間に同じような組み合わせで入れる。
${described.join("\n")}`;
};

const countImages = (plan: RawAutoEditPlan): number =>
  plan.clips.reduce((sum, clip) => sum + (clip.images?.length ?? 0), 0);

/** 編集案の「要素ごとの量」。手本と比べて、要素を丸ごと出し忘れていないかを見るのに使う。 */
const elementCounts = (plan: RawAutoEditPlan): Record<string, number> => {
  const images = plan.clips.flatMap((clip) => clip.images ?? []);
  return {
    framing: plan.framing && plan.framing.scale > 1.001 ? 1 : 0,
    shapes: plan.globalShapes?.length ?? 0,
    globalOverlays: plan.globalOverlays?.length ?? 0,
    overlays: plan.clips.reduce((sum, clip) => sum + (clip.overlays?.length ?? 0), 0),
    images: images.length,
    keptImages: images.filter((image) => image.keepUntilEnd).length,
    zooms: plan.clips.filter((clip) => clip.zoom && clip.zoom.scale > 1.001).length,
  };
};

/**
 * 編集案が、編集例の書き起こしにどれだけ近いか(0〜1)。手本にある要素ごとに「量の近さ」を平均する。
 * 手本に無い要素は比べない(必要な所だけ入れる方針なので、手本より少ないこと自体は悪くないが、
 * 手本にある要素を丸ごと出していない案は大きく下がる)。手本が無ければ全部同点(先に頼んだ案を使う)。
 */
export const similarityToExamples = (plan: RawAutoEditPlan, breakdowns: RawAutoEditPlan[]): number => {
  if (breakdowns.length === 0) return 0;
  const counts = elementCounts(plan);
  const perExample = breakdowns.map((breakdown) => {
    const expected = elementCounts(breakdown);
    const keys = Object.keys(expected).filter((key) => expected[key] > 0);
    if (keys.length === 0) return 0;
    const closeness = keys.map((key) => Math.min(counts[key], expected[key]) / Math.max(counts[key], expected[key]));
    return closeness.reduce((sum, value) => sum + value, 0) / keys.length;
  });
  return Math.max(...perExample);
};

/** 使える画像を、番号と名前付きでGeminiに渡すパーツにする。何が写っているか分かれば足りるので、中くらいの解像度で渡す。 */
const buildMaterialImageParts = async (materialImages: ResolvedMaterialImage[]): Promise<Part[]> => {
  const parts: Part[] = [];
  if (materialImages.length === 0) return parts;
  parts.push({ text: `【使える画像】(${materialImages.length}枚。imagesではこの番号で指定する)` });
  for (const [index, image] of materialImages.entries()) {
    parts.push({ text: `画像${index + 1}: ${image.name || "(名前なし。何が写っているかは画像を見て判断する)"}` });
    parts.push({
      inlineData: { mimeType: image.mimeType, data: (await readFile(image.absolutePath)).toString("base64") },
      mediaResolution: { level: PartMediaResolutionLevel.MEDIA_RESOLUTION_MEDIUM },
    });
  }
  return parts;
};

/** 本人が書いた要望と手直しの指示をまとめる(〇印の確かめ直しなど、後の補正でも指示を優先するため)。 */
const userNotesOf = (input: AutoEditPlanInput): string =>
  [input.userRequest?.trim(), input.revision?.instruction.trim()].filter(Boolean).join("\n");

/**
 * 手直し: 前回の案と「ここを直して」の指示を渡し、言われた所だけ変えさせる。案は1つだけ作る
 * (前回の案が土台なので、手抜きの答えが混ざる心配が小さい)。手本選び・編集例は前回の案に反映済みなので省く。
 */
const reviseAutoEditPlan = async (
  ai: GoogleGenAI,
  model: string,
  input: AutoEditPlanInput,
  revision: NonNullable<AutoEditPlanInput["revision"]>,
  uploadedFileNames: string[]
): Promise<AutoEditPlan> => {
  input.onProgress?.({ stage: "reading" });
  const videoPart = await uploadFileAsPart(ai, input.video.absolutePath, input.video.mimeType, uploadedFileNames);
  const materialImageParts = await buildMaterialImageParts(input.materialImages);
  input.onProgress?.({ stage: "planning" });
  const revisionText = `【前回の編集案】(あなたが前回この動画のために作った答えのJSON)
${JSON.stringify(revision.previousPlan, roundNumbers)}

【本人からの手直しの指示】
${revision.instruction.trim()}

前回の編集案を、手直しの指示どおりに直してください。
- 指示に関係する所だけを変える。それ以外(クリップの切り方・秒数・文字・位置・色・画像・図形・効果音など)は、
  前回の値のまま1つも変えずに返す
- 指示が話の中身や時刻に関わるときは、添付した本人の動画を見て判断する
- 答えは前回と同じJSONの形で、省略せずに全体を返す`;
  const contents: Content[] = [
    {
      role: "user",
      parts: [
        ...materialImageParts,
        { text: "【今回編集する本人の動画】" },
        videoPart,
        { text: buildPrompt(input, false) },
        { text: revisionText },
      ],
    },
  ];
  const revised = await requestRawPlan(ai, model, contents, "text", "手直し");
  return finalizeAutoEditPlan(
    await verifyComparisonMarks(ai, await fillMissingRankImages(ai, revised), userNotesOf(input)),
    input
  );
};

/**
 * 本人の動画・参考スクショ/動画・編集例(学習動画+正解動画のペア)をGeminiに見せ、切り方・寄り・
 * 強調テキスト・効果音・フック・CTA・全体の見た目まで(AIナレーションは付けない)、編集の判断をすべて任せる。
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
    if (input.revision) return await reviseAutoEditPlan(ai, model, input, input.revision, uploadedFileNames);
    input.onProgress?.({ stage: "reading" });

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
    // 選んだ結果は近い順なので、逆にして一番近い手本を本人の動画の直前に置く(直前に見た物に一番引っ張られるため)。
    input.onProgress?.({ stage: "examples" });
    const examples = await ensureEditExampleBreakdowns(await selectEditExamples(ai, videoPart, input.excludeExampleIds));
    const fewShot = await loadEditFewShotContext(ai, [...examples].reverse());
    uploadedFileNames.push(...fewShot.uploadedFileNames);
    contents.push(...fewShot.contents);

    // 3. 使える画像(あれば)+本人の動画+依頼文。
    const materialImageParts = await buildMaterialImageParts(input.materialImages);
    const styleGuide = await loadStyleGuide();
    const prompt = buildPrompt(input, fewShot.contents.length > 0) + buildStyleGuideSection(styleGuide) + buildRhythmSection([...examples].reverse());
    contents.push({
      role: "user",
      parts: [...materialImageParts, { text: "【今回編集する本人の動画】" }, videoPart, { text: prompt }],
    });

    // 同じ依頼でも、要素(枠の図形・最後まで残す画像など)を丸ごと出し忘れた手抜きの答えが混ざる。
    // まず1案作り、失敗したか編集例の書き起こしから遠い時だけ2案目を作って、近い方を選ぶ(料金は作った案の数だけかかる)。
    // 2案目は同じ入力を送るので、Geminiの暗黙のキャッシュが効いて入力の料金も安くなる。
    input.onProgress?.({ stage: "planning" });
    const breakdowns = examples.flatMap((example) => (example.breakdown ? [example.breakdown] : []));
    const scored: { candidate: RawAutoEditPlan; score: number }[] = [];
    let firstError: unknown;
    for (let index = 0; index < AUTO_EDIT_CANDIDATES; index++) {
      if (index > 0) {
        const previous = scored[scored.length - 1];
        // 手本が無いと近さを測れないので、1案目が作れていればそれを使う。
        if (previous && (breakdowns.length === 0 || previous.score >= GOOD_ENOUGH_SIMILARITY)) break;
        console.info(
          `[autoEditPlan] ${previous ? `1案目の手本との近さが${previous.score.toFixed(2)}だった` : "1案目が作れなかった"}ため、2案目を作ります`
        );
      }
      try {
        const candidate = await requestRawPlan(
          ai,
          model,
          contents,
          "text",
          `案${index + 1}`,
          scored.length > 0 ? SECOND_PLAN_TIMEOUT_MS : GEMINI_TIMEOUT_MS
        );
        scored.push({ candidate, score: similarityToExamples(candidate, breakdowns) });
      } catch (error) {
        console.warn(`[autoEditPlan] 案${index + 1}の作成に失敗しました`, error);
        firstError ??= error;
      }
    }
    if (scored.length === 0) {
      throw toFriendlyGeminiError(firstError);
    }
    const candidates = scored.map((entry) => entry.candidate);
    // 調整用: AUTO_EDIT_DEBUG_DIRを指定すると、Geminiの生の答えをそこへ保存する(丸め込みで何を捨てたかを確かめる時に使う)。
    if (process.env.AUTO_EDIT_DEBUG_DIR) {
      for (const [index, candidate] of candidates.entries()) {
        await writeFile(
          path.join(process.env.AUTO_EDIT_DEBUG_DIR, `auto-edit-raw-${index + 1}.json`),
          JSON.stringify(candidate, null, 2)
        ).catch(() => {});
      }
    }
    const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
    console.info(
      `[autoEditPlan] ${candidates.length}案の手本との近さ: ${scored.map((s) => s.score.toFixed(2)).join(" / ")} → ${best.score.toFixed(2)}の案を使う`
    );

    const plan = await finalizeAutoEditPlan(
      await verifyComparisonMarks(ai, await fillMissingRankImages(ai, best.candidate), userNotesOf(input)),
      input
    );
    // Geminiが出した数と、丸め込み後に残った数。形の崩れた要素を捨てすぎていないかをログで追えるようにする。
    console.info(
      `[autoEditPlan] 図形${best.candidate.globalShapes?.length ?? 0}→${plan.globalShapes.length}` +
        ` 全体の文字${best.candidate.globalOverlays?.length ?? 0}→${plan.globalOverlays.length}` +
        ` 画像${countImages(best.candidate)}→` +
        `${plan.globalImages.length + plan.clips.reduce((sum, clip) => sum + (clip.images?.length ?? 0), 0)}`
    );
    return plan;
  } finally {
    for (const name of uploadedFileNames) {
      await ai.files.delete({ name }).catch(() => {});
    }
  }
};
