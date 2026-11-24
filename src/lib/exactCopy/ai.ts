/**
 * 完全模倣(EC)で使う、AIへの頼み方。今までの作り方(src/lib/editSteps/ai.ts、1123の時の物)の写しから始め、
 * 完全模倣の直しはこちらだけに入れる(今までの作り方は変えない)。何をどう直したかは docs/change-tree.md に残す。
 */
import { GoogleGenAI, Type, type Part, type Schema } from "@google/genai";
import { z } from "zod";
import {
  CAPTION_ANIMATION_OPTIONS,
  CAPTION_FONT_FAMILY_OPTIONS,
  type CaptionAnimation,
  type CaptionFontFamily,
  type FaceBox,
} from "@video/shared/schema";
import { runWithGeminiRateLimit } from "@/lib/gemini/rateLimiter";
import { isRetryableApiError, toFriendlyGeminiError } from "@/lib/gemini/geminiErrors";
import { uploadGeminiFile, waitForGeminiFileActive } from "@/lib/gemini/geminiFiles";
import { sanitizeSvgFragment, type FigureLayer } from "@/lib/editSteps/figure";
import { toReferenceLayout, type ObjectLayout, type ReferenceLayout } from "@/lib/editSteps/logic";

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
export const STEP_GUIDE_INTRO = `
次は、この編集チームの編集のクセを、編集マニュアルの工程ごとにまとめた「工程別のクセ帳」です。手本と合わせて判断に使ってください。
ただし、位置・大きさ・並べ方はツールの側で決めるので、ここでは見た目(書体・色・帯・形・出方)と、何を強調するかの参考にしてください。
`.trim();
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
/** 見た目の手本。YouTubeの手本はyoutubeUrlを持ち、ファイルを送らずURLのままAIに見せる。 */
export type StyleReferenceFile = { absolutePath: string; mimeType: string; kind: "image" | "video"; youtubeUrl?: string };

export const REFERENCES_INTRO = `
次は、この動画のために選ばれた「見た目の手本」(まねしたい投稿のスクリーンショット・動画)です。一番優先して参考にしてください。
見た目(書体・色・縁取り・帯・大きさ・枠やカードの形・出方)は、手本と同じにしてください。手本(編集チームの過去の動画)やクセ帳と食い違う所も、こちらに合わせます。
色の数・書体の数も、手本どおりでかまいません(チェック項目の上限より手本を優先します)。
中身(タイトルの文言・枠やカードに入れる言葉・強調する言葉・図の中身)だけは、手本ではなく、今回の動画で話している内容に合わせてください。見た目の手本に写っている文言・題材は、今回の動画に持ち込まないでください。
TikTokなどのロゴ・投稿者名の透かしは、保存した時に付いた物なので、編集のクセとしてまねしないでください。
`.trim();

