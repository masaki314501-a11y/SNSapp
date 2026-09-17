import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Content, GoogleGenAI, Part } from "@google/genai";
import { waitForGeminiFileActive } from "./geminiFiles";
import { extractedStyleSchema, type ExtractedStyle } from "./styleTypes";

/**
 * スタイル抽出(extractStyle)のfew-shot例(正解データ)を保存する場所。
 * public/ ではなく data/ 配下に置くのは、Render等のデプロイ環境ではコンテナの
 * ファイルシステムが実行時に永続化されないため(README参照)。開発者が
 * `npm run dev` でこのページから登録し、生成された data/style-examples/ を
 * 通常のファイルとしてgitコミットすることで初めて本番にも反映される想定。
 */
const DATA_DIR = path.join(process.cwd(), "data", "style-examples");
const MEDIA_DIR = path.join(DATA_DIR, "media");
const METADATA_PATH = path.join(DATA_DIR, "examples.json");

/** 手元にある動画/画像をまとめて取り込むための受け皿(README参照)。 */
export const STYLE_EXAMPLES_INBOX_DIR = path.join(DATA_DIR, "inbox");
const INBOX_MANIFEST_PATH = path.join(STYLE_EXAMPLES_INBOX_DIR, "answers.json");

/** few-shotとして一度に渡す件数の上限。増やしすぎるとプロンプトサイズ・コスト・
 * (動画の場合は)アップロード待ち時間が増える。 */
const MAX_FEW_SHOT_EXAMPLES = 6;

const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const VIDEO_MIME_EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-m4v": "m4v",
};
const EXTENSION_MIME_TYPES: Record<string, string> = Object.fromEntries(
  Object.entries({ ...IMAGE_MIME_EXTENSIONS, ...VIDEO_MIME_EXTENSIONS }).map(([mime, ext]) => [ext, mime])
);

export const isSupportedStyleExampleMimeType = (mimeType: string): boolean =>
  mimeType in IMAGE_MIME_EXTENSIONS || mimeType in VIDEO_MIME_EXTENSIONS;

export const styleExampleKindForMimeType = (mimeType: string): "image" | "video" | null => {
  if (mimeType in IMAGE_MIME_EXTENSIONS) return "image";
  if (mimeType in VIDEO_MIME_EXTENSIONS) return "video";
  return null;
};

const styleExampleSchema = z.object({
  id: z.string(),
  kind: z.enum(["image", "video"]),
  mediaFilename: z.string(),
  mimeType: z.string(),
  correctStyle: extractedStyleSchema,
  label: z.string().optional(),
  createdAt: z.string(),
});

export type StyleExample = z.infer<typeof styleExampleSchema>;

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

const writeMetadata = async (examples: StyleExample[]): Promise<void> => {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(METADATA_PATH, `${JSON.stringify(examples, null, 2)}\n`, "utf-8");
};

export const listStyleExamples = (): Promise<StyleExample[]> => readMetadata();

export const addStyleExample = async (input: {
  kind: "image" | "video";
  mediaBuffer: Buffer;
  extension: string;
  mimeType: string;
  correctStyle: ExtractedStyle;
  label?: string;
}): Promise<StyleExample> => {
  const id = randomUUID();
  const mediaFilename = `${id}.${input.extension}`;
  await mkdir(MEDIA_DIR, { recursive: true });
  await writeFile(path.join(MEDIA_DIR, mediaFilename), input.mediaBuffer);

  const example: StyleExample = {
    id,
    kind: input.kind,
    mediaFilename,
    mimeType: input.mimeType,
    correctStyle: input.correctStyle,
    label: input.label,
    createdAt: new Date().toISOString(),
  };

  const examples = await readMetadata();
  examples.push(example);
  await writeMetadata(examples);
  return example;
};

