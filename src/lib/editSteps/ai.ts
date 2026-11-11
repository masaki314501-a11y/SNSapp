import { GoogleGenAI, Type, type Part, type Schema } from "@google/genai";
import { z } from "zod";
import {
  CAPTION_ANIMATION_OPTIONS,
  CAPTION_FONT_FAMILY_OPTIONS,
  type CaptionAnimation,
  type CaptionFontFamily,
  type FaceBox,
} from "@video/shared/schema";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runWithGeminiRateLimit } from "@/lib/gemini/rateLimiter";
import { isRetryableApiError, toFriendlyGeminiError } from "@/lib/gemini/geminiErrors";
import { uploadGeminiFile, waitForGeminiFileActive } from "@/lib/gemini/geminiFiles";
import { editExampleMediaPath, uploadExampleVideo, type EditExample } from "@/lib/gemini/editExamplesStore";
import { selectEditExamples } from "@/lib/gemini/editExampleSelection";
import { sanitizeSvgFragment, type FigureLayer } from "./figure";
import type { ObjectLayout } from "./logic";

/**
 * 工程ごとの編集(編集マニュアルの1〜11)のうち、AIに頼む工程(3・6・8・10)。
 * まとめて全部を頼むと工程ごとの誤差が大きかったため、1回に1つのことだけを、短い指示文で頼む。
 * 工程9(テロップ入力)は、今ある文字起こし(transcribeCaptions)を使う。
 */

/** 判断のいる工程(3・8・10)のモデル。顔の位置(6)は軽いモデルで足りる。 */
const STEP_MODEL = process.env.GEMINI_STEP_MODEL || "gemini-pro-latest";
const FACE_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
/** 1回の答えを待つ時間。答えが詰まって返ってこないことがあるので、長く待たずに頼み直す。 */
const TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 3;

const client = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEYが未設定です");
  return new GoogleGenAI({ apiKey });
};

/**
 * 同じ動画を工程ごとに何度もアップロードしないよう、アップロードした動画を覚えておく(Geminiの側では48時間残る)。
 * サーバーが再起動すれば消えるが、その時はアップロードし直すだけ。
 */
const uploadedVideos = new Map<string, { uri: string; expiresAt: number }>();
const UPLOAD_REUSE_MS = 40 * 60 * 60 * 1000;

const videoPart = async (ai: GoogleGenAI, absolutePath: string, mimeType: string): Promise<Part> => {
  const cached = uploadedVideos.get(absolutePath);
  if (cached && cached.expiresAt > Date.now()) return { fileData: { fileUri: cached.uri, mimeType } };
  const uploaded = await uploadGeminiFile(ai, { file: absolutePath, config: { mimeType } });
  if (!uploaded.name || !uploaded.uri) throw new Error("動画のアップロードに失敗しました");
  await waitForGeminiFileActive(ai, uploaded.name);
  uploadedVideos.set(absolutePath, { uri: uploaded.uri, expiresAt: Date.now() + UPLOAD_REUSE_MS });
  return { fileData: { fileUri: uploaded.uri, mimeType } };
};

/**
 * 手本(この投稿者の編集チームが作った動画)を見せる。手本から何をどう参考にするかは決まりにせず、AIに任せる。
 * 見せる手本は、今回の動画に近い物をAIが選ぶ(最大3本。近い物が無ければ見せない)。同じ動画の間は同じ手本を使い回し、
 * 手本の動画も1回だけアップロードして使い回す(料金と待ち時間を抑えるため、画質は低めで見せる)。
 */
export const EXAMPLES_INTRO = `
次は、この投稿者の編集チームが過去に作ったショート動画(手本)です。今回の動画に近い物を選んであります。
手本を見て、何をどう参考にするか(参考にしないことも含めて)は、あなたが判断してください。
ただし、手本に出てくる文言・題材・項目名は、今回の動画に持ち込まないでください。
`.trim();

/**
 * 工程別のクセ帳(data/edit-examples/step-guide.md。scripts/eval/build-step-guide.tsで手本から作る)。
 * 工程8・10で、手本の動画と一緒に渡す。
 */
const STEP_GUIDE_PATH = path.join(process.cwd(), "data", "edit-examples", "step-guide.md");
export const STEP_GUIDE_INTRO = `
次は、この編集チームの編集のクセを、編集マニュアルの工程ごとにまとめた「工程別のクセ帳」です。手本と合わせて判断に使ってください。
ただし、位置・大きさ・並べ方はツールの側で決めるので、ここでは見た目(書体・色・帯・形・出方)と、何を強調するかの参考にしてください。
`.trim();
const stepGuidePart = async (): Promise<Part[]> => {
  const guide = await readFile(STEP_GUIDE_PATH, "utf8").then((text) => text.trim(), () => "");
  return guide ? [{ text: `${STEP_GUIDE_INTRO}\n\n${guide}` }] : [];
};

const FONT_VALUES = CAPTION_FONT_FAMILY_OPTIONS.map((option) => option.value) as [CaptionFontFamily, ...CaptionFontFamily[]];
const ANIMATION_VALUES = CAPTION_ANIMATION_OPTIONS.map((option) => option.value) as [CaptionAnimation, ...CaptionAnimation[]];
const FONT_HINTS = CAPTION_FONT_FAMILY_OPTIONS.map((option) => `${option.value}(${option.label})`).join(" / ");
const ANIMATION_HINTS = CAPTION_ANIMATION_OPTIONS.map((option) => `${option.value}(${option.label})`).join(" / ");
const COLOR = /^#[0-9A-Fa-f]{6}$/;
const color = z.string().regex(COLOR);
const nullableColor = z.string().regex(COLOR).nullable();
const colorSchema = { type: Type.STRING };
const nullableColorSchema = { type: Type.STRING, nullable: true };