/** 見た目の手本から、工程とチェック項目に沿ってクセを読み取らせる指示文(工程別のクセ帳と同じ見出し)。 */
export const REFERENCE_GUIDE_PROMPT = `
上は、これから編集する動画のために選ばれた「見た目の手本」(まねしたい投稿のスクリーンショット・動画)です。
この手本と同じ見た目・配置で、別の動画をAIが工程ごとに編集します(中身は、その動画で話している内容に合わせます)。そのAIに渡すメモを、次の見出しの順に書いてください。
スクリーンショット(静止画)からは動きが分からないので、動きは動画の手本がある時だけ書き、分からない所は「分からない」と書いてください。
TikTokなどのロゴ・投稿者名の透かしは、保存した時に付いた物なので、テロップやクセとして書かないでください。

### ジャンル・動画の型(ランキング・比較・採点・割合・手順・Q&Aなど、どの型か)
### 工程6 人物の位置(顔の位置・顔の大きさ・人が画面のどこに、どのくらいの大きさで映っているか)
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
  if (file.youtubeUrl) return { fileData: { fileUri: file.youtubeUrl } };
  const cached = referenceUploads.get(file.absolutePath);
  if (cached && cached.expiresAt > Date.now()) return cached.part;
  const uploaded = await uploadGeminiFile(ai, { file: file.absolutePath, config: { mimeType: file.mimeType } });
  if (!uploaded.name || !uploaded.uri) throw new Error("見た目の手本のアップロードに失敗しました");
  await waitForGeminiFileActive(ai, uploaded.name);
  const part: Part = { fileData: { fileUri: uploaded.uri, mimeType: file.mimeType } };
  referenceUploads.set(file.absolutePath, { part, expiresAt: Date.now() + UPLOAD_REUSE_MS });
  return part;
};

/** 見た目の手本を、見出しを付けて並べる。 */
const referenceMedia = async (ai: GoogleGenAI, references: StyleReferenceFile[]): Promise<Part[]> => {
  const media: Part[] = [];
  for (const [index, file] of references.entries()) {
    media.push({ text: `【見た目の手本${index + 1}(${file.youtubeUrl ? "動画(YouTube)" : file.kind === "video" ? "動画" : "スクリーンショット"})】` });
    media.push(await referencePart(ai, file));
  }
  return media;
};

/** 見た目の手本から、配置(人物・字幕・タイトル・枠の位置と大きさ)を数字で読み取らせる指示文。 */
export const REFERENCE_LAYOUT_PROMPT = `
上は、これから編集する動画のために選ばれた「見た目の手本」です。今回の動画を手本と同じ配置にするため、手本の画面の配置を数字で読み取ってください。
位置・大きさは、縦長の画面の幅・高さに対する%(0〜100。左上が0)で答えます。手本に無い物はnullにしてください。
- face: 話している人の顔。xPercent・yPercent=顔の中心、heightPercent=顔(髪の生え際からあごまで)の高さ。人が映っていなければnull。
- caption: 話した言葉を出す基本の字幕(強調した字幕ではない、ふつうの字幕)。topPercent=字幕の1行目の上端の高さ、charHeightPercent=1文字の高さ。
  どの字幕も色付き・大きい見た目で、ふつうの字幕と強調した字幕の区別が無い時は、その字幕で答える。話した言葉の字幕が1つも無い時だけnull。
- title: 動画のあいだずっと出ているタイトル。align(left=左寄せ・center=中央寄せ)、xPercent=左寄せなら文字の左端・中央寄せなら文字の中心、
  yPercent=タイトル全体の縦の中心、charHeightPercent=1文字の高さ。無ければnull。
