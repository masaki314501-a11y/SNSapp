/**
 * 手本(data/edit-examples)の完成動画と書き起こしをまとめてAIに見せ、この編集者の「編集のクセ帳」を作る。
 * 自動編集では、量(1分あたり何個)を合わせるより、この編集者が「どんな場面を、どう見せるか」というクセと雰囲気を
 * 真似させたいので、それを文章にして毎回見せる(data/edit-examples/style-guide.md)。
 * 手本を足した・入れ替えた時に作り直す。1回ごとにGemini(Pro)の料金がかかる。
 *   set -a; source .env.local; set +a
 *   npx vite-node --config vitest.config.ts scripts/eval/build-style-guide.ts
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI, type Part } from "@google/genai";
import { editExampleMediaPath, listEditExamples, roundNumbers, uploadExampleVideo } from "@/lib/gemini/editExamplesStore";

const OUT = path.join(process.cwd(), "data", "edit-examples", "style-guide.md");

/** 書き起こしから、編集のクセを読むのに要らない物(字幕の文・顔の位置)を外して短くする。 */
const compact = (breakdown: unknown) =>
  JSON.stringify(breakdown, (key, value) => (["face", "narration", "referenceNotes"].includes(key) ? undefined : roundNumbers(key, value)));

const PROMPT = `
上の動画はすべて、同じ編集者(またはその編集チーム)が歯科医院の先生のショート動画を編集した完成版です。
それぞれの動画の後に、その動画で画面に出している物の書き起こし(JSON。clipsの秒数ごとに、文字・画像・図形・寄り・効果音)を付けています。

これから、この編集者のクセと雰囲気を真似して、別の新しい動画をAIが自動編集します。そのAIに渡す「編集のクセ帳」を書いてください。

## 一番大事な前提
自動編集では「その動画の中身に合わせた編集」が最優先です。クセ帳は量の目標ではなく、
「この編集者なら、こういう場面をこう見せる」という判断のしかたと見た目の言葉を伝える物です。
「1分あたり〇個」のような数の目標は書かないでください(数は、動画の中身に合わせて編集した結果として決まる物です)。

## 書くこと(日本語・Markdown。見出しはこの順で)
### 1. この編集者の編集の考え方
全体の雰囲気・テンポ・見る人に何を伝えようとしているか。派手さと落ち着きのバランス。3〜6行。
### 2. 場面ごとの見せ方
「こういう場面では → こう見せる」の形で、できるだけ多く(15〜30個)。場面は動画の中身で書く
(例: 「質問者が項目を投げかけた瞬間」「先生が順位や答えを言った瞬間」「先生の本音・ツッコミ」「答え合わせ」「費用の話」
「症状の見た目の話」「締め」)。見せ方は、何を・画面のどこに・どんな見た目(色・帯・枠・大きさ)で・どんな音で出すかまで具体的に。
### 3. 動画の型ごとの組み立て方
ランキング・2つの比較・採点・手順・割合・Q&A解説など、この編集者が作っている型ごとに、画面の組み立て
(ずっと出している物・その位置・埋めていく順番)と、冒頭のつかみ方・締め方。
### 4. 見た目の言葉
文字(字幕・ラベル・タイトル)の書体の系統・色・縁取り・帯、差し色の使い方、枠やカードの形、画像の出し方、位置の決まりごと。
### 5. 音とテンポ
効果音をどんな瞬間にどの種類で鳴らすか、寄りをどんな時に使うか、間の詰め方。
### 6. この編集者がやらないこと
避けている演出・見せ方。

## 書き方の決まり
- 書き起こしの文言(項目名・国名・治療名など)を例として書く時は、「(例: 〇〇の動画では『学生 40%』)」のように、どの動画の例かが分かる形にする。
  新しい動画にその文言を持ち込ませないため。
- 動画ごとの違いが大きい所は「型によって違う」と書き分ける。共通するクセを先に書く。
- 医療広告として問題になる演出(ビフォーアフター写真、有名人の写真、「圧倒的」「〇分で終わる」のような言い切り)は、
  クセとして書かない(6のやらないことにも入れず、触れない)。
- 全体で4000字以内。
`.trim();

const main = async () => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const uploaded: string[] = [];
  try {
    const parts: Part[] = [];
    for (const [index, example] of (await listEditExamples()).entries()) {
      parts.push({ text: `【完成動画${index + 1}「${example.label}」】` });
      parts.push(await uploadExampleVideo(ai, editExampleMediaPath(example, "correct")!, example.correctMimeType, uploaded, "low"));
      if (example.breakdown) parts.push({ text: `【完成動画${index + 1}の書き起こし】\n${compact(example.breakdown)}` });
      console.log(`[style-guide] ${example.label} を追加`);
    }
    parts.push({ text: PROMPT });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_AUTO_EDIT_MODEL || "gemini-pro-latest",
      contents: [{ role: "user", parts }],
    });
    const guide = (response.text ?? "").trim();
    if (!guide) throw new Error("クセ帳が空でした");
    const usage = response.usageMetadata;
    console.log(`[style-guide] 入力${usage?.promptTokenCount}トークン 出力${usage?.candidatesTokenCount}トークン`);
    await writeFile(OUT, `${guide}\n`);
    console.log(`[style-guide] ${OUT} に保存しました(${guide.length}字)`);
  } finally {
    for (const name of uploaded) await ai.files.delete({ name }).catch(() => {});
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