/** 見た目の手本(ステップ3でお客様が選んだスクショ・動画。サーバー上の場所)。 */
export type StyleReferenceFile = { absolutePath: string; mimeType: string; kind: "image" | "video" };

export const REFERENCES_INTRO = `
次は、この動画のために選ばれた「見た目の手本」(まねしたい投稿のスクリーンショット・動画)です。一番優先して参考にしてください。
手本(編集チームの過去の動画)やクセ帳と食い違う所は、こちらに合わせてください。何をどう参考にするかは、あなたが判断してください。
ただし、見た目の手本に写っている文言・題材は、今回の動画に持ち込まないでください。
`.trim();

/** 見た目の手本から、工程とチェック項目に沿ってクセを読み取らせる指示文(工程別のクセ帳と同じ見出し)。 */
export const REFERENCE_GUIDE_PROMPT = `
上は、これから編集する動画のために選ばれた「見た目の手本」(まねしたい投稿のスクリーンショット・動画)です。
この見た目に近づけて、別の動画をAIが工程ごとに編集します。そのAIに渡すメモを、次の見出しの順に書いてください。
スクリーンショット(静止画)からは動きが分からないので、動きは動画の手本がある時だけ書き、分からない所は「分からない」と書いてください。

### ジャンル・動画の型(ランキング・比較・採点・割合・手順・Q&Aなど、どの型か)
### 工程7・9 基本テロップ(書体・色・縁取り・帯・大きさ・位置)
### 工程8 左上のタイトル(位置・書体・色・縁取り・帯・大きさ・出方)
### 工程8 画面に置く物(ランキングの枠・比べるカード・グラフ・表・図など、何を置いているか。形・色・並べ方・中身の埋め方・出方。何も置いていなければ「なし」)
### 工程10 強調テロップ(書体・色・帯・大きさ・何を強調しているか)
### 色と書体の数(この手本で使っている色の数・書体の数)

## 書き方の決まり
- 書体は、次の候補のうち一番近い物の名前で書く: ${CAPTION_FONT_FAMILY_OPTIONS.map((option) => `${option.label}(${option.value})`).join("・")}
- 色は #RRGGBB で書く。位置・大きさは画面に対する%で書く。
- 手本に写っている文言は例に出さない。全体で2000字以内。
`.trim();

const referenceUploads = new Map<string, { part: Part; expiresAt: number }>();
const referenceGuides = new Map<string, { guide: string; expiresAt: number }>();

const referencePart = async (ai: GoogleGenAI, file: StyleReferenceFile): Promise<Part> => {
  const cached = referenceUploads.get(file.absolutePath);
  if (cached && cached.expiresAt > Date.now()) return cached.part;
  const uploaded = await uploadGeminiFile(ai, { file: file.absolutePath, config: { mimeType: file.mimeType } });
  if (!uploaded.name || !uploaded.uri) throw new Error("見た目の手本のアップロードに失敗しました");
  await waitForGeminiFileActive(ai, uploaded.name);
  const part: Part = { fileData: { fileUri: uploaded.uri, mimeType: file.mimeType } };
  referenceUploads.set(file.absolutePath, { part, expiresAt: Date.now() + UPLOAD_REUSE_MS });
  return part;
};

/**
 * 見た目の手本を見せる部分と、そこから工程・チェック項目に沿って読み取ったメモ(見た目の手本が無ければ空)。
 * メモは同じ手本の組み合わせなら1回だけ作って使い回す。
 */
const referenceParts = async (references: StyleReferenceFile[] | undefined): Promise<Part[]> => {
  if (!references || references.length === 0) return [];
  const ai = client();
  const media: Part[] = [];
  for (const [index, file] of references.entries()) {
    media.push({ text: `【見た目の手本${index + 1}(${file.kind === "video" ? "動画" : "スクリーンショット"})】` });
    media.push(await referencePart(ai, file));
  }
  const key = references.map((file) => file.absolutePath).join("|");
  let guide = referenceGuides.get(key);
  if (!guide || guide.expiresAt < Date.now()) {
    const response = await runWithGeminiRateLimit(() =>
      Promise.race([
        ai.models.generateContent({ model: STEP_MODEL, contents: [{ role: "user", parts: [...media, { text: REFERENCE_GUIDE_PROMPT }] }] }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Gemini API timeout")), TIMEOUT_MS)),
      ])
    );
    guide = { guide: (response.text ?? "").trim(), expiresAt: Date.now() + UPLOAD_REUSE_MS };
    referenceGuides.set(key, guide);
  }
  return [
    { text: REFERENCES_INTRO },
    ...media,
    ...(guide.guide ? [{ text: `【見た目の手本から読み取った、工程ごとのメモ】\n${guide.guide}` }] : []),
  ];
};

const chosenExamples = new Map<string, { examples: EditExample[]; expiresAt: number }>();
const exampleUploads = new Map<string, { part: Part; expiresAt: number }>();

const examplesFor = async (ai: GoogleGenAI, absolutePath: string, mimeType: string): Promise<EditExample[]> => {
  const cached = chosenExamples.get(absolutePath);
  if (cached && cached.expiresAt > Date.now()) return cached.examples;
  // 工程8・10では完成動画だけを見せるので、編集前の素材が無い手本も候補にする
  const examples = await selectEditExamples(ai, await videoPart(ai, absolutePath, mimeType), [], { finalOnly: true });
  chosenExamples.set(absolutePath, { examples, expiresAt: Date.now() + UPLOAD_REUSE_MS });
  return examples;
};

const examplePart = async (ai: GoogleGenAI, mediaPath: string, mimeType: string): Promise<Part> => {
  const cached = exampleUploads.get(mediaPath);
  if (cached && cached.expiresAt > Date.now()) return cached.part;
  const part = await uploadExampleVideo(ai, mediaPath, mimeType, [], "low");
  exampleUploads.set(mediaPath, { part, expiresAt: Date.now() + UPLOAD_REUSE_MS });
  return part;
};

/** 手本を見せる部分(手本が無ければ空)。完成動画を見せる。 */
const exampleParts = async (absolutePath: string, mimeType: string): Promise<Part[]> => {
  const ai = client();
  const examples = await examplesFor(ai, absolutePath, mimeType);
  if (examples.length === 0) return [];
  const parts: Part[] = [{ text: EXAMPLES_INTRO }];
  for (const [index, example] of examples.entries()) {
    parts.push({ text: `【手本${index + 1}「${example.label}」の完成動画】` });
    parts.push(await examplePart(ai, editExampleMediaPath(example, "correct")!, example.correctMimeType));
  }
  parts.push({ text: "【ここから、今回編集する動画の話】" });
  return parts;
};

/** JSONで答えてもらい、形を確かめて返す。混んでいる時だけ少し待って頼み直す。 */
const askJson = async <T>(params: {
  model: string;
  parts: Part[];
  schema: Schema;
  parse: z.ZodType<T>;
  label: string;
}): Promise<T> => {
  const ai = client();
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await runWithGeminiRateLimit(() =>
        Promise.race([
          ai.models.generateContent({
            model: params.model,
            contents: [{ role: "user", parts: params.parts }],
            config: { responseMimeType: "application/json", responseSchema: params.schema },
          }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Gemini API timeout")), TIMEOUT_MS)),
        ])
      );
      const parsed = params.parse.safeParse(JSON.parse(response.text ?? "{}"));
      if (!parsed.success) throw new Error(`${params.label}: AIの答えの形が違いました`);
      return parsed.data;
    } catch (error) {
      lastError = error;
      if (isRetryableApiError(error) && attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 8_000 * attempt));
        continue;
      }
      // 答えの形が崩れた・待っても返ってこない時も、頼み直す
      if ((error instanceof SyntaxError || (error instanceof Error && error.message === "Gemini API timeout")) && attempt < MAX_ATTEMPTS) continue;
      throw toFriendlyGeminiError(error);
    }
  }
  throw toFriendlyGeminiError(lastError);
};

