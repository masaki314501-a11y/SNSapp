import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Content, GoogleGenAI, Part } from "@google/genai";
import { waitForGeminiFileActive } from "./geminiFiles";
import { extractedStyleSchema } from "./styleTypes";

/**
 * スタイル抽出(extractStyle)のfew-shot例(正解データ)を保存する場所。
 * 登録済みの正解データ(data/style-examples/)を読むだけにしている(登録用の開発者ページは廃止した)。
 * 増やす時は、data/style-examples/ のファイルを直接編集してgitコミットする。
 */
const DATA_DIR = path.join(process.cwd(), "data", "style-examples");
const MEDIA_DIR = path.join(DATA_DIR, "media");
const METADATA_PATH = path.join(DATA_DIR, "examples.json");

/** few-shotとして一度に渡す件数の上限。増やしすぎるとプロンプトサイズ・コスト・
 * (動画の場合は)アップロード待ち時間が増える。 */
const MAX_FEW_SHOT_EXAMPLES = 6;

const styleExampleSchema = z.object({
  id: z.string(),
  kind: z.enum(["image", "video"]),
  mediaFilename: z.string(),
  mimeType: z.string(),
  correctStyle: extractedStyleSchema,
  label: z.string().optional(),
  createdAt: z.string(),
});

type StyleExample = z.infer<typeof styleExampleSchema>;

const readMetadata = async (): Promise<StyleExample[]> => {
  let raw: string;
  try {
    raw = await readFile(METADATA_PATH, "utf-8");
  } catch {
    return [];
  }
  const parsed = z.array(styleExampleSchema).safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : [];
};

/**
 * 登録済みの正解データをfew-shot例(メディア→正解JSON のuser/modelターン)として
 * Geminiリクエストに差し込むための`Content`配列を組み立てる。動画は都度File APIに
 * アップロードするため(extractStyle本体の動画アップロードと同様)、呼び出し元は
 * リクエスト完了後に`uploadedFileNames`を削除すること。登録が無ければ空配列。
 * 新しく登録したものほど優先(末尾から上限件数を取る)。
 */
export const loadStyleFewShotContext = async (
  ai: GoogleGenAI
): Promise<{ contents: Content[]; uploadedFileNames: string[] }> => {
  const examples = (await readMetadata()).slice(-MAX_FEW_SHOT_EXAMPLES);

  const contents: Content[] = [];
  const uploadedFileNames: string[] = [];

  for (const example of examples) {
    try {
      const mediaPath = path.join(MEDIA_DIR, example.mediaFilename);
      let mediaPart: Part;
      if (example.kind === "video") {
        const uploaded = await ai.files.upload({ file: mediaPath, config: { mimeType: example.mimeType } });
        if (!uploaded.name || !uploaded.uri) continue;
        uploadedFileNames.push(uploaded.name);
        await waitForGeminiFileActive(ai, uploaded.name);
        mediaPart = { fileData: { fileUri: uploaded.uri, mimeType: example.mimeType } };
      } else {
        const buffer = await readFile(mediaPath);
        mediaPart = { inlineData: { mimeType: example.mimeType, data: buffer.toString("base64") } };
      }
      contents.push({ role: "user", parts: [mediaPart] });
      contents.push({ role: "model", parts: [{ text: JSON.stringify(example.correctStyle) }] });
    } catch (error) {
      console.warn(`[styleExamplesStore] few-shot例(${example.id})の読み込みに失敗したためスキップします`, error);
    }
  }
  return { contents, uploadedFileNames };
};