export const deleteStyleExample = async (id: string): Promise<boolean> => {
  const examples = await readMetadata();
  const target = examples.find((example) => example.id === id);
  if (!target) return false;

  await writeMetadata(examples.filter((example) => example.id !== id));
  await unlink(path.join(MEDIA_DIR, target.mediaFilename)).catch(() => {});
  return true;
};

export const readStyleExampleMedia = async (
  id: string
): Promise<{ buffer: Buffer; mimeType: string } | null> => {
  const examples = await readMetadata();
  const target = examples.find((example) => example.id === id);
  if (!target) return null;

  try {
    const buffer = await readFile(path.join(MEDIA_DIR, target.mediaFilename));
    return { buffer, mimeType: target.mimeType };
  } catch {
    return null;
  }
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

const inboxManifestSchema = z.record(
  z.string(),
  z.object({
    correctStyle: extractedStyleSchema,
    label: z.string().optional(),
  })
);

/**
 * data/style-examples/inbox/ に置いた動画・画像ファイルと、同じ場所のanswers.json
 * (ファイル名→正解データのマニフェスト)をまとめて正解データとして取り込む。
 * 取り込み済みのファイルはinbox内から削除する(answers.jsonからも該当エントリを除去)。
 * 手元に用意した学習データをUIで1件ずつアップロードしなくて済むようにするための機能。
 */
export const importStyleExamplesFromInbox = async (): Promise<{
  imported: { fileName: string; id: string }[];
  skipped: { fileName: string; reason: string }[];
}> => {
  const imported: { fileName: string; id: string }[] = [];
  const skipped: { fileName: string; reason: string }[] = [];

  let manifestRaw: string;
  try {
    manifestRaw = await readFile(INBOX_MANIFEST_PATH, "utf-8");
  } catch {
    return { imported, skipped: [{ fileName: "answers.json", reason: "answers.jsonが見つかりません" }] };
  }
  const manifestParsed = inboxManifestSchema.safeParse(JSON.parse(manifestRaw));
  if (!manifestParsed.success) {
    return {
      imported,
      skipped: [{ fileName: "answers.json", reason: `内容が不正です: ${manifestParsed.error.message}` }],
    };
  }
  const manifest = manifestParsed.data;
  const remainingManifest: typeof manifest = { ...manifest };

  for (const [fileName, entry] of Object.entries(manifest)) {
    const extension = (fileName.split(".").pop() ?? "").toLowerCase();
    const mimeType = EXTENSION_MIME_TYPES[extension];
    const kind = mimeType ? styleExampleKindForMimeType(mimeType) : null;
    if (!mimeType || !kind) {
      skipped.push({ fileName, reason: `対応していない拡張子です: .${extension || "unknown"}` });
      continue;
    }

    const filePath = path.join(STYLE_EXAMPLES_INBOX_DIR, fileName);
    let buffer: Buffer;
    try {
      buffer = await readFile(filePath);
    } catch {
      skipped.push({ fileName, reason: "ファイルが見つかりません(answers.jsonにだけ記載されています)" });
      continue;
    }

    const example = await addStyleExample({
      kind,
      mediaBuffer: buffer,
      extension,
      mimeType,
      correctStyle: entry.correctStyle as ExtractedStyle,
      label: entry.label,
    });
    imported.push({ fileName, id: example.id });
    delete remainingManifest[fileName];
    await unlink(filePath).catch(() => {});
  }

  await writeFile(INBOX_MANIFEST_PATH, `${JSON.stringify(remainingManifest, null, 2)}\n`, "utf-8");

  return { imported, skipped };
};

/** inbox内にファイルが残っているか(未記載のファイル名も含む)を軽く確認する用途。 */
export const listInboxFiles = async (): Promise<string[]> => {
  try {
    const entries = await readdir(STYLE_EXAMPLES_INBOX_DIR);
    const ignored = new Set(["answers.json", "answers.example.json", "README.md"]);
    return entries.filter((name) => !ignored.has(name) && !name.startsWith("."));
  } catch {
    return [];
  }
};

