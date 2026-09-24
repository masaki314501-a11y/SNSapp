import { copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PartMediaResolutionLevel, type Content, type GoogleGenAI, type Part } from "@google/genai";
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

/** few-shotとして一度に渡す件数の上限。1件あたり学習動画+正解動画の2本を送るため、
 * 画像のスタイル抽出(6件)よりは絞る。課金移行前は無料枠の上限のため2件・正解動画のみだった。 */
const MAX_EDIT_FEW_SHOT_EXAMPLES = 3;

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

/**
 * アップロード先のファイルパスを予約する(ディレクトリ作成込み)。実際のバイト列の書き込みは
 * 呼び出し元(APIルート)がリクエストボディをストリームのまま流し込む形で行う。
 * request.formData()を使うとファイル全体が一度メモリ上のBlobに載ってしまい、メモリの少ない
 * 本番環境(Render無料プラン=512MB)で大きい動画のアップロード時にクラッシュするため
 * (詳細はsrc/app/api/upload/route.tsのコメント参照、同じ問題をここでも回避する)。
 */
export const reserveEditExampleMediaPath = async (
  which: "correct" | "raw",
  label: string,
  extension: string
): Promise<{ filename: string; absolutePath: string }> => {
  const dir = which === "raw" ? RAW_MEDIA_DIR : CORRECT_MEDIA_DIR;
  await mkdir(dir, { recursive: true });
  const filename = buildMediaFilename(label, extension);
  return { filename, absolutePath: path.join(dir, filename) };
};

/** ストリーム書き込み済みのメディアファイルをメタデータに登録する。 */
export const registerEditExample = async (input: {
  label: string;
  notes?: string;
  correctMediaFilename: string;
  correctMimeType: string;
  rawMediaFilename?: string;
  rawMimeType?: string;
}): Promise<EditExample> => {
  const example: EditExample = {
    id: randomUUID(),
    label: input.label,
    notes: input.notes,
    correctMediaFilename: input.correctMediaFilename,
    correctMimeType: input.correctMimeType,
    rawMediaFilename: input.rawMediaFilename,
    rawMimeType: input.rawMediaFilename ? input.rawMimeType : undefined,
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
 * Gemini File APIへ動画を1本アップロードし、ACTIVEになるまで待ってPartとして返す。
 * @google/genai SDKはアップロード時に元ファイル名をそのままHTTPヘッダー
 * (X-Goog-Upload-File-Name)に入れるため、日本語ラベルを含むファイル名(buildMediaFilename
 * 参照)だとByteString変換エラーで必ず失敗する。ASCIIのみの一時コピーを経由して回避する
 * (ai.files.uploadにBlobを渡す手もあるが、動画全体をメモリに載せてしまいメモリ不足の
 * 原因になるため、コピーで済ませてメモリには載せない)。
 */
const uploadExampleVideo = async (
  ai: GoogleGenAI,
  mediaPath: string,
  mimeType: string,
  uploadedFileNames: string[]
): Promise<Part> => {
  const tempPath = path.join(os.tmpdir(), `edit-example-${randomUUID()}${path.extname(mediaPath)}`);
  try {
    await copyFile(mediaPath, tempPath);
    const uploaded = await ai.files.upload({ file: tempPath, config: { mimeType } });
    if (!uploaded.name || !uploaded.uri) {
      throw new Error("編集例動画のアップロードに失敗しました");
    }
    uploadedFileNames.push(uploaded.name);
    await waitForGeminiFileActive(ai, uploaded.name);
    // 編集例から読み取りたいのは切り方・効果音・強調のタイミングやテンポで、細部の画質ではない。
    // 低解像度にすると動画のトークン数が約1/3になり、最大6本送ってもコストを抑えられる。
    return {
      fileData: { fileUri: uploaded.uri, mimeType },
      mediaResolution: { level: PartMediaResolutionLevel.MEDIA_RESOLUTION_LOW },
    };
  } finally {
    await unlink(tempPath).catch(() => {});
  }
};

/**
 * 登録済みの編集例をfew-shotの参考としてGeminiリクエストに差し込むための`Content`配列を
 * 組み立てる。styleExamplesStore.tsのfew-shotと違い、編集例は「入力→正解JSON」の
 * ラベル付きペアではなく「良い編集の実例」を見せるだけなので、modelターン(正解の答え合わせ)
 * は積まない。userターン1つに動画+説明文だけを渡す。
 * 学習動画(編集前の元素材)が登録されていれば正解動画と並べて渡し、「素材に対して編集者が
 * 何を足したか(どこに効果音・強調・声を入れたか)」の差分から学ばせる。完成版だけだと
 * 元々の話し方と後から足した演出の区別がつかないため。
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
      const description = example.notes?.trim() || example.label;
      const parts: Part[] = [];
      if (example.rawMediaFilename && example.rawMimeType) {
        parts.push({ text: `【編集例「${description}」の学習動画(編集前の元素材)】` });
        parts.push(
          await uploadExampleVideo(
            ai,
            path.join(RAW_MEDIA_DIR, example.rawMediaFilename),
            example.rawMimeType,
            uploadedFileNames
          )
        );
      }
      parts.push({ text: `【編集例「${description}」の正解動画(プロが編集した完成版)】` });
      parts.push(
        await uploadExampleVideo(
          ai,
          path.join(CORRECT_MEDIA_DIR, example.correctMediaFilename),
          example.correctMimeType,
          uploadedFileNames
        )
      );
      parts.push({
        text: example.rawMediaFilename
          ? "上の2本を見比べ、編集前の素材に対して何が足されたか(フックの作り方、効果音を入れた瞬間と種類、テロップの強調・演出、声で押している箇所、テンポ)を読み取って、これから依頼する編集の手本にしてください。"
          : "この完成版の編集(フックの作り方、効果音を入れた瞬間と種類、テロップの強調・演出、声で押している箇所、テンポ)を読み取って、これから依頼する編集の手本にしてください。",
      });
      contents.push({ role: "user", parts });
    } catch (error) {
      console.warn(`[editExamplesStore] few-shot例(${example.id})の読み込みに失敗したためスキップします`, error);
    }
  }
  return { contents, uploadedFileNames };
};
