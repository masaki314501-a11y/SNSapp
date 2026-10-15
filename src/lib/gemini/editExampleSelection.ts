import { GoogleGenAI, PartMediaResolutionLevel, Type, type Part } from "@google/genai";
import { z } from "zod";
import { runWithGeminiRateLimit } from "./rateLimiter";
import {
  MAX_EDIT_FEW_SHOT_EXAMPLES,
  listEditExamples,
  type EditExample,
} from "./editExamplesStore";

/**
 * 手本(学習動画+正解動画)の中から「今回の動画に近いもの」を選んで自動編集に見せるための処理。
 *
 * 以前は新しい順に最大3件を見せていたが、手本が増えると、題材も動画の型(ランキング/比較/解説など)も
 * 違う手本ばかりが選ばれて、「こういう編集をしてほしい」が伝わりにくくなる。
 * 近い手本を選ぶ判断は軽い作業なので、自動編集本体(Pro)ではなく軽いモデルに任せる。
 * また、選ぶたびに全手本の動画を見せ直すと重いため、手本側は登録時に作った短い説明文(profile)だけを渡す
 * (説明文はdata/edit-examples/examples.jsonに保存済み。登録用の開発者ページは廃止した)。
 */
const DEFAULT_MODEL = "gemini-flash-latest";
const GEMINI_TIMEOUT_MS = 180_000;

const withTimeout = <T>(promise: Promise<T>): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Gemini API timeout")), GEMINI_TIMEOUT_MS)),
  ]);

const pickResponseSchema = z.object({
  picks: z.array(z.number().int()),
  reason: z.string().optional(),
});

/**
 * 自動編集に見せる手本を、今回の動画に近い順に選ぶ(先頭が一番近い)。
 * 手本が上限以下でも毎回選ぶ。以前は上限以下なら全部見せていたが、型の違う手本(比較の動画など)まで
 * 見せると、ランキングの動画に「日本」「韓国」のような別の動画の文言が持ち込まれたため、
 * 当てはまらない手本は外す(1つも当てはまらなければ手本無しで編集する)。
 * 選ぶのは手本の説明文(profile)を比べるだけの軽い呼び出しなので、毎回行っても負担は小さい。
 * 選ぶのに失敗しても自動編集自体は止めず、以前と同じ「新しい順」に戻す。
 * userVideoPartは自動編集本体に渡すのと同じアップロード済みの動画(二重にアップロードしない)。
 */
export const selectEditExamples = async (ai: GoogleGenAI, userVideoPart: Part): Promise<EditExample[]> => {
  const all = await listEditExamples();
  const newest = all.slice(-MAX_EDIT_FEW_SHOT_EXAMPLES).reverse();
  if (all.length === 0) return [];

  // 番号で答えさせる(UUIDをそのまま書き写させると、1文字違いで一致しないことがあるため)
  const candidates = all
    .map((example, index) => {
      const description = example.profile ?? example.notes ?? "(説明なし。タイトルから判断してください)";
      return `${index + 1}. 「${example.label}」: ${description}`;
    })
    .join("\n");

  try {
    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
    const response = await runWithGeminiRateLimit(() =>
      withTimeout(
        ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                { text: "【これから編集する動画(編集前の素材)】" },
                // 近さの判断には題材・話し方・映り方が分かれば十分なので、低解像度で安く済ませる
                { ...userVideoPart, mediaResolution: { level: PartMediaResolutionLevel.MEDIA_RESOLUTION_LOW } },
                {
                  text: `この動画を縦型ショート動画に編集します。編集の手本として見せるのに向いたものを、次の手本の一覧から
近い順に最大${MAX_EDIT_FEW_SHOT_EXAMPLES}個選び、番号で答えてください。
「近い」は、題材・ジャンルよりも、動画の型(ランキング・比較・解説など)と話し手の映り方・話し方が似ていて、
同じような編集がそのまま当てはまりそうかどうかを重視してください。
動画の型が違い、同じような編集が当てはまらない手本は選ばないでください(1つも当てはまらなければ空の配列で答える)。

${candidates}`,
                },
              ],
            },
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                picks: { type: Type.ARRAY, items: { type: Type.INTEGER } },
                reason: { type: Type.STRING },
              },
              required: ["picks"],
            },
          },
        })
      )
    );
    const parsed = pickResponseSchema.safeParse(JSON.parse(response.text ?? "{}"));
    if (!parsed.success) throw new Error("手本の選択結果を読み取れませんでした");

    const picked: EditExample[] = [];
    for (const number of parsed.data.picks) {
      const example = all[number - 1];
      if (example && !picked.includes(example)) picked.push(example);
      if (picked.length >= MAX_EDIT_FEW_SHOT_EXAMPLES) break;
    }
    // 選ばれなかった手本で数を埋めない(型の違う手本を見せると、その動画の文言まで持ち込まれるため)
    console.info(
      `[editExampleSelection] 手本を選択: ${picked.length > 0 ? picked.map((example) => example.label).join(" / ") : "なし"}` +
        (parsed.data.reason ? ` (理由: ${parsed.data.reason})` : "")
    );
    return picked;
  } catch (error) {
    console.warn("[editExampleSelection] 近い手本の選択に失敗したため、新しい順で見せます", error);
    return newest;
  }
};