const seconds = (value: number) => `${(Math.round(value * 10) / 10).toFixed(1)}秒`;

/** 工程3の指示文。 */
export const MISTAKES_PROMPT = (ranges: { start: number; end: number }[]) => `
添付した動画は、人が話しているショート動画の素材です。
次の範囲(元の動画の秒数)が、今使っている部分です:
${ranges.map((range, index) => `${index + 1}. ${seconds(range.start)}〜${seconds(range.end)}`).join("\n")}

この範囲の中から、編集で切るべき「言い間違い」と「言葉に詰まった部分」だけを探してください。
- 言い間違い: 言い直している所の、間違えた方(言い直す前)の言葉。言い直した後の正しい言葉は残す。
- 言葉に詰まった部分: 「えーと」「あのー」「えー」などの言葉にならない声、同じ言葉を繰り返してつかえている所。
- 話の内容として必要な言葉、言い直していない普通の言葉、間(無音)は切らない(無音は別の工程で切る)。
- 切る範囲は、その言葉の頭から終わりまでをできるだけ正確に、0.1秒単位で書く。迷う所は切らない。
- 見つからなければ空の配列で答える。

各項目に、切る理由(reason: 「言い間違い」か「詰まり」)と、その部分で言っている言葉(text)を書いてください。
`.trim();

/** 3. 言い間違いや言葉に詰まった部分を探す。 */
export const findMistakes = async (input: {
  absolutePath: string;
  mimeType: string;
  ranges: { start: number; end: number }[];
}): Promise<{ start: number; end: number; reason: string; text: string }[]> => {
  const part = await videoPart(client(), input.absolutePath, input.mimeType);
  const result = await askJson({
    model: STEP_MODEL,
    label: "言い間違いの検出",
    parts: [part, { text: MISTAKES_PROMPT(input.ranges) }],
    schema: {
      type: Type.OBJECT,
      properties: {
        cuts: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              startSeconds: { type: Type.NUMBER },
              endSeconds: { type: Type.NUMBER },
              reason: { type: Type.STRING },
              text: { type: Type.STRING },
            },
            required: ["startSeconds", "endSeconds", "reason", "text"],
          },
        },
      },
      required: ["cuts"],
    },
    parse: z.object({
      cuts: z.array(z.object({ startSeconds: z.number(), endSeconds: z.number(), reason: z.string(), text: z.string() })),
    }),
  });
  return result.cuts
    .filter((cut) => cut.endSeconds > cut.startSeconds && cut.endSeconds - cut.startSeconds < 5)
    .map((cut) => ({ start: cut.startSeconds, end: cut.endSeconds, reason: cut.reason, text: cut.text }));
};

/** 工程6の指示文。 */
export const FACE_PROMPT = `
添付した動画で話している人の顔が、画面のどこに映っているかを答えてください。動画の大半で映っている位置にします。
xPercent/yPercentは顔の中心、widthPercent/heightPercentは顔(髪の生え際からあごまで)の幅・高さで、
どれも画面の幅・高さに対する割合(0〜100)です。顔が映っていなければfoundをfalseにしてください。
`.trim();

