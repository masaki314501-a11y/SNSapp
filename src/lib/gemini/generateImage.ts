import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { runWithGeminiRateLimit } from "./rateLimiter";
import { isRetryableApiError, toFriendlyGeminiError } from "./geminiErrors";

/**
 * 自動編集で「使える画像」が足りない所に出す画像を、Gemini(Nano Banana)で作る。
 *
 * 医療・歯科・美容・健康の動画では、作った画像を本物の症例写真のように見せると、医療広告のルール上
 * 「事実と違う・誤解させる表現」になりうる。また歯並びのような写真はAI画像が苦手で、歯の形がおかしくなりやすい。
 * そのため画風は自動編集の判断(generatedImageStyle)で「イラスト・図解風」か「写真風」を選ばせ、
 * 医療系はイラスト必須にしている。作った画像を使った動画には「※画像はイメージです」を添える(autoEditPlan.ts)。
 *
 * 1枚あたり数円〜十円ほどかかるため、「モデル+画風+描く内容」から決まるファイル名で保存して使い回す
 * (別の案を作る・やり直す、といった場面で同じ画像に何度も課金しないように。voiceoverCache.tsと同じ考え方)。
 */
const DEFAULT_MODEL = "gemini-3.1-flash-image";
const GENERATED_DIR = path.join(process.cwd(), "public", "images", "generated");
const GEMINI_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 8_000;

export type GeneratedImageStyle = "illustration" | "photo";

const STYLE_INSTRUCTIONS: Record<GeneratedImageStyle, string> = {
  illustration:
    "清潔感のある、やさしい色のフラットなイラスト(図解風)。写真のようなリアルな描き方はしない。背景は白か淡い単色。",
  photo: "自然な光の、写真のような画像。背景はすっきりさせ、主役を画面の中央に大きく写す。",
};

const resolveModel = (): string => process.env.GEMINI_IMAGE_MODEL || DEFAULT_MODEL;

/** 指示文(buildPrompt)を変えたら上げる。前の指示で作った画像を使い回さないように。 */
const PROMPT_VERSION = 3;

const cacheKeyFor = (description: string, style: GeneratedImageStyle): string =>
  createHash("sha256").update(`${resolveModel()} v${PROMPT_VERSION} ${style} ${description}`).digest("hex").slice(0, 32);

const fileExists = (filePath: string): Promise<boolean> =>
  access(filePath).then(
    () => true,
    () => false
  );

const buildPrompt = (description: string, style: GeneratedImageStyle): string =>
  `縦型ショート動画の画面に小さく重ねる、説明用の画像を1枚作ってください。
描く内容: ${description}
画風: ${STYLE_INSTRUCTIONS[style]}
- 動画では小さく、数秒しか映らない。描く内容の「普通とどこが違うか」が一目でわかるよう、その特徴を大げさなくらい
  誇張して、画面の真ん中に大きく描く。特徴と関係ない部分は省いて単純にする
- 名前に動物・物の名前が比喩として入っていても(「バニーティース」=うさぎのような前歯、「出っ歯」等)、
  その動物や物は描かない。体の部位の話なら、その部位そのものだけを描く
- 文字・数字・記号・ロゴは一切入れない(動画側で文字を重ねるため)
- 横長(4:3)の画面いっぱいに、描く内容だけを大きく描く。枠線や余白の飾りは付けない`;

const EXTENSION_BY_MIME: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

const generateImage = async (
  description: string,
  style: GeneratedImageStyle
): Promise<{ buffer: Buffer; extension: string }> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEYが未設定です");
  const ai = new GoogleGenAI({ apiKey });
  const model = resolveModel();

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await runWithGeminiRateLimit(() =>
        Promise.race([
          ai.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: buildPrompt(description, style) }] }],
            config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "4:3", imageSize: "1K" } },
          }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Gemini API timeout")), GEMINI_TIMEOUT_MS)),
        ])
      );
      const image = response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
      if (!image?.data) throw new Error("画像が返ってきませんでした");
      console.info(`[generateImage] model=${response.modelVersion ?? model} 「${description.slice(0, 30)}」を作りました`);
      return { buffer: Buffer.from(image.data, "base64"), extension: EXTENSION_BY_MIME[image.mimeType ?? ""] ?? "png" };
    } catch (error) {
      lastError = error;
      if (isRetryableApiError(error) && attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
        continue;
      }
      throw toFriendlyGeminiError(error);
    }
  }
  throw toFriendlyGeminiError(lastError);
};

/** 描く内容と画風から画像を作り(作ってあれば使い回し)、public/配下の相対パスを返す。 */
export const getOrGenerateImage = async (
  description: string,
  style: GeneratedImageStyle
): Promise<{ path: string; cached: boolean }> => {
  const key = cacheKeyFor(description, style);
  // 返ってくる形式(PNG/JPEG)はモデル次第なので、どの拡張子で保存してあっても使い回す。
  for (const extension of Object.values(EXTENSION_BY_MIME)) {
    if (await fileExists(path.join(GENERATED_DIR, `${key}.${extension}`))) {
      return { path: `images/generated/${key}.${extension}`, cached: true };
    }
  }
  const { buffer, extension } = await generateImage(description, style);
  await mkdir(GENERATED_DIR, { recursive: true });
  await writeFile(path.join(GENERATED_DIR, `${key}.${extension}`), buffer);
  return { path: `images/generated/${key}.${extension}`, cached: false };
};
