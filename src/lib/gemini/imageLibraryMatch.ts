import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import { runWithGeminiRateLimit } from "./rateLimiter";
import type { LibraryImage } from "@/lib/imageLibrary";

/**
 * 自動編集が「こんな画像が欲しい」と書いた物を、画像の棚(imageLibrary.ts)の一覧と見比べ、
 * 同じ物が描いてある画像を選ぶ。見比べるのは名前と説明の文字だけ(画像そのものを見せると1枚ごとに
 * 料金がかかるため)。軽いモデルで足りる作業なので、自動編集本体(Pro)ではなくFlashに任せる。
 *
 * 違う物を選ぶと、話と合わない画像が出てしまう。迷ったら選ばない(=作る)ように厳しめに頼む。
 */
const MATCH_MODEL = "gemini-flash-latest";
const GEMINI_TIMEOUT_MS = 120_000;
/** 一度に見せる棚の画像の上限(説明を短く切っても、数千件になると入力が重くなるため新しい順に絞る)。 */
const MAX_CANDIDATES = 1500;
const MAX_DESCRIPTION_CHARS = 80;

const answerSchema = z.object({
  items: z.array(z.object({ request: z.number().int(), libraryId: z.string().nullable() })),
});

export type ImageRequest = { name: string; description: string };

/** 欲しい画像ごとに、棚の中の同じ画像を返す(無ければ入れない)。失敗したら空(=全部作る)。 */
export const matchLibraryImages = async (
  requests: ImageRequest[],
  library: LibraryImage[]
): Promise<Map<number, LibraryImage>> => {
  const matches = new Map<number, LibraryImage>();
  const apiKey = process.env.GEMINI_API_KEY;
  if (requests.length === 0 || library.length === 0 || !apiKey) return matches;

  const candidates = [...library].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_CANDIDATES);
  const byId = new Map(candidates.map((image) => [image.id, image]));
  const libraryList = candidates
    .map((image) => `${image.id}: ${image.name} — ${image.description.slice(0, MAX_DESCRIPTION_CHARS)}`)
    .join("\n");
  const requestList = requests
    .map((request, index) => `${index}: ${request.name ? `${request.name} — ` : ""}${request.description}`)
    .join("\n");

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await runWithGeminiRateLimit(() =>
      Promise.race([
        ai.models.generateContent({
          model: MATCH_MODEL,
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `ショート動画に出す説明用の画像を、すでにある画像の棚から選びます。
「欲しい画像」それぞれについて、棚の中に「同じ物を、同じ特徴で描いた画像」があればそのidを、無ければnullを答えてください。
- 描いてある物と、その画像で伝えたい特徴(どこが普通と違うか)が両方同じ時だけ選ぶ。
  例: 「出っ歯」が欲しい時に「受け口」は選ばない。「上の前歯2本が大きい」が欲しい時に「前歯全体が小さい」は選ばない
- 似ているだけ・一部だけ同じ・迷う時はnull(新しく作るので、無理に選ばなくてよい)
- 同じ画像を、違う「欲しい画像」に使い回さない

## 欲しい画像(番号: 名前 — 描く内容)
${requestList}

## 棚の画像(id: 名前 — 描いてある内容)
${libraryList}`,
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
                      request: { type: Type.INTEGER },
                      libraryId: { type: Type.STRING, nullable: true },
                    },
                    required: ["request", "libraryId"],
                  },
                },
              },
              required: ["items"],
            },
          },
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Gemini API timeout")), GEMINI_TIMEOUT_MS)),
      ])
    );
    const parsed = answerSchema.safeParse(JSON.parse(response.text ?? "{}"));
    if (!parsed.success) throw new Error("棚から選んだ答えを読み取れませんでした");
    const usedIds = new Set<string>();
    for (const item of parsed.data.items) {
      const image = item.libraryId ? byId.get(item.libraryId.trim()) : undefined;
      if (!image || !requests[item.request] || usedIds.has(image.id) || matches.has(item.request)) continue;
      usedIds.add(image.id);
      matches.set(item.request, image);
    }
  } catch (error) {
    console.warn("[imageLibraryMatch] 棚から選べなかったため、画像は作ります", error);
  }
  return matches;
};
