/**
 * 手本(data/edit-examples)の完成動画と書き起こしをまとめてAIに見せ、編集マニュアルの工程とチェック項目に沿った
 * 「工程別のクセ帳」(data/edit-examples/step-guide.md)を作る。工程ごとに編集の工程8・10で、手本の動画と一緒にAIへ渡す。
 * 手本の編集に近づけるには、効果音よりも、ジャンル・オブジェクト(タイトル・枠)の見た目と動き・書体と強調のクセが大事なので、
 * そこを詳しく書かせる。手本を足した・入れ替えた時に作り直す。1回ごとにGemini(Pro)の料金がかかる。
 *   set -a; source .env.local; set +a
 *   npx vite-node --config vitest.config.ts scripts/eval/build-step-guide.ts
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI, type Part } from "@google/genai";
import { editExampleMediaPath, listEditExamples, roundNumbers, uploadExampleVideo } from "@/lib/gemini/editExamplesStore";
import { STEP_GUIDE_PROMPT } from "@/lib/editSteps/guidePrompt";

const OUT = path.join(process.cwd(), "data", "edit-examples", "step-guide.md");

/** 書き起こしから、クセを読むのに要らない物(字幕の文・顔の位置)を外して短くする。 */
const compact = (breakdown: unknown) =>
  JSON.stringify(breakdown, (key, value) => (["face", "narration", "referenceNotes"].includes(key) ? undefined : roundNumbers(key, value)));



const main = async () => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const uploaded: string[] = [];
  try {
    const parts: Part[] = [];
    for (const [index, example] of (await listEditExamples()).entries()) {
      parts.push({ text: `【完成動画${index + 1}「${example.label}」】` });
      parts.push(await uploadExampleVideo(ai, editExampleMediaPath(example, "correct")!, example.correctMimeType, uploaded, "low"));
      if (example.breakdown) parts.push({ text: `【完成動画${index + 1}の書き起こし】\n${compact(example.breakdown)}` });
      console.log(`[step-guide] ${example.label} を追加`);
    }
    parts.push({ text: STEP_GUIDE_PROMPT });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_AUTO_EDIT_MODEL || "gemini-pro-latest",
      contents: [{ role: "user", parts }],
    });
    const guide = (response.text ?? "").trim();
    if (!guide) throw new Error("クセ帳が空でした");
    const usage = response.usageMetadata;
    console.log(`[step-guide] 入力${usage?.promptTokenCount}トークン 出力${usage?.candidatesTokenCount}トークン`);
    await writeFile(OUT, `${guide}\n`);
    console.log(`[step-guide] ${OUT} に保存しました(${guide.length}字)`);
  } finally {
    for (const name of uploaded) await ai.files.delete({ name }).catch(() => {});
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
