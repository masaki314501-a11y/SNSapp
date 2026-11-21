import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ReferenceTemplate } from "./template";

/** 見た目の手本ごとの型(data/reference-templates/*.json)。 */
const TEMPLATE_DIR = path.join(process.cwd(), "data", "reference-templates");

/** 手本の保存場所から、型を探す時の名前(ファイル名から拡張子を除いた物。YouTubeは動画のID)。 */
export const referenceIdOf = (referencePath: string): string => path.basename(referencePath).replace(/\.[^.]+$/, "");

const loadTemplates = async (): Promise<ReferenceTemplate[]> => {
  const names = await readdir(TEMPLATE_DIR).catch(() => [] as string[]);
  const templates = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        try {
          return JSON.parse(await readFile(path.join(TEMPLATE_DIR, name), "utf8")) as ReferenceTemplate;
        } catch (error) {
          console.warn(`[referenceTemplate] ${name} を読めませんでした`, error);
          return null;
        }
      })
  );
  return templates.filter((template): template is ReferenceTemplate => template !== null);
};

/** 選んだ手本のうち、型がある最初の手本の型。どれにも型が無ければ null(今まで通り、AIが手本を見て決める)。 */
export const findReferenceTemplate = async (referencePaths: string[]): Promise<ReferenceTemplate | null> => {
  if (referencePaths.length === 0) return null;
  const templates = await loadTemplates();
  for (const referencePath of referencePaths) {
    const id = referenceIdOf(referencePath);
    const found = templates.find((template) => template.referenceIds.includes(id));
    if (found) return found;
  }
  return null;
};