/** 6. 話している人の顔の位置を調べる。 */
export const detectFace = async (input: { absolutePath: string; mimeType: string }): Promise<FaceBox | null> => {
  const part = await videoPart(client(), input.absolutePath, input.mimeType);
  const result = await askJson({
    model: FACE_MODEL,
    label: "顔の位置",
    parts: [part, { text: FACE_PROMPT }],
    schema: {
      type: Type.OBJECT,
      properties: {
        found: { type: Type.BOOLEAN },
        xPercent: { type: Type.NUMBER },
        yPercent: { type: Type.NUMBER },
        widthPercent: { type: Type.NUMBER },
        heightPercent: { type: Type.NUMBER },
      },
      required: ["found"],
    },
    parse: z.object({
      found: z.boolean(),
      xPercent: z.number().optional(),
      yPercent: z.number().optional(),
      widthPercent: z.number().optional(),
      heightPercent: z.number().optional(),
    }),
  });
  if (!result.found || result.xPercent === undefined || result.yPercent === undefined) return null;
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  return {
    xPercent: clamp(result.xPercent, 0, 100),
    yPercent: clamp(result.yPercent, 0, 100),
    widthPercent: clamp(result.widthPercent ?? 25, 5, 100),
    heightPercent: clamp(result.heightPercent ?? 18, 5, 100),
  };
};

/** 工程8の指示文。 */
/** 図の土台・部品の書き方(工程8・10で共通)。 */
const FIGURE_DRAWING_RULES = `   - svg: SVGの要素だけで書く(<svg>タグは書かない)。使える要素: g・rect・circle・ellipse・line・polyline・polygon・path。
     文字(text要素)・画像・グラデーション・フィルター・styleは使えない(書いても消える)。色は fill・stroke の属性に #RRGGBB で書く。
   - texts: 図に書く文字。text(文字)・x・y(文字の中心の座標)・size(文字の高さ。座標の単位で40以上)・color・strokeColor(縁取りの色。無ければnull)。
     文字は短く(1つ全角10文字以内)。文字同士・文字と線が重ならないように置く。`;

/**
 * 工程8の指示文。figureViewBoxHeight は、AIが図を描く箱の縦の大きさ(横は1000)。人と字幕を避けて図を置ける所が無ければ null。
 */
export const OBJECTS_PROMPT = (figureViewBoxHeight: number | null) => `
添付した動画は、ショート動画の素材です。編集で画面に置く物(左上のタイトルと、話の中身を見せる枠・カード・図)を決めてください。
見た目と出方は、手本とクセ帳の編集チームの物に近づけてください。

1. title: 動画の最初から最後まで、画面の左上に出すタイトル。何の話かが一目でわかる短い言葉(全角16文字以内)。
   話の中に出てくる、動画のテーマになる言葉(商品・サービス・症状・用語などの名前)を、話したとおりに1つ入れる。12文字を超える時だけ、意味の切れ目に「\\n」を1つ入れて2行にする。
   「絶対」「最強」「No.1」「〇〇初」「大人気」のような誇大・比較の言葉は使わない。言っていない数字は入れない。
2. titleLook: タイトルの見た目。fontFamily(書体)・textColor(文字の色)・strokeColor(縁取りの色。付けないならnull)・
   bandColor(文字の後ろに敷く帯の色。敷かないならnull)・animation(出方)。
3. layout: 動画の型に合わせて、画面に置く物を1つ選ぶ。まず動画の型(ランキング・比較・採点・割合・手順・Q&Aなど)を見極めてから選ぶ。
   - ranking: ランキング・「〇選」のように、3つ以上の項目を順に挙げていく動画。画面の左に、番号付きの枠を縦に並べ、項目名を順に入れていく。
   - compare: 2つの物(AとB)を比べる動画。画面の下に、比べる2つを入れるカードを左右に2枚並べる。
   - figure: それ以外で、話の中身を図にすると分かりやすい動画。割合なら円グラフや帯グラフ、採点なら採点表、手順なら流れの図、
     数の比べなら棒グラフのように、動画に合った図をあなたが自由に描く(下の6)。${figureViewBoxHeight === null ? "\n     ただし、この動画は人と字幕を避けて図を置ける所が無いので、figure は選ばない。" : ""}
   - none: 枠や図が無くても伝わる動画(Q&A・雑談・感想など)。
4. frameCount: layoutがrankingの時だけ、挙げていく項目の数(3〜10)。それ以外は0。
5. frameLook: 枠・カードの見た目(layoutがranking・compareの時に使う。それ以外は何でもよい)。borderColor(線の色)・borderWidthPx(線の太さ。2〜12)・
   fillColor(中の塗り。塗らないならnull)・cornerRadiusPx(角の丸み。0〜40)・numberColor(枠に付ける番号・カードの文字の色)・animation(出方)。
6. figure: layoutがfigureの時だけ描く(それ以外は、idea・svgを空の文字、textsを空の配列で答える)。${
  figureViewBoxHeight === null
    ? ""
    : `
   図を描く場所は、画面の中の 横1000 × 縦${figureViewBoxHeight} の箱(この大きさの座標で描く)。人と字幕に重ならない所をツールが選んであるので、箱の外には描かない。
   - idea: 何を表す図か、この後、話に合わせて何を足していくか(1〜2文)。
   - 土台(svg・texts)は、動画の最初から出しておく「中身がまだ入っていない状態」にする(空の円グラフの外枠、項目名と「/20」だけの採点表など)。
     数字・答え・結果は、字幕ができた後の工程で、話に合わせて足していく。
${FIGURE_DRAWING_RULES}
   - 動画の中で実際に話している内容だけを図にする。言っていない項目・数字は入れない。
   - 読みやすいよう、文字と背景の色をはっきり分ける(動画の上に直接描くので、必要なら白か黒の板を敷く)。`
}

- 書体は次から選ぶ: ${FONT_HINTS}
- 出方は次から選ぶ: ${ANIMATION_HINTS}
- 色は #RRGGBB で書く。タイトル・枠・図・テロップを合わせた動画全体の色は、白・黒を除いて3色以内にする(チェック項目。白・黒は数えない)。
- タイトル・枠・カードの位置・大きさ・並べ方はツールの側で決めるので書かない。

reasonに、そう決めた理由(動画の型と、どの手本・クセ帳のどこを参考にしたか)を1〜2文で書いてください。
`.trim();

