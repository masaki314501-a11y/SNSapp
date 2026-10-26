/**
 * 学習データの書き起こし(正解動画を自動編集の答えの形に起こした物)を作り直す。
 * 書き起こしの頼み方(editExampleBreakdown.ts)を変えた時に使う。1本ごとにGemini(Pro)の料金がかかる。
 *   set -a; source .env.local; set +a
 *   npx vite-node --config vitest.config.ts scripts/eval/rebreakdown.ts -- [--only ラベルの一部,...]
 * 同時に書き換えると一覧が壊れるので、1本ずつ順番に作る(作るのは並べて行い、保存だけ順番にする)。
 */
import { breakdownEditExample } from "@/lib/gemini/editExampleBreakdown";
import { listEditExamples } from "@/lib/gemini/editExamplesStore";

const args = process.argv.slice(2);
const onlyIndex = args.indexOf("--only");
const ONLY = onlyIndex >= 0 ? args[onlyIndex + 1].split(",") : null;

const main = async () => {
  const examples = (await listEditExamples()).filter(
    (example) => example.rawMediaFilename && (!ONLY || ONLY.some((o) => example.label.includes(o)))
  );
  // breakdownEditExampleは作った後に一覧を読み直して1件だけ書き換えるので、順番に呼べば壊れない
  for (const example of examples) {
    const started = Date.now();
    try {
      const done = await breakdownEditExample(example);
      const clips = done?.breakdown?.clips ?? [];
      console.log(
        `[rebreakdown] ${example.label}: クリップ${clips.length}個・強調${clips.reduce((s, c) => s + (c.overlays?.length ?? 0), 0)}個` +
          `・字幕${done?.breakdown?.showCaptions ? "あり" : "なし"} (${Math.round((Date.now() - started) / 1000)}秒)`
      );
    } catch (error) {
      console.log(`[rebreakdown] ${example.label}: 失敗 ${error}`);
    }
  }
  console.log("ALLDONE");
};

main();