- frames: ランキングの枠のように、項目を入れる枠を縦に並べている時の、枠の横の中心(xPercent)と枠の幅(widthPercent)。無ければnull。
動画の手本では、動画の大半での位置を答えてください。手本が複数ある時は、手本1を優先してください。
TikTokなどのロゴ・投稿者名の透かしは、タイトルや字幕として数えないでください。
`.trim();

const nullableObject = (properties: Record<string, Schema>, required: string[]): Schema => ({
  type: Type.OBJECT,
  nullable: true,
  properties,
  required,
});
const referenceLayouts = new Map<string, { layout: ReferenceLayout | null; expiresAt: number }>();

/**
 * 見た目の手本の配置を読み取る(工程6・7・8で、人物・字幕・タイトル・枠を手本と同じ所に置くため)。
 * 見た目の手本が無い・読み取れない時はnull(今までの決まった配置にする)。同じ手本の組み合わせなら1回だけ読み取る。
 */
export const readReferenceLayout = async (references: StyleReferenceFile[] | undefined): Promise<ReferenceLayout | null> => {
  if (!references || references.length === 0) return null;
  const key = references.map((file) => file.absolutePath).join("|");
  const cached = referenceLayouts.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.layout;
  const media = await referenceMedia(client(), references);
  const percent = z.number().min(0).max(100);
  const result = await askJson({
    model: STEP_MODEL,
    label: "見た目の手本の配置",
    parts: [...media, { text: REFERENCE_LAYOUT_PROMPT }],
    schema: {
      type: Type.OBJECT,
      properties: {
        face: nullableObject(
          { xPercent: { type: Type.NUMBER }, yPercent: { type: Type.NUMBER }, heightPercent: { type: Type.NUMBER } },
          ["xPercent", "yPercent", "heightPercent"]
        ),
        caption: nullableObject({ topPercent: { type: Type.NUMBER }, charHeightPercent: { type: Type.NUMBER } }, ["topPercent", "charHeightPercent"]),
        title: nullableObject(
          {
            align: { type: Type.STRING, format: "enum", enum: ["left", "center"] },
            xPercent: { type: Type.NUMBER },
            yPercent: { type: Type.NUMBER },
            charHeightPercent: { type: Type.NUMBER },
          },
          ["align", "xPercent", "yPercent", "charHeightPercent"]
        ),
        frames: nullableObject({ xPercent: { type: Type.NUMBER }, widthPercent: { type: Type.NUMBER } }, ["xPercent", "widthPercent"]),
      },
      required: ["face", "caption", "title", "frames"],
    },
    parse: z.object({
      face: z.object({ xPercent: percent, yPercent: percent, heightPercent: percent }).nullable().default(null),
      caption: z.object({ topPercent: percent, charHeightPercent: percent }).nullable().default(null),
      title: z
        .object({ align: z.enum(["left", "center"]), xPercent: percent, yPercent: percent, charHeightPercent: percent })
        .nullable()
        .default(null),
      frames: z.object({ xPercent: percent, widthPercent: percent }).nullable().default(null),
    }),
  }).catch((error) => {
    // 読み取れなくても編集は続けられる(今までの決まった配置にする)
    console.warn("[edit-step] 見た目の手本の配置を読み取れませんでした", error);
    return null;
  });
  // 読み取れなかった時は覚えない(次の工程で読み取り直す。以前は失敗を覚えてしまい、工程6〜8がすべて決まった配置になった)
  if (!result) return null;
  const layout = toReferenceLayout(result);
  referenceLayouts.set(key, { layout, expiresAt: Date.now() + UPLOAD_REUSE_MS });
  return layout;
};

/**
 * 見た目の手本を見せる部分と、そこから工程・チェック項目に沿って読み取ったメモ(見た目の手本が無ければ空)。
 * メモは同じ手本の組み合わせなら1回だけ作って使い回す。
 */
const referenceParts = async (references: StyleReferenceFile[] | undefined): Promise<Part[]> => {
  if (!references || references.length === 0) return [];
  const ai = client();
  const media = await referenceMedia(ai, references);
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

// EC-1.1: 過去の完成動画(手本選び AI-1)とクセ帳は使わないので、それを付ける部品は写していない

/** JSONで答えてもらい、形を確かめて返す。混んでいる時だけ少し待って頼み直す。 */
const askJson = async <T>(params: {
  model: string;
  parts: Part[];
  schema: Schema;
  parse: z.ZodType<T>;
  label: string;
  /** 1回の答えを待つ時間(ミリ秒)。絵をたくさん見せる時は長めにする。 */
  timeoutMs?: number;
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
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Gemini API timeout")), params.timeoutMs ?? TIMEOUT_MS)),
        ])
      );
      const parsed = params.parse.safeParse(JSON.parse(response.text ?? "{}"));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        lastError = new Error(`${params.label}: AIの答えの形が違いました(${issue ? `${issue.path.join(".")}: ${issue.message}` : "不明"})`);
        // 答えの形が違うのは、たまたまのことが多いので、もう一度だけ聞き直す
        if (attempt < Math.min(2, MAX_ATTEMPTS)) continue;
        throw lastError;
      }
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
     文字は短く(1つ全角10文字以内)。文字同士・文字と線が重ならないように置く。
   - 部品の色は、土台の塗りと違う色にする(土台と同じ色で塗ると見えない。黒い円の上に黒い切れを描いて、何も見えない円グラフになったことがある)。`;

/**
 * 工程8の指示文。figureViewBoxHeight は、AIが図を描く箱の縦の大きさ(横は1000)。人と字幕を避けて図を置ける所が無ければ null。
 */