/** 工程8で決めるタイトル・枠の見た目。 */
export type ObjectLook = {
  title: { fontFamily: CaptionFontFamily; textColor: string; strokeColor: string | null; bandColor: string | null; animation: CaptionAnimation };
  frame: {
    borderColor: string;
    borderWidthPx: number;
    fillColor: string | null;
    cornerRadiusPx: number;
    numberColor: string;
    animation: CaptionAnimation;
  };
};

const figureTextsSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      text: { type: Type.STRING },
      x: { type: Type.NUMBER },
      y: { type: Type.NUMBER },
      size: { type: Type.NUMBER },
      color: colorSchema,
      strokeColor: nullableColorSchema,
    },
    required: ["text", "x", "y", "size", "color", "strokeColor"],
  },
};
const figureTextsParse = z
  .array(z.object({ text: z.string(), x: z.number(), y: z.number(), size: z.number(), color, strokeColor: nullableColor }))
  .default([]);
/** AIが書いた図の一部を、使える形に整える(SVGは描く要素だけ残す・空の文字は外す・文字は小さすぎないようにする)。 */
const cleanFigureLayer = (layer: { svg: string; texts: z.infer<typeof figureTextsParse> }): FigureLayer => ({
  svg: sanitizeSvgFragment(layer.svg),
  texts: layer.texts
    .map((text) => ({ ...text, text: text.text.trim().slice(0, 16), size: Math.max(30, text.size) }))
    .filter((text) => text.text),
});

/** 8. 左上のタイトルと、画面に置く物(ランキングの枠・比べるカード・図)を決める。 */
export const decideObjects = async (input: {
  absolutePath: string;
  mimeType: string;
  references?: StyleReferenceFile[];
  /** 図を描く箱の縦の大きさ(横は1000)。図を置ける所が無ければ null。 */
  figureViewBoxHeight: number | null;
}): Promise<{
  title: string;
  layout: ObjectLayout;
  frameCount: number;
  look: ObjectLook;
  figure: { idea: string; base: FigureLayer } | null;
  reason: string;
}> => {
  const part = await videoPart(client(), input.absolutePath, input.mimeType);
  const examples = await exampleParts(input.absolutePath, input.mimeType);
  const guide = await stepGuidePart();
  const references = await referenceParts(input.references);
  const result = await askJson({
    model: STEP_MODEL,
    label: "タイトルと枠",
    parts: [...examples, ...guide, ...references, { text: "【ここから、今回編集する動画】" }, part, { text: OBJECTS_PROMPT(input.figureViewBoxHeight) }],
    schema: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        titleLook: {
          type: Type.OBJECT,
          properties: {
            fontFamily: { type: Type.STRING, format: "enum", enum: FONT_VALUES },
            textColor: colorSchema,
            strokeColor: nullableColorSchema,
            bandColor: nullableColorSchema,
            animation: { type: Type.STRING, format: "enum", enum: ANIMATION_VALUES },
          },
          required: ["fontFamily", "textColor", "strokeColor", "bandColor", "animation"],
        },
        layout: { type: Type.STRING, format: "enum", enum: ["ranking", "compare", "figure", "none"] },
        frameCount: { type: Type.INTEGER },
        frameLook: {
          type: Type.OBJECT,
          properties: {
            borderColor: colorSchema,
            borderWidthPx: { type: Type.NUMBER },
            fillColor: nullableColorSchema,
            cornerRadiusPx: { type: Type.NUMBER },
            numberColor: colorSchema,
            animation: { type: Type.STRING, format: "enum", enum: ANIMATION_VALUES },
          },
          required: ["borderColor", "borderWidthPx", "fillColor", "cornerRadiusPx", "numberColor", "animation"],
        },
        figure: {
          type: Type.OBJECT,
          properties: { idea: { type: Type.STRING }, svg: { type: Type.STRING }, texts: figureTextsSchema },
          required: ["idea", "svg", "texts"],
        },
        reason: { type: Type.STRING },
      },
      required: ["title", "titleLook", "layout", "frameCount", "frameLook", "figure", "reason"],
    },
    parse: z.object({
      title: z.string(),
      titleLook: z.object({
        fontFamily: z.enum(FONT_VALUES),
        textColor: color,
        strokeColor: nullableColor,
        bandColor: nullableColor,
        animation: z.enum(ANIMATION_VALUES),
      }),
      layout: z.enum(["ranking", "compare", "figure", "none"]),
      frameCount: z.number().int(),
      frameLook: z.object({
        borderColor: color,
        borderWidthPx: z.number(),
        fillColor: nullableColor,
        cornerRadiusPx: z.number(),
        numberColor: color,
        animation: z.enum(ANIMATION_VALUES),
      }),
      figure: z.object({ idea: z.string(), svg: z.string(), texts: figureTextsParse }).nullable().default(null),
      reason: z.string(),
    }),
  });
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const base = result.figure ? cleanFigureLayer(result.figure) : null;
  // 図を選んでも、置く所が無い・何も描かれていない時は、図は置かない
  const figure =
    result.layout === "figure" && input.figureViewBoxHeight !== null && base && (base.svg || base.texts.length > 0)
      ? { idea: result.figure?.idea.trim() ?? "", base }
      : null;
  const layout: ObjectLayout =
    result.layout === "figure" ? (figure ? "figure" : "none") : result.layout === "ranking" && result.frameCount < 2 ? "none" : result.layout;
  return {
    title: result.title.trim().slice(0, 20),
    layout,
    frameCount: layout === "ranking" ? clamp(result.frameCount, 2, 10) : layout === "compare" ? 2 : 0,
    figure,
    look: {
      title: result.titleLook,
      frame: {
        ...result.frameLook,
        borderWidthPx: clamp(Math.round(result.frameLook.borderWidthPx), 2, 12),
        cornerRadiusPx: clamp(Math.round(result.frameLook.cornerRadiusPx), 0, 40),
      },
    },
    reason: result.reason,
  };
};

