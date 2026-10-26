/**
 * 自動編集の質を測る。学習データ(data/edit-examples)の学習動画を1本ずつ自動編集させ、
 * 正解動画の書き起こしと比べて点数を出す(score.ts)。その手本自身は見せない(答えを見て解かせないため)。
 *
 * 使い方(.env.local の GEMINI_API_KEY が要る。1本ごとにGeminiの料金がかかる):
 *   set -a; source .env.local; set +a
 *   AUTO_EDIT_CANDIDATES=1 npx vite-node --config vitest.config.ts scripts/eval/run.ts -- --tag 試行名 [--only ラベルの一部,...] [--concurrency 3]
 * 結果は eval-results/<試行名>/ に、1本ごとの答え(raw.json)と点数(summary.json)を書く。
 */
import { execFile } from "node:child_process";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { generateAutoEditPlan } from "@/lib/gemini/autoEditPlan";
import { analyzeSpeechActivity, snapToQuiet } from "@/lib/audio/speechActivity";
import { editExampleMediaPath, listEditExamples, type EditExample } from "@/lib/gemini/editExamplesStore";
import { scorePlan, type ScoreBreakdown } from "./score";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const TAG = arg("tag") ?? new Date().toISOString().replace(/[:.]/g, "-");
const ONLY = arg("only")?.split(",").map((s) => s.trim()).filter(Boolean);
const CONCURRENCY = Number(arg("concurrency") ?? 3);
const OUT_DIR = path.join(process.cwd(), "eval-results", TAG);

const FFPROBE_DIR = path.join(process.cwd(), "node_modules", "@remotion", `compositor-${process.platform}-${process.arch}`);

const durationOf = async (file: string): Promise<number> => {
  const { stdout } = await promisify(execFile)(
    "./ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { cwd: FFPROBE_DIR }
  );
  return Number(stdout.trim());
};

const runOne = async (example: EditExample): Promise<{ label: string; score: ScoreBreakdown | null; error?: string; seconds: number }> => {
  const started = Date.now();
  // Geminiへ送る部品は日本語のファイル名を扱えないので、英数字だけの名前の一時コピーを使う
  const videoPath = path.join(tmpdir(), `snsapp-eval-${example.id}.mp4`);
  try {
    await copyFile(editExampleMediaPath(example, "raw")!, videoPath);
    const duration = await durationOf(videoPath);
    const speech = await analyzeSpeechActivity(videoPath).catch(() => null);
    const plan = await generateAutoEditPlan({
      video: { absolutePath: videoPath, mimeType: "video/mp4", durationInSeconds: duration },
      keepRanges: [{ startFromSeconds: 0, durationInSeconds: duration }],
      styleReferences: [],
      template: null,
      materialImages: [],
      // 画像は棚の物だけ(新しく作ると料金・時間がかかるため)
      generateMissingImages: true,
      maxGeneratedImages: 0,
      title: "",
      snapCut: speech ? (seconds) => snapToQuiet(speech, seconds) : undefined,
      excludeExampleIds: [example.id],
    });
    const score = scorePlan(plan.rawPlan, example.breakdown!);
    const dir = path.join(OUT_DIR, example.label.replace(/[\\/:*?"<>|？]/g, ""));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "raw.json"), JSON.stringify(plan.rawPlan, null, 2));
    await writeFile(path.join(dir, "score.json"), JSON.stringify(score, null, 2));
    return { label: example.label, score, seconds: Math.round((Date.now() - started) / 1000) };
  } catch (error) {
    return { label: example.label, score: null, error: String(error), seconds: Math.round((Date.now() - started) / 1000) };
  } finally {
    await rm(videoPath, { force: true });
  }
};

const main = async () => {
  const examples = (await listEditExamples()).filter(
    (example) => example.breakdown && example.rawMediaFilename && (!ONLY || ONLY.some((o) => example.label.includes(o)))
  );
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`[eval] ${TAG}: ${examples.length}本を測ります`);
  const results: Awaited<ReturnType<typeof runOne>>[] = [];
  const queue = [...examples];
  await Promise.all(
    Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
      for (let example = queue.shift(); example; example = queue.shift()) {
        const result = await runOne(example);
        results.push(result);
        console.log(`[eval] ${result.label}: ${result.score ? result.score.total : `失敗 ${result.error}`} (${result.seconds}秒)`);
      }
    })
  );
  const scored = results.filter((r) => r.score);
  const average = scored.length ? Math.round((scored.reduce((s, r) => s + r.score!.total, 0) / scored.length) * 10) / 10 : 0;
  // 項目ごとの平均(どこが弱いかを見るため)
  const keys = Object.keys(scored[0]?.score ?? {}).filter((k) => k !== "total");
  const perKey = Object.fromEntries(
    keys.map((key) => {
      const values = scored.map((r) => r.score![key]).filter((v): v is number => typeof v === "number");
      return [key, values.length ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100 : null];
    })
  );
  const summary = { tag: TAG, average, perKey, results };
  await writeFile(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`[eval] 平均 ${average}点`, JSON.stringify(perKey));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