export const OBJECTS_PROMPT = (figureViewBoxHeight: number | null, hasReferences = false) => `
添付した動画は、ショート動画の素材です。編集で画面に置く物(左上のタイトルと、話の中身を見せる枠・カード・図)を決めてください。
${hasReferences
  ? "見た目と出方は、見た目の手本と同じにしてください(手本と同じ書体・色・縁取り・帯・線・塗り・角の丸み・出方)。\nタイトルの文言・項目の数・図の中身は、手本ではなく、今回の動画で話している内容から決めてください。"
  : "見た目と出方は、手本とクセ帳の編集チームの物に近づけてください。"}

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
   - 土台(svg・texts)は、最初の部品と一緒に出る「中身がまだ入っていない状態」にする(空の円グラフの外枠、項目名と「/20」だけの採点表など)。
     数字・答え・結果は、字幕ができた後の工程で、話に合わせて足していく。
${FIGURE_DRAWING_RULES}
   - 動画の中で実際に話している内容だけを図にする。言っていない項目・数字は入れない。
   - 読みやすいよう、文字と背景の色をはっきり分ける(動画の上に直接描くので、必要なら白か黒の板を敷く)。`
}

- 書体は次から選ぶ: ${FONT_HINTS}
- 出方は次から選ぶ: ${ANIMATION_HINTS}
- 色は #RRGGBB で書く。${hasReferences
  ? "色の数は、見た目の手本どおりでよい。"
  : "タイトル・枠・図・テロップを合わせた動画全体の色は、白・黒を除いて3色以内にする(チェック項目。白・黒は数えない)。"}
- タイトル・枠・カードの位置・大きさ・並べ方はツールの側で決める${hasReferences ? "(見た目の手本と同じ所に置く)" : ""}ので書かない。

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

/** 工程8で、見た目の手本から読み取った型がある時に足す指示文。 */
export const TEMPLATE_OBJECTS_NOTE = (template: { titleLines: number; kind: "ranking" | "compare" | "none"; wording?: string; hasCta: boolean }) => `
【見た目の手本から読み取った型があります】書体・色・帯・位置・大きさ・出方は、こちらで手本どおりにします。あなたは中身(文言と数)だけを決めてください。
- title: 手本と同じ${template.titleLines}行で書く(行の切れ目に改行\\nを入れる。言葉の途中で切らない)。${template.wording ? `言い回しの形も手本に合わせる(手本の形: ${template.wording})。手本の文言・題材は持ち込まず、今回の動画で話している内容で書く。` : ""}
- layout: 今回の動画の話の内容から選ぶ。手本の出し方は「${{ ranking: "ranking(ランキングの枠)", compare: "compare(比べるカード)", none: "none(枠なし)" }[template.kind]}」。
  話の内容が手本の出し方に合う時はそれを選ぶ。合わない時(手本はランキングなのに、話は2つを比べている等)は、話の内容に合う物を選ぶ(話の内容を優先する)。
- frameCount: ranking なら挙げる項目の数(順位の数)。compare なら比べている物の数(2〜4。AとBを比べるなら2)。
${template.hasCta
  ? `- cta: 動画の最後に出す一言(手本と同じ役目の、見ている人への案内。例: 予約・相談・フォローへの誘い)。全角24文字以内、改行\\nを1つまで。
  今回の動画の最後で話している案内があれば、それに合わせる。言っていない約束(「無料」「今だけ」など)は入れない。`
  : "- cta: 空の文字で答える。"}
`.trim();