/** 工程8で画面に置いた物(工程10で、中身を話に合わせて入れていくため)。 */
export type PlacedObjects =
  | { kind: "frames"; layout: "ranking" | "compare"; frameCount: number }
  | { kind: "figure"; idea: string; viewBoxHeight: number; base: FigureLayer }
  | { kind: "none" };

const objectsSection = (objects: PlacedObjects): string => {
  if (objects.kind === "frames" && objects.layout === "compare") {
    return `
画面の下には、比べる2つを入れるカードが、左(1)・右(2)に並んでいます。比べる2つそれぞれについて、
- frame: 入れるカード(1=左、2=右)。話に出てくる順に1から。
- index: その物の名前が初めて出てくる字幕の番号(上の一覧の番号)。
- label: カードに入れる短い言葉。比べる物の名前を、そのまま全角8文字以内で。
を frameItems で答えてください。figureItems は空の配列で答えてください。`;
  }
  if (objects.kind === "frames") {
    return `
画面の左には、項目を順に埋めていく枠が${objects.frameCount}個、上から1〜${objects.frameCount}の番号付きで並んでいます。挙げていく項目ごとに、
- frame: 入れる枠の番号(1〜${objects.frameCount})。ランキングを下の順位から発表する時は、順位と同じ番号の枠に入れる(5位なら5)。それ以外は挙げた順に1から。
- index: その項目を言い始める字幕の番号(上の一覧の番号)。項目名が出てくる字幕。
- label: 枠に入れる短い言葉。項目名を、そのまま全角8文字以内で(説明や答えは入れない)。
を frameItems で答えてください。項目が枠より少なければ、ある分だけ答える。figureItems は空の配列で答えてください。`;
  }
  if (objects.kind === "figure") {
    return `
画面には、前の工程で描いた図(横1000 × 縦${objects.viewBoxHeight} の座標)の土台が、動画の最初から出ています。
図の中身: ${objects.idea}
土台の絵(SVG): ${objects.base.svg || "(なし)"}
土台の文字: ${JSON.stringify(objects.base.texts)}

話に合わせて図に足していく部品を、話す順に figureItems で答えてください(2〜12個)。部品ごとに、
- index: その部品を出し始める字幕の番号(上の一覧の番号)。その中身(数字・点数・答えなど)を言う字幕。
- label: 何を足すかの短い説明(確認用。全角20文字以内)。
- svg・texts: 足す絵と文字。土台と同じ座標で、土台に重ねて描く。前に出した部品は消えずに残るので、足す分だけ書く。
${FIGURE_DRAWING_RULES}
   - 言っていない数字・項目は入れない。円グラフの切れは、土台の円と同じ中心・半径で、言った割合どおりの角度で描く。
frameItems は空の配列で答えてください。`;
  }
  return `
この動画には中身を入れていく枠や図が無いので、frameItems・figureItems は空の配列で答えてください。`;
};

/** 工程10の指示文。 */
export const EMPHASIS_PROMPT = (captions: string[], objectColorsLine = "", objects: PlacedObjects = { kind: "none" }) => `
次は、ショート動画の字幕を順に並べたものです(番号: 字幕)。
${captions.map((caption, index) => `${index + 1}: ${caption.replace(/\n/g, "")}`).join("\n")}

この中から、強調テロップ(基本の字幕とは違う、目立つ見た目の字幕)にしたい字幕を選んでください。
- ランキングや「〇選」のように項目を順に挙げていく動画では、項目名(順位・用語・商品名など、挙げていく物の名前)の
  字幕を、1つ目から最後まで全部選ぶ。項目の説明・答えの字幕は選ばない。
- それ以外の動画では、見ている人に一番残したい言葉が入った字幕(答え・数字・結論・本音やオチの一言)を、全体の3割までで選ぶ。
- 説明・つなぎ・前置き・締めのあいさつの字幕は選ばない。
- 効果を言い切る言葉(「絶対治る」「痛くない」など)を含む字幕は選ばない。

あわせて、字幕の見た目を、手本とクセ帳の編集チームの物に近づけて決めてください。
- baseLook: 基本テロップ(強調しない字幕)の見た目。fontFamily(書体)・style(outline=縁取り文字 / pill=色付きの帯の上に白い文字)・
  accentColor(outlineなら縁取りの色、pillなら帯の色)。
- emphasisLook: 強調テロップの見た目。fontFamily(書体)・textColor(文字の色)・bandColor(文字の後ろに敷く帯の色。敷かないならnull)。
- 書体は次から選ぶ: ${FONT_HINTS}
- 色は #RRGGBB で書く。動画全体の色は、白・黒を除いて3色以内にする(チェック項目。白・黒は数えない)。書体は基本と強調で2つまで(チェック項目)。
${objectColorsLine}
${objectsSection(objects)}

選んだ字幕の番号(picks)と、それぞれを選んだ理由(reasons。picksと同じ順)、見た目をそう決めた理由(lookReason)を答えてください。
`.trim();

/** 10. 強調テロップにする字幕を選ぶ(0始まりの番号で返す)。 */
/** 工程10で決める字幕の見た目。 */
export type CaptionLook = {
  base: { fontFamily: CaptionFontFamily; style: "outline" | "pill"; accentColor: string };
  emphasis: { fontFamily: CaptionFontFamily; textColor: string; bandColor: string | null };
};

