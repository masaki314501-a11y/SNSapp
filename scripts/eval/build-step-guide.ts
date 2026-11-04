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
import { CAPTION_ANIMATION_OPTIONS, CAPTION_FONT_FAMILY_OPTIONS } from "@video/shared/schema";
import { editExampleMediaPath, listEditExamples, roundNumbers, uploadExampleVideo } from "@/lib/gemini/editExamplesStore";

const OUT = path.join(process.cwd(), "data", "edit-examples", "step-guide.md");

/** 書き起こしから、クセを読むのに要らない物(字幕の文・顔の位置)を外して短くする。 */
const compact = (breakdown: unknown) =>
  JSON.stringify(breakdown, (key, value) => (["face", "narration", "referenceNotes"].includes(key) ? undefined : roundNumbers(key, value)));

const fonts = CAPTION_FONT_FAMILY_OPTIONS.map((option) => `${option.label}(${option.value})`).join("・");
const animations = CAPTION_ANIMATION_OPTIONS.map((option) => `${option.label}(${option.value})`).join("・");

export const STEP_GUIDE_PROMPT = `
上の動画はすべて、同じ編集チームが歯科医院・医療関係のショート動画を編集した完成版です。
それぞれの動画の後に、その動画で画面に出している物の書き起こし(JSON。clipsの秒数ごとに、文字・画像・図形・寄り・効果音)を付けています。

これから、この編集チームの編集に近づけて、別の新しい動画をAIが工程ごとに編集します。そのAIに渡す「工程別のクセ帳」を書いてください。
編集チームの編集マニュアルの工程は次のとおりです。
1. 撮影したメイン映像をタイムラインに配置する
2. 話し始める前の不要な部分を削除する
3. 言い間違いや言葉に詰まった部分をカットする
4. 説明の間にある長い無音部分を削除する
5. 話の流れが自然になるように前後の映像をつなぐ
6. 必要に応じて映像を拡大し、画面内の人物の位置を整える(人物の顔は中央より少し高めに)
7. テロップの位置を決める(演者の顎より少し下・演者とテロップが被らない)
8. 必要オブジェクトの作成(ランキングの枠・左上タイトルテロップ)
9. テロップを入力(基本テロップの位置は常に固定)
10. 強調したい言葉は違うテロップに変換する
11. 強調変換したテロップに効果音をつける(少し人物を拡大する)

## 一番大事なこと
手本に近づけるために大事なのは、効果音よりも次の3つです。ここを一番詳しく、具体的に書いてください。
- ジャンル・動画の型ごとの違い(ランキング・〇選・2択・比較・採点・手順・Q&A解説など。型によって画面の組み立てがどう変わるか)
- オブジェクト(左上のタイトル・ランキングの枠・一覧・カード)の見た目と動き: 位置・大きさ・形・線の太さ・角の丸み・塗り・色・
  文字の色・帯・書体、出てくる時の動き(いつ・どう出るか)、中身が埋まる時の動き、ずっと出しているか消えるか
- 書体と強調のクセ: 基本テロップの書体・色・縁取り・帯・大きさ、強調テロップ(基本と違う見た目の字幕)の書体・色・帯・大きさ・出方、
  どんな言葉を強調しているか(項目名・数字・答えなど)、1本の中でいくつくらい強調しているか

## 書くこと(日本語・Markdown。見出しはこの順で)
### ジャンル・動画の型ごとの組み立て
### 工程6 人物の位置
### 工程7・9 基本テロップ
### 工程8 左上のタイトル
### 工程8 ランキングの枠・一覧
### 工程10 強調テロップ
### 工程11 効果音と寄り
### 色と書体の数(チェック項目)
この動画全体で使っている色の数・書体の数。チェック項目に「4色以上色が混在していないか」「フォントは3つ以上混在していないか」がある。

## 書き方の決まり
- 書体は、次の候補のうち一番近い物の名前で書く: ${fonts}
- 出方は、次の候補のうち一番近い物の名前で書く: ${animations}
- 色は #RRGGBB で書く。位置・大きさは画面に対する%で書く。
- 型によって違う所は、型ごとに書き分ける。どの型にも共通するクセを先に書く。
- 書き起こしの文言(項目名・題材など)を例に出す時は「(例: 〇〇の動画では『…』)」とし、新しい動画に持ち込ませない。
- 白黒化など、このツールでできない演出は書かない。医療広告として問題になる演出(ビフォーアフター写真・有名人の写真・
  「圧倒的」「〇分で終わる」のような言い切り)は書かない。
- 全体で5000字以内。
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
