import { GoogleGenAI, PartMediaResolutionLevel, Type, type Part } from "@google/genai";
import { z } from "zod";
import { runWithGeminiRateLimit } from "./rateLimiter";
import {
  MAX_EDIT_FEW_SHOT_EXAMPLES,
  editExampleMediaPath,
  listEditExamples,
  updateEditExampleProfile,
  uploadExampleVideo,
  type EditExample,
} from "./editExamplesStore";

/**
 * 手本(学習動画+正解動画)の中から「今回の動画に近いもの」を選んで自動編集に見せるための処理。
 *
 * 以前は新しい順に最大3件を見せていたが、手本が増えると、題材も動画の型(ランキング/比較/解説など)も
 * 違う手本ばかりが選ばれて、「こういう編集をしてほしい」が伝わりにくくなる。
 * 近い手本を選ぶ判断は軽い作業なので、自動編集本体(Pro)ではなく軽いモデルに任せる。
 * また、選ぶたびに全手本の動画を見せ直すと重いため、手本側は登録時に作った短い説明文(profile)だけを渡す。
 */
const DEFAULT_MODEL = "gemini-flash-latest";
const GEMINI_TIMEOUT_MS = 180_000;
const MAX_PROFILE_LENGTH = 400;

const withTimeout = <T>(promise: Promise<T>): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Gemini API timeout")), GEMINI_TIMEOUT_MS)),
  ]);

const createClient = (): GoogleGenAI => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEYが未設定です");
  return new GoogleGenAI({ apiKey });
};

const profileResponseSchema = z.object({ profile: z.string().min(1) });

/**
 * 手本の動画をGeminiに見せ、「似た動画を探すための索引」になる短い説明を書かせて保存する。
 * 近さを比べる相手は自動編集に来る本人の動画(=編集前の素材)なので、学習動画(編集前)があれば
 * それも見せて、題材・話し方は素材から、編集の特徴は正解動画から読み取らせる。
 */
export const describeEditExample = async (example: EditExample): Promise<EditExample | null> => {
  const ai = createClient();
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const uploadedFileNames: string[] = [];
  try {
    const parts: Part[] = [];
    const rawPath = editExampleMediaPath(example, "raw");
    if (rawPath && example.rawMimeType) {
      parts.push({ text: "【編集前の素材】" });
      parts.push(await uploadExampleVideo(ai, rawPath, example.rawMimeType, uploadedFileNames));
    }
    parts.push({ text: "【編集後の完成版】" });
    parts.push(
      await uploadExampleVideo(ai, editExampleMediaPath(example, "correct")!, example.correctMimeType, uploadedFileNames)
    );
    parts.push({
      text: `これは縦型ショート動画の編集の手本です(タイトル: ${example.label}${example.notes ? ` / メモ: ${example.notes}` : ""})。
あとで「これから編集する別の動画」と見比べて、近い手本を選ぶための索引を書いてください。
次の点を、日本語で${MAX_PROFILE_LENGTH}字以内にまとめてください。
- 題材・ジャンル(例: 歯科矯正の解説、飲食店の紹介)
- 動画の型(例: ランキング、比較、解説、体験談、Q&A、ビフォーアフター)
- 話し手の映り方(例: 顔出しで一人がカメラに向かって話す、手元だけ、話し手なし)
- 尺とテンポ
- 編集の特徴(フックの作り方、テロップ・強調・寄り・効果音の使い方)`,
    });

    const response = await runWithGeminiRateLimit(() =>
      withTimeout(
        ai.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: { profile: { type: Type.STRING } },
              required: ["profile"],
            },
          },
        })
      )
    );
    const parsed = profileResponseSchema.safeParse(JSON.parse(response.text ?? "{}"));
    if (!parsed.success) throw new Error("手本の説明を読み取れませんでした");
    return updateEditExampleProfile(example.id, parsed.data.profile.trim().slice(0, MAX_PROFILE_LENGTH));
  } finally {
    for (const name of uploadedFileNames) {
      await ai.files.delete({ name }).catch(() => {});
    }
  }
};

/** 説明がまだ無い手本(この仕組みを入れる前に登録したもの等)の説明をまとめて作る。 */
export const describeMissingEditExamples = async (): Promise<{ described: number; failed: number }> => {
  const missing = (await listEditExamples()).filter((example) => !example.profile);
  let described = 0;
  let failed = 0;
  for (const example of missing) {
    try {
      await describeEditExample(example);
      described++;
    } catch (error) {
      failed++;
      console.warn(`[editExampleSelection] 手本(${example.id})の説明の作成に失敗しました`, error);
    }
  }
  return { described, failed };
};

const pickResponseSchema = z.object({
  picks: z.array(z.number().int()),
  reason: z.string().optional(),
});

/**
 * 自動編集に見せる手本を選ぶ。手本が上限以下なら全部見せればよいので、Geminiには聞かない
 * (余計な呼び出しで時間とお金を使わないため)。選ぶのに失敗しても自動編集自体は止めず、
 * 以前と同じ「新しい順」に戻す。
 * userVideoPartは自動編集本体に渡すのと同じアップロード済みの動画(二重にアップロードしない)。
 */
export const selectEditExamples = async (ai: GoogleGenAI, userVideoPart: Part): Promise<EditExample[]> => {
  const all = await listEditExamples();
  const newest = all.slice(-MAX_EDIT_FEW_SHOT_EXAMPLES).reverse();
  if (all.length <= MAX_EDIT_FEW_SHOT_EXAMPLES) return newest;

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
    // 選ばれた数が足りなければ新しい順で埋める(見せる手本の数は減らさない)
    for (const example of newest) {
      if (picked.length >= MAX_EDIT_FEW_SHOT_EXAMPLES) break;
      if (!picked.includes(example)) picked.push(example);
    }
    console.info(
      `[editExampleSelection] 手本を選択: ${picked.map((example) => example.label).join(" / ")}` +
        (parsed.data.reason ? ` (理由: ${parsed.data.reason})` : "")
    );
    return picked;
  } catch (error) {
    console.warn("[editExampleSelection] 近い手本の選択に失敗したため、新しい順で見せます", error);
    return newest;
  }
};