export const pickEmphasis = async (input: {
  absolutePath: string;
  mimeType: string;
  captions: string[];
  /** 工程8で使った色(タイトル・枠。白・黒は除く)。字幕の色と合わせて3色以内にするため。 */
  objectColors?: string[];
  /** 工程8で画面に置いた物(枠・カード・図)。 */
  objects: PlacedObjects;
  references?: StyleReferenceFile[];
}): Promise<{
  picks: { index: number; reason: string }[];
  look: CaptionLook;
  lookReason: string;
  /** 枠に入れる項目(index は0始まりの字幕の番号)。 */
  frameItems: { frame: number; index: number; label: string }[];
  /** 図に足す部品(index は0始まりの字幕の番号)。 */
  figureItems: (FigureLayer & { index: number; label: string })[];
}> => {
  const { captions } = input;
  const examples = await exampleParts(input.absolutePath, input.mimeType);
  const guide = await stepGuidePart();
  const references = await referenceParts(input.references);
  const colorsLine = input.objectColors?.length
    ? `- タイトル・枠・図ですでに白・黒のほかに ${input.objectColors.join("・")} を使っているので、字幕(と図に足す部品)もこの色(か白・黒)から選ぶと3色以内に収まる。`
    : "";
  const result = await askJson({
    model: STEP_MODEL,
    label: "強調テロップ",
    parts: [...examples, ...guide, ...references, { text: "【ここから、今回編集する動画】" }, { text: EMPHASIS_PROMPT(captions, colorsLine, input.objects) }],
    schema: {
      type: Type.OBJECT,
      properties: {
        picks: { type: Type.ARRAY, items: { type: Type.INTEGER } },
        reasons: { type: Type.ARRAY, items: { type: Type.STRING } },
        baseLook: {
          type: Type.OBJECT,
          properties: {
            fontFamily: { type: Type.STRING, format: "enum", enum: FONT_VALUES },
            style: { type: Type.STRING, format: "enum", enum: ["outline", "pill"] },
            accentColor: colorSchema,
          },
          required: ["fontFamily", "style", "accentColor"],
        },
        emphasisLook: {
          type: Type.OBJECT,
          properties: {
            fontFamily: { type: Type.STRING, format: "enum", enum: FONT_VALUES },
            textColor: colorSchema,
            bandColor: nullableColorSchema,
          },
          required: ["fontFamily", "textColor", "bandColor"],
        },
        lookReason: { type: Type.STRING },
        frameItems: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: { frame: { type: Type.INTEGER }, index: { type: Type.INTEGER }, label: { type: Type.STRING } },
            required: ["frame", "index", "label"],
          },
        },
        figureItems: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: { index: { type: Type.INTEGER }, label: { type: Type.STRING }, svg: { type: Type.STRING }, texts: figureTextsSchema },
            required: ["index", "label", "svg", "texts"],
          },
        },
      },
      required: ["picks", "reasons", "baseLook", "emphasisLook", "lookReason", "frameItems", "figureItems"],
    },
    parse: z.object({
      picks: z.array(z.number().int()),
      reasons: z.array(z.string()),
      baseLook: z.object({ fontFamily: z.enum(FONT_VALUES), style: z.enum(["outline", "pill"]), accentColor: color }),
      emphasisLook: z.object({ fontFamily: z.enum(FONT_VALUES), textColor: color, bandColor: nullableColor }),
      lookReason: z.string(),
      frameItems: z.array(z.object({ frame: z.number().int(), index: z.number().int(), label: z.string() })).default([]),
      figureItems: z
        .array(z.object({ index: z.number().int(), label: z.string(), svg: z.string(), texts: figureTextsParse }))
        .default([]),
    }),
  });
  const seen = new Set<number>();
  const picks = result.picks.flatMap((pick, i) => {
    const index = pick - 1;
    if (index < 0 || index >= captions.length || seen.has(index)) return [];
    seen.add(index);
    return [{ index, reason: result.reasons[i] ?? "" }];
  });
  // 枠に入れる項目: 番号が範囲外・同じ枠に2つ目・字幕の番号が範囲外の物は外す。長すぎる言葉は8文字で切る
  const frameCount = input.objects.kind === "frames" ? input.objects.frameCount : 0;
  const frames = new Set<number>();
  const frameItems = result.frameItems.flatMap((item) => {
    const index = item.index - 1;
    const label = [...item.label.replace(/\s+/g, "")].slice(0, 8).join("");
    if (item.frame < 1 || item.frame > frameCount || frames.has(item.frame)) return [];
    if (index < 0 || index >= captions.length || !label) return [];
    frames.add(item.frame);
    return [{ frame: item.frame, index, label }];
  });
  // 図に足す部品: 図が無い時・字幕の番号が範囲外の時・何も描いていない時は外す
  const figureItems =
    input.objects.kind !== "figure"
      ? []
      : result.figureItems.slice(0, 12).flatMap((item) => {
          const index = item.index - 1;
          const layer = cleanFigureLayer(item);
          if (index < 0 || index >= captions.length || (!layer.svg && layer.texts.length === 0)) return [];
          return [{ ...layer, index, label: item.label.trim().slice(0, 30) }];
        });
  return { picks, look: { base: result.baseLook, emphasis: result.emphasisLook }, lookReason: result.lookReason, frameItems, figureItems };
};

/** 工程12(チェック)の誤字・脱字の確認の指示文。 */
export const PROOFREAD_PROMPT = (texts: { kind: "字幕" | "タイトル・枠の文字"; text: string }[]) => `
添付した動画の音声と、次の画面に出す文字を見比べて、誤字・脱字を探してください(番号: [種類] 文字)。
${texts.map((item, index) => `${index + 1}: [${item.kind}] ${item.text.replace(/\n/g, "")}`).join("\n")}

- [字幕]は話した言葉の書き起こし。聞き間違い(話している言葉と違う)・漢字の間違い・送り仮名の間違い・抜けている字・余計な字を探す。
  字幕は話した言葉を短くしてよいので、言い回しが違うだけ・言葉を省いているだけの物は誤りにしない。
- [タイトル・枠の文字]は話をまとめた言葉なので、話した言葉と違っていてよい。漢字・送り仮名の間違い、抜けている字・余計な字だけを探す。
- 専門用語・略語(DM・IVなど)は、話している言葉のとおりなら誤りにしない。
- 見つからなければ空の配列で答える。

誤りごとに、文字の番号(index)、誤りの部分(wrong)、正しい書き方(correct)、理由(reason)を書いてください。
`.trim();

