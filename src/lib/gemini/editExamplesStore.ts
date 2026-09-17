import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Content, GoogleGenAI, Part } from "@google/genai";
import { waitForGeminiFileActive } from "./geminiFiles";

/**
 * 自動編集(バズる動画)機能のfew-shot例として使う「編集の正解データ」を保存する場所。
 * styleExamplesStore.tsとは別物(色などの構造化値ではなく、動画ペアそのものが正解データ)。
 * data/ 配下に置く理由・gitコミットが必要な理由はstyleExamplesStore.tsと同じ
 * (Render等のデプロイ環境は実行時に書いたファイルを永続化しないため)。
 */
const DATA_DIR = path.join(process.cwd(), "data", "edit-examples");
const CORRECT_MEDIA_DIR = path.join(DATA_DIR, "media", "correct");
const RAW_MEDIA_DIR = path.join(DATA_DIR, "media", "raw");
const METADATA_PATH = path.join(DATA_DIR, "examples.json");

/** few-shotとして一度に渡す件数の上限。画像のスタイル抽出(6件)よりも大幅に絞る。
 * 動画のアップロード・解析はコスト/時間が重く、無料枠の1日あたりの上限も厳しいため。 */
const MAX_EDIT_FEW_SHOT_EXAMPLES = 2;

const VIDEO_MIME_EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-m4v": "m4v",
};

export const isSupportedEditExampleVideoMimeType = (mimeType: string): boolean =>
  mimeType in VIDEO_MIME_EXTENSIONS;

export const extensionForVideoMimeType = (mimeType: string): string | null =>
  VIDEO_MIME_EXTENSIONS[mimeType] ?? null;

/** ファイル名をOSのファイルエクスプローラーでも中身が分かるようにするためのスラッグ化。
 * Windows/Macで問題になる記号だけを取り除き、日本語ラベルはそのまま残す
 * (無理にローマ字化せず、可読性を優先する)。 */
const slugify = (label: string): string => {
  const cleaned = label
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return cleaned.length > 0 ? cleaned : "example";
};

const buildMediaFilename = (label: string, extension: string): string =>
  `${slugify(label)}-${randomUUID().slice(0, 8)}.${extension}`;

const editExampleSchema = z.object({
  id: z.string(),
  label: z.string(),
  notes: z.string().optional(),
  correctMediaFilename: z.string(),
  correctMimeType: z.string(),
  rawMediaFilename: z.string().optional(),
  rawMimeType: z.string().optional(),
  createdAt: z.string(),
});

export type EditExample = z.infer<typeof editExampleSchema>;

const readMetadata = async (): Promise<EditExample[]> => {
  let raw: string;
  try {
    raw = await readFile(METADATA_PATH, "utf-8");
  } catch {
    return [];
  }
  const parsed = z.array(editExampleSchema).safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : [];
};

const writeMetadata = async (examples: EditExample[]): Promise<void> => {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(METADATA_PATH, `${JSON.stringify(examples, null, 2)}\n`, "utf-8");
};

export const listEditExamples = (): Promise<EditExample[]> => readMetadata();

export const addEditExample = async (input: {
  label: string;
  notes?: string;
  correctBuffer: Buffer;
  correctExtension: string;
  correctMimeType: string;
  rawBuffer?: Buffer;
  rawExtension?: string;
  rawMimeType?: string;
}): Promise<EditExample> => {
  await mkdir(CORRECT_MEDIA_DIR, { recursive: true });
  const correctMediaFilename = buildMediaFilename(input.label, input.correctExtension);
  await writeFile(path.join(CORRECT_MEDIA_DIR, correctMediaFilename), input.correctBuffer);

  let rawMediaFilename: string | undefined;
  if (input.rawBuffer && input.rawExtension && input.rawMimeType) {
    await mkdir(RAW_MEDIA_DIR, { recursive: true });
    rawMediaFilename = buildMediaFilename(input.label, input.rawExtension);
    await writeFile(path.join(RAW_MEDIA_DIR, rawMediaFilename), input.rawBuffer);
  }

  const example: EditExample = {
    id: randomUUID(),
    label: input.label,
    notes: input.notes,
    correctMediaFilename,
    correctMimeType: input.correctMimeType,
    rawMediaFilename,
    rawMimeType: input.rawBuffer ? input.rawMimeType : undefined,
    createdAt: new Date().toISOString(),
  };

  const examples = await readMetadata();
  examples.push(example);
  await writeMetadata(examples);
  return example;
};

export const deleteEditExample = async (id: string): Promise<boolean> => {
  const examples = await readMetadata();
  const target = examples.find((example) => example.id === id);
  if (!target) return false;

  await writeMetadata(examples.filter((example) => example.id !== id));
  await unlink(path.join(CORRECT_MEDIA_DIR, target.correctMediaFilename)).catch(() => {});
  if (target.rawMediaFilename) {
    await unlink(path.join(RAW_MEDIA_DIR, target.rawMediaFilename)).catch(() => {});
  }
  return true;
};

export const readEditExampleMedia = async (
  id: string,
  which: "correct" | "raw"
): Promise<{ buffer: Buffer; mimeType: string } | null> => {
  const examples = await readMetadata();
  const target = examples.find((example) => example.id === id);
  if (!target) return null;

  if (which === "raw") {
    if (!target.rawMediaFilename || !target.rawMimeType) return null;
    try {
      const buffer = await readFile(path.join(RAW_MEDIA_DIR, target.rawMediaFilename));
      return { buffer, mimeType: target.rawMimeType };
    } catch {
      return null;
    }
  }

  try {
    const buffer = await readFile(path.join(CORRECT_MEDIA_DIR, target.correctMediaFilename));
    return { buffer, mimeType: target.correctMimeType };
  } catch {
    return null;
  }
};

/**
 * 登録済みの編集例(正解動画)をfew-shotの参考としてGeminiリクエストに差し込むための
 * `Content`配列を組み立てる。styleExamplesStore.tsのfew-shotと違い、編集例は
 * 「入力→正解JSON」のラベル付きペアではなく「良い編集の実例」を見せるだけなので、
 * modelターン(正解の答え合わせ)は積まない。userターン1つに動画+説明文だけを渡す。
 * 正解動画のみを使い、対になる学習(元)動画はコスト抑制のため使わない。
 * 呼び出し元はリクエスト完了後に`uploadedFileNames`を削除すること。
 */
export const loadEditFewShotContext = async (
  ai: GoogleGenAI
): Promise<{ contents: Content[]; uploadedFileNames: string[] }> => {
  const examples = (await readMetadata()).slice(-MAX_EDIT_FEW_SHOT_EXAMPLES);

  const contents: Content[] = [];
  const uploadedFileNames: string[] = [];

  for (const example of examples) {
    try {
      const mediaPath = path.join(CORRECT_MEDIA_DIR, example.correctMediaFilename);
      const uploaded = await ai.files.upload({ file: mediaPath, config: { mimeType: example.correctMimeType } });
      if (!uploaded.name || !uploaded.uri) continue;
      uploadedFileNames.push(uploaded.name);
      await waitForGeminiFileActive(ai, uploaded.name);
      const mediaPart: Part = { fileData: { fileUri: uploaded.uri, mimeType: example.correctMimeType } };
      const description = example.notes?.trim() || example.label;
      contents.push({ role: "user", parts: [mediaPart, { text: `参考になる編集例: ${description}` }] });
    } catch (error) {
      console.warn(`[editExamplesStore] few-shot例(${example.id})の読み込みに失敗したためスキップします`, error);
    }
  }
  return { contents, uploadedFileNames };
};
