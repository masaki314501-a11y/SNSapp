import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";
import { z } from "zod";

/**
 * 画像の棚。自動編集でAIが作った画像を、名前と説明付きで貯めておき、次からは作らずに使い回す
 * (画像は1枚約10円かかるため。棚から選ぶ処理は gemini/imageLibraryMatch.ts)。
 *
 * 置き場所は2つ。
 * - data/image-library/(リポジトリに入れる。デプロイしても消えない。最初に用意しておく画像と、手元で作った画像)
 * - Cloudflare R2(R2_*の環境変数があるときだけ)。本番(Renderの無料プラン)は実行中に書いたファイルが
 *   デプロイのたびに消えるので、本番で作った画像はR2にも置いて、次に起動したときに読み戻す。
 * 動画からは `images/library/<ファイル名>` で参照し、/api/media がここから配信する。
 */
const LIBRARY_DIR = path.join(process.cwd(), "data", "image-library");
const IMAGES_DIR = path.join(LIBRARY_DIR, "images");
const CATALOG_PATH = path.join(LIBRARY_DIR, "catalog.json");
const REMOTE_CATALOG_KEY = "image-library/catalog.json";
const remoteImageKey = (file: string) => `image-library/images/${file}`;

export const LIBRARY_SRC_PREFIX = "images/library/";
export const LIBRARY_FILE_PATTERN = /^[0-9a-zA-Z_-]+\.(png|jpg|jpeg|webp)$/;

const libraryImageSchema = z.object({
  id: z.string(),
  /** 短い名前(「開咬」など)。 */
  name: z.string(),
  /** 何が描いてあるか。棚から選ぶときに、AIが欲しい画像の説明と見比べる。 */
  description: z.string(),
  style: z.enum(["illustration", "photo"]),
  file: z.string().regex(LIBRARY_FILE_PATTERN),
  createdAt: z.string(),
});
export type LibraryImage = z.infer<typeof libraryImageSchema>;
const catalogSchema = z.array(libraryImageSchema);

export const libraryImageSrc = (image: Pick<LibraryImage, "file">): string => `${LIBRARY_SRC_PREFIX}${image.file}`;

const r2 = (() => {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  const client = new AwsClient({
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
  const urlOf = (key: string) => `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${key}`;
  return {
    get: async (key: string): Promise<Buffer | null> => {
      const res = await client.fetch(urlOf(key));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`R2から読めませんでした(${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    },
    put: async (key: string, body: Buffer | string, contentType: string): Promise<void> => {
      const res = await client.fetch(urlOf(key), {
        method: "PUT",
        body: typeof body === "string" ? body : new Uint8Array(body),
        headers: { "Content-Type": contentType },
      });
      if (!res.ok) throw new Error(`R2に保存できませんでした(${res.status})`);
    },
  };
})();

const parseCatalog = (text: string | null | undefined): LibraryImage[] => {
  if (!text) return [];
  const parsed = catalogSchema.safeParse(JSON.parse(text));
  return parsed.success ? parsed.data : [];
};

const mergeCatalogs = (...lists: LibraryImage[][]): LibraryImage[] => {
  const byId = new Map<string, LibraryImage>();
  for (const list of lists) for (const image of list) if (!byId.has(image.id)) byId.set(image.id, image);
  return [...byId.values()];
};

let catalogPromise: Promise<LibraryImage[]> | null = null;

/** 棚の一覧。手元の一覧とR2の一覧を合わせたもの(起動して最初の1回だけ読み、あとはメモリに持つ)。 */
export const loadImageLibrary = (): Promise<LibraryImage[]> => {
  catalogPromise ??= (async () => {
    const local = parseCatalog(await readFile(CATALOG_PATH, "utf8").catch(() => null));
    if (!r2) return local;
    try {
      return mergeCatalogs(local, parseCatalog((await r2.get(REMOTE_CATALOG_KEY))?.toString("utf8")));
    } catch (error) {
      console.warn("[imageLibrary] R2の棚の一覧を読めなかったため、手元の分だけを使います", error);
      return local;
    }
  })();
  return catalogPromise;
};

// 棚への追加は1件ずつ順番に行う(同時に一覧を書き換えて、片方の追加が消えないように)。
let writeQueue: Promise<unknown> = Promise.resolve();

/** 作った画像を棚に足す。R2があればそちらにも置く(失敗しても手元には残すので、動画づくりは止めない)。 */
export const addToImageLibrary = (
  entry: Omit<LibraryImage, "file" | "createdAt">,
  buffer: Buffer,
  extension: string
): Promise<LibraryImage> => {
  const run = writeQueue.then(async () => {
    const image: LibraryImage = { ...entry, file: `${entry.id}.${extension}`, createdAt: new Date().toISOString() };
    await mkdir(IMAGES_DIR, { recursive: true });
    await writeFile(path.join(IMAGES_DIR, image.file), buffer);
    const catalog = mergeCatalogs(await loadImageLibrary(), [image]);
    catalogPromise = Promise.resolve(catalog);
    await writeFile(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
    if (r2) {
      try {
        await r2.put(remoteImageKey(image.file), buffer, extension === "png" ? "image/png" : `image/${extension === "jpg" ? "jpeg" : extension}`);
        // ほかの所から足された分を消さないよう、R2の一覧を読み直してから足す。
        const remote = parseCatalog((await r2.get(REMOTE_CATALOG_KEY))?.toString("utf8"));
        await r2.put(REMOTE_CATALOG_KEY, JSON.stringify(mergeCatalogs(remote, [image])), "application/json");
      } catch (error) {
        console.warn(`[imageLibrary] 画像「${image.name}」をR2に置けませんでした(この起動中は手元の分を使います)`, error);
      }
    }
    return image;
  });
  writeQueue = run.catch(() => undefined);
  return run;
};

/**
 * 棚の画像ファイルの場所を返す。手元に無ければ(デプロイで消えた等)R2から取ってくる。どこにも無ければnull。
 */
export const resolveLibraryImageFile = async (file: string): Promise<string | null> => {
  if (!LIBRARY_FILE_PATTERN.test(file)) return null;
  const localPath = path.join(IMAGES_DIR, file);
  if (await stat(localPath).then((s) => s.isFile(), () => false)) return localPath;
  if (!r2) return null;
  try {
    const buffer = await r2.get(remoteImageKey(file));
    if (!buffer) return null;
    await mkdir(IMAGES_DIR, { recursive: true });
    await writeFile(localPath, buffer);
    return localPath;
  } catch (error) {
    console.warn(`[imageLibrary] 画像${file}をR2から取れませんでした`, error);
    return null;
  }
};