/** 12. 画面に出す文字の誤字・脱字の候補を探す。 */
export const proofreadTexts = async (input: {
  absolutePath: string;
  mimeType: string;
  texts: { kind: "字幕" | "タイトル・枠の文字"; text: string }[];
}): Promise<{ text: string; wrong: string; correct: string; reason: string }[]> => {
  if (input.texts.length === 0) return [];
  const part = await videoPart(client(), input.absolutePath, input.mimeType);
  const result = await askJson({
    model: STEP_MODEL,
    label: "誤字・脱字の確認",
    parts: [part, { text: PROOFREAD_PROMPT(input.texts) }],
    schema: {
      type: Type.OBJECT,
      properties: {
        issues: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              index: { type: Type.INTEGER },
              wrong: { type: Type.STRING },
              correct: { type: Type.STRING },
              reason: { type: Type.STRING },
            },
            required: ["index", "wrong", "correct", "reason"],
          },
        },
      },
      required: ["issues"],
    },
    parse: z.object({
      issues: z.array(z.object({ index: z.number().int(), wrong: z.string(), correct: z.string(), reason: z.string() })),
    }),
  });
  return result.issues
    .filter((issue) => issue.index >= 1 && issue.index <= input.texts.length && issue.wrong !== issue.correct)
    .map((issue) => ({ text: input.texts[issue.index - 1].text, wrong: issue.wrong, correct: issue.correct, reason: issue.reason }));
};

/** 工程9(字幕を読める長さにする)の指示文。 */
export const CAPTION_SHORTEN_PROMPT = (items: { text: string; maxChars: number }[]) => `
次は、ショート動画の字幕です(番号: 字幕 [この字幕を出しておける時間で読める文字数])。
話すのが速い所なので、このままでは読み切れません。それぞれを、読める文字数以内に短くしてください。
${items.map((item, index) => `${index + 1}: ${item.text.replace(/\n/g, "")} [${item.maxChars}文字まで]`).join("\n")}

- 話している言葉の意味は変えない。言っていないことは足さない。
- 「〜と思います」「〜ですね」などの言い回しや、なくても意味が通じる言葉から削る。
- 物や事の名前・用語・数字・固有名詞(LINEなど)は残す。
- 効果を言い切る言葉(「絶対治る」など)にはしない。

番号の順に、短くした字幕(texts)を答えてください。
`.trim();

/** 9. 話すのが速くて読み切れない字幕を、読める文字数に短くする(texts は items と同じ順)。 */
export const shortenCaptions = async (items: { text: string; maxChars: number }[]): Promise<string[]> => {
  if (items.length === 0) return [];
  const result = await askJson({
    model: STEP_MODEL,
    label: "字幕を短くする",
    parts: [{ text: CAPTION_SHORTEN_PROMPT(items) }],
    schema: {
      type: Type.OBJECT,
      properties: { texts: { type: Type.ARRAY, items: { type: Type.STRING } } },
      required: ["texts"],
    },
    parse: z.object({ texts: z.array(z.string()) }),
  });
  // 短くなっていない・空になった物は元のまま
  return items.map((item, index) => {
    const text = (result.texts[index] ?? "").trim();
    return text && [...text.replace(/\s/g, "")].length < [...item.text.replace(/\s/g, "")].length ? text : item.text;
  });
};

/** 工程12(長さを収める)の指示文。 */
export const SHORTEN_PROMPT = (captions: { text: string; seconds: number }[], totalSeconds: number, targetSeconds: number) => `
次は、ショート動画の字幕を順に並べたものです(番号: 字幕 [その字幕の秒数])。今の長さは${totalSeconds.toFixed(1)}秒です。
${captions.map((caption, index) => `${index + 1}: ${caption.text.replace(/\n/g, "")} [${caption.seconds.toFixed(1)}秒]`).join("\n")}

この動画を${targetSeconds}秒以内に収めるため、外す字幕(その字幕の場面ごと外す)を選んでください。
- 外してよいのは、前置き・繰り返し・言い換え・話の本筋に関係ない脱線・締めのあいさつの重複。
- 外さないのは、動画のテーマを言う最初の一言・挙げていく項目(順位・用語・商品名など)とその答え・結論。
- 外す字幕の秒数の合計が、${(totalSeconds - targetSeconds).toFixed(1)}秒以上になるように選ぶ。外すと話がつながらなくなる所は外さない。

外す字幕の番号(removes)と、それぞれの理由(reasons。removesと同じ順)を答えてください。
`.trim();

/** 12. 長さを収めるために外す字幕を選ぶ(0始まりの番号で返す)。 */
export const pickRemovals = async (input: {
  absolutePath: string;
  mimeType: string;
  captions: { text: string; seconds: number }[];
  totalSeconds: number;
  targetSeconds: number;
}): Promise<{ index: number; reason: string }[]> => {
  const { captions, totalSeconds, targetSeconds } = input;
  const result = await askJson({
    model: STEP_MODEL,
    label: "長さを収める",
    parts: [{ text: SHORTEN_PROMPT(captions, totalSeconds, targetSeconds) }],
    schema: {
      type: Type.OBJECT,
      properties: {
        removes: { type: Type.ARRAY, items: { type: Type.INTEGER } },
        reasons: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ["removes", "reasons"],
    },
    parse: z.object({ removes: z.array(z.number().int()), reasons: z.array(z.string()) }),
  });
  const seen = new Set<number>();
  return result.removes.flatMap((pick, i) => {
    const index = pick - 1;
    if (index < 0 || index >= captions.length || seen.has(index)) return [];
    seen.add(index);
    return [{ index, reason: result.reasons[i] ?? "" }];
  });
};