/** 8. 左上のタイトルと、画面に置く物(ランキングの枠・比べるカード・図)を決める。 */
export const decideObjects = async (input: {
  absolutePath: string;
  mimeType: string;
  references?: StyleReferenceFile[];
  /** 図を描く箱の縦の大きさ(横は1000)。図を置ける所が無ければ null。 */
  figureViewBoxHeight: number | null;
  /** 見た目の手本の型がある時: タイトルの行数・言い回しの形と、手本の出し方(見た目と置き方は型どおりにするので、AIには文言と数だけを考えてもらう)。 */
  template?: { titleLines: number; kind: "ranking" | "compare" | "none"; wording?: string; hasCta: boolean };
}): Promise<{
  title: string;
  layout: ObjectLayout;
  frameCount: number;
  look: ObjectLook;
  figure: { idea: string; base: FigureLayer } | null;
  /** 最後の一言(型に最後の一言がある時だけ。無ければ空)。 */
  cta: string;
  reason: string;
}> => {
  const part = await videoPart(client(), input.absolutePath, input.mimeType);
  // EC-1.1: 過去の完成動画とクセ帳は見せない(試しに編集する動画の正解が入っているため。真似する手本は見た目の手本だけ)
  const examples: Part[] = [];
  const guide: Part[] = [];
  const references = await referenceParts(input.references);
  const result = await askJson({
    model: STEP_MODEL,
    label: "タイトルと枠",
    parts: [
      ...examples,
      ...guide,
      ...references,
      { text: "【ここから、今回編集する動画】" },
      part,
      { text: OBJECTS_PROMPT(input.figureViewBoxHeight, references.length > 0) },
      ...(input.template ? [{ text: TEMPLATE_OBJECTS_NOTE(input.template) }] : []),
    ],
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
        cta: { type: Type.STRING },
        reason: { type: Type.STRING },
      },
      required: ["title", "titleLook", "layout", "frameCount", "frameLook", "figure", "cta", "reason"],
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
      cta: z.string().default(""),
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
    // 比べるカードの数: 型がある時は比べている物の数(2〜4)。型が無い時は今まで通り2枚
    frameCount: layout === "ranking" ? clamp(result.frameCount, 2, 10) : layout === "compare" ? (input.template ? clamp(result.frameCount, 2, 4) : 2) : 0,
    figure,
    cta: input.template?.hasCta ? [...result.cta.trim()].slice(0, 30).join("") : "",
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
  | {
      kind: "frames";
      layout: "ranking" | "compare";
      frameCount: number;
      topicHeading?: boolean;
      /** 比べるカードの中身(型がある時)。text の時だけ、話題ごとの中身の文字を入れる。無ければ今まで通り(text)。 */
      cardContent?: "image" | "text" | "none";
      /** 選ばれた方に丸を付ける(型にある時)。 */
      marker?: boolean;
    }
  | { kind: "figure"; idea: string; viewBoxHeight: number; base: FigureLayer }
  | { kind: "none" };

/** 比べるカードで、今の話題の見出しを入れる番号(template.ts の TOPIC_FRAME と同じ)。 */
const COMPARE_TOPIC_FRAME = 9;

const objectsSection = (objects: PlacedObjects): string => {
  if (objects.kind === "frames" && objects.layout === "compare") {
    const n = objects.frameCount;
    const sides = n === 2 ? "左(1)・右(2)" : `左から1〜${n}`;
    const withContents = (objects.cardContent ?? "text") === "text";
    return `
画面の下には、比べる物を入れるカードが${n}枚、${sides}に並んでいます。比べる物それぞれについて、
- frame: 入れるカード(1〜${n})。話に出てくる順に1から。
- index: その物の名前が初めて出てくる字幕の番号(上の一覧の番号)。
- label: カードに入れる短い言葉。比べる物の名前を、そのまま全角8文字以内で。
を frameItems で答えてください。${
      withContents
        ? `
話が進んで、比べる中身(費用・期間・方法など)を話題ごとに言う時は、同じカードに続けて答えてください
(index: その物のその中身を言う字幕の番号、label: その中身だけを全角8文字以内で。例「約100万円」)。
カードの上の行には名前が残り、下の行の中身が話題ごとに入れ替わります。言っていない中身は入れない。`
        : `
カードには名前と、その物の絵だけを出します(手本どおり)。話題ごとの中身は答えない(名前だけを答える)。`
    }${
      objects.topicHeading
        ? `
また、カードの上には「今どの話題か」の見出しが出ます。話題(費用・期間・痛みなど)が変わるごとに、
- frame: ${COMPARE_TOPIC_FRAME}(見出し)
- index: その話題を話し始める字幕の番号
- label: 話題の名前を全角8文字以内で(例「費用」「治療期間」)
も frameItems に答えてください。`
        : ""
    }${
      objects.marker
        ? `
話題ごとに「この話題ではこちらが良い・勝ち」と言い切った所では、選ばれた方のカードに丸が出ます。その所ごとに、
- frame: 選ばれた方のカードの番号(1〜${n})
- index: 選ばれた方の名前を言い切る字幕の番号(その字幕を出している間だけ丸が出る。この字幕は強調テロップにも選ぶ)
を marks で答えてください。どちらとも言っていない話題・「同じくらい」の話題には付けない。`
        : ""
    }
figureItems は空の配列で答えてください。`;
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
画面には、前の工程で描いた図(横1000 × 縦${objects.viewBoxHeight} の座標)の土台が、最初の部品と一緒に出ます。
図の中身: ${objects.idea}
土台の絵(SVG): ${objects.base.svg || "(なし)"}
土台の文字: ${JSON.stringify(objects.base.texts)}

話に合わせて図に足していく部品を、話す順に figureItems で答えてください(2〜12個)。部品ごとに、
- index: その部品を出し始める字幕の番号(上の一覧の番号)。その中身(数字・点数・答えなど)を言う字幕。
- label: 何を足すかの短い説明(確認用。全角20文字以内)。
- svg・texts: 足す絵と文字。土台と同じ座標で、土台に重ねて描く。前に出した部品は消えずに残るので、足す分だけ書く。
  ただし、前の文字と同じ位置に新しい文字を置くと、前の文字はその時に消える(採点表で次の物の点数に変わる時は、同じ枠の同じ位置に新しい点数を書けばよい。白い四角などで隠さなくてよい)。
${FIGURE_DRAWING_RULES}
   - 言っていない数字・項目は入れない。円グラフの切れは、土台の円と同じ中心・半径で、言った割合どおりの角度で描く。
frameItems は空の配列で答えてください。`;
  }
  return `
この動画には中身を入れていく枠や図が無いので、frameItems・figureItems は空の配列で答えてください。`;
};

/** 比べるカード1枚に入れる物の上限(名前と、話題ごとの中身)。 */
const MAX_COMPARE_CARD_ITEMS = 8;

/** 工程10の指示文。 */
export const EMPHASIS_PROMPT = (
  captions: string[],
  objectColorsLine = "",
  objects: PlacedObjects = { kind: "none" },
  hasReferences = false
) => `
次は、ショート動画の字幕を順に並べたものです(番号: 字幕)。
${captions.map((caption, index) => `${index + 1}: ${caption.replace(/\n/g, "")}`).join("\n")}

この中から、強調テロップ(基本の字幕とは違う、目立つ見た目の字幕)にしたい字幕を選んでください。
- ランキングや「〇選」のように項目を順に挙げていく動画では、項目名(順位・用語・商品名など、挙げていく物の名前)の
  字幕を、1つ目から最後まで全部選ぶ。項目の説明・答えの字幕は選ばない。
- それ以外の動画では、見ている人に一番残したい言葉が入った字幕(答え・数字・結論・本音やオチの一言)を、全体の3割までで選ぶ。
- 説明・つなぎ・前置き・締めのあいさつの字幕は選ばない。
- 効果を言い切る言葉(「絶対治る」「痛くない」など)を含む字幕は選ばない。

あわせて、字幕の見た目を、${hasReferences
  ? "見た目の手本と同じにしてください(手本の基本の字幕・強調した字幕と同じ書体・色・縁取り・帯)。選ぶ字幕(中身)は、今回の動画で話している内容から選んでください"
  : "手本とクセ帳の編集チームの物に近づけて決めてください"}。
- baseLook: 基本テロップ(強調しない字幕)の見た目。fontFamily(書体)・style(outline=縁取り文字 / pill=色付きの帯の上に白い文字)・
  accentColor(outlineなら縁取りの色、pillなら帯の色)。
- emphasisLook: 強調テロップの見た目。fontFamily(書体)・textColor(文字の色)・bandColor(文字の後ろに敷く帯の色。敷かないならnull)。
- 書体は次から選ぶ: ${FONT_HINTS}
- 色は #RRGGBB で書く。${hasReferences
  ? "色の数・書体の数は、見た目の手本どおりでよい。"
  : "動画全体の色は、白・黒を除いて3色以内にする(チェック項目。白・黒は数えない)。書体は基本と強調で2つまで(チェック項目)。"}
- 強調テロップは、基本テロップと見て違いが分かる見た目にする(基本と同じ色・同じ書体にしない。灰色など、目立たない色にしない)。
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
  /** 見た目の手本の型の、強調した字幕の見た目の種類(役割)。2つ以上ある時は、選んだ字幕ごとにどれを使うかも決めてもらう。 */
  emphasisRoles?: string[];
}): Promise<{
  /** style は emphasisRoles の番号(0始まり。種類が1つ以下なら0)。 */
  picks: { index: number; reason: string; style: number }[];
  look: CaptionLook;
  lookReason: string;
  /** 枠に入れる項目(index は0始まりの字幕の番号)。 */
  frameItems: { frame: number; index: number; label: string }[];
  /** 図に足す部品(index は0始まりの字幕の番号)。 */
  figureItems: (FigureLayer & { index: number; label: string })[];
  /** 比べるカードで、選ばれた方に丸を付ける所(index は0始まりの字幕の番号)。 */
  marks: { frame: number; index: number }[];
}> => {
  const { captions } = input;
  // EC-1.1: 過去の完成動画とクセ帳は見せない(試しに編集する動画の正解が入っているため。真似する手本は見た目の手本だけ)
  const examples: Part[] = [];
  const guide: Part[] = [];
  const references = await referenceParts(input.references);
  const colorsLine = input.objectColors?.length && references.length === 0
    ? `- タイトル・枠・図ですでに白・黒のほかに ${input.objectColors.join("・")} を使っているので、字幕(と図に足す部品)もこの色(か白・黒)から選ぶと3色以内に収まる。`
    : "";
  const roles = input.emphasisRoles ?? [];
  const rolesNote =
    roles.length >= 2
      ? `\n\n【強調テロップの見た目は、見た目の手本どおり${roles.length}種類あります】選んだ字幕ごとに、どの見た目にするかを styles(picksと同じ順。番号)で答えてください。\n${roles
          .map((role, index) => `${index + 1}: ${role}`)
          .join("\n")}\n手本でその見た目を使っている役割に合う字幕に使う。迷ったら1。`
      : "";
  const result = await askJson({
    model: STEP_MODEL,
    label: "強調テロップ",
    parts: [
      ...examples,
      ...guide,
      ...references,
      { text: "【ここから、今回編集する動画】" },
      { text: EMPHASIS_PROMPT(captions, colorsLine, input.objects, references.length > 0) + rolesNote },
    ],
    schema: {
      type: Type.OBJECT,
      properties: {
        picks: { type: Type.ARRAY, items: { type: Type.INTEGER } },
        reasons: { type: Type.ARRAY, items: { type: Type.STRING } },
        styles: { type: Type.ARRAY, items: { type: Type.INTEGER } },
        marks: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: { frame: { type: Type.INTEGER }, index: { type: Type.INTEGER } },
            required: ["frame", "index"],
          },
        },
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
      required: ["picks", "reasons", "styles", "marks", "baseLook", "emphasisLook", "lookReason", "frameItems", "figureItems"],
    },
    parse: z.object({
      picks: z.array(z.number().int()),
      reasons: z.array(z.string()),
      styles: z.array(z.number().int()).default([]),
      marks: z.array(z.object({ frame: z.number().int(), index: z.number().int() })).default([]),
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
    const style = (result.styles[i] ?? 1) - 1;
    return [{ index, reason: result.reasons[i] ?? "", style: style >= 0 && style < roles.length ? style : 0 }];
  });
  // 枠に入れる項目: 番号が範囲外・同じ枠に2つ目・字幕の番号が範囲外の物は外す。長すぎる言葉は8文字で切る。
  // 比べるカードは、名前の後に話題ごとの中身を続けて入れるので、同じカードに何個か入れてよい(同じ字幕の2つ目は外す)
  const frameCount = input.objects.kind === "frames" ? input.objects.frameCount : 0;
  const isCompare = input.objects.kind === "frames" && input.objects.layout === "compare";
  // 比べるカードの見出し(今の話題)は、カードの番号と別の番号で入れる
  const topicAllowed = isCompare && input.objects.kind === "frames" && Boolean(input.objects.topicHeading);
  // カードに名前だけを出す型では、話題ごとの中身は入れない(同じカードの2つ目からは外す)
  const namesOnly = isCompare && input.objects.kind === "frames" && input.objects.cardContent !== undefined && input.objects.cardContent !== "text";
  const used = new Set<string>();
  const perFrame = new Map<number, number>();
  const frameItems = result.frameItems.flatMap((item) => {
    const index = item.index - 1;
    const label = [...item.label.replace(/\s+/g, "")].slice(0, 8).join("");
    const usedKey = isCompare ? `${item.frame}:${index}` : String(item.frame);
    const isTopic = topicAllowed && item.frame === COMPARE_TOPIC_FRAME;
    if (!isTopic && (item.frame < 1 || item.frame > frameCount)) return [];
    if (used.has(usedKey)) return [];
    const perFrameLimit = isTopic ? MAX_COMPARE_CARD_ITEMS : isCompare ? (namesOnly ? 1 : MAX_COMPARE_CARD_ITEMS) : 1;
    if ((perFrame.get(item.frame) ?? 0) >= perFrameLimit) return [];
    if (index < 0 || index >= captions.length || !label) return [];
    used.add(usedKey);
    perFrame.set(item.frame, (perFrame.get(item.frame) ?? 0) + 1);
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
  // 丸: 丸を付ける型の時だけ。カード・字幕の番号が範囲外の物は外す
  const marks =
    isCompare && input.objects.kind === "frames" && input.objects.marker
      ? result.marks.flatMap((mark) => {
          const index = mark.index - 1;
          if (mark.frame < 1 || mark.frame > frameCount || index < 0 || index >= captions.length) return [];
          return [{ frame: mark.frame, index }];
        })
      : [];
  return { picks, look: { base: result.baseLook, emphasis: result.emphasisLook }, lookReason: result.lookReason, frameItems, figureItems, marks };
};

/** 画像の棚から、項目に合う画像を選ばせる指示文。 */
export const LIBRARY_PICK_PROMPT = (items: string[], library: { name: string; description: string }[]) => `
ショート動画のランキングの枠・比べるカードに、項目の絵を入れます。次の画像の棚から、それぞれの項目に一番合う画像を選んでください。
【項目】
${items.map((item, index) => `${index + 1}: ${item}`).join("\n")}
【画像の棚】(番号: 名前 - 何が描いてあるか)
${library.map((image, index) => `${index + 1}: ${image.name} - ${image.description}`).join("\n")}

- その項目そのものが描いてある画像を選ぶ(例: 果物の名前なら、その果物の絵)。
- 同じ画像を2つの項目に使わない。合う画像が無い項目は 0 にする(違う物を無理に選ばない)。
項目の順に、選んだ画像の番号(picks)を答えてください。
`.trim();

/** 10. 枠・カードに入れる項目ごとに、画像の棚から合う画像を選ぶ(合う物が無ければ null)。 */
export const pickLibraryImages = async (
  items: string[],
  library: { name: string; description: string }[]
): Promise<(number | null)[]> => {
  if (items.length === 0 || library.length === 0) return [];
  const result = await askJson({
    model: STEP_MODEL,
    label: "枠に入れる画像",
    parts: [{ text: LIBRARY_PICK_PROMPT(items, library) }],
    schema: { type: Type.OBJECT, properties: { picks: { type: Type.ARRAY, items: { type: Type.INTEGER } } }, required: ["picks"] },
    parse: z.object({ picks: z.array(z.number().int()) }),
  });
  const used = new Set<number>();
  return items.map((_, i) => {
    const pick = (result.picks[i] ?? 0) - 1;
    if (pick < 0 || pick >= library.length || used.has(pick)) return null;
    used.add(pick);
    return pick;
  });
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

/** 見た目の手本から型を読み取る処理(templateExtract.ts)でも使う部品。 */
export { STEP_MODEL, askJson, client as geminiClient, referenceMedia, FONT_VALUES, FONT_HINTS, color as colorParse, nullableColor as nullableColorParse, colorSchema, nullableColorSchema };
