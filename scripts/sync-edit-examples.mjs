#!/usr/bin/env node
/**
 * 本番(Render)の /dev/edit-examples で登録した学習・正解動画を取得し、ローカルの
 * data/edit-examples/ に取り込む。Render無料プランはデプロイのたびにディスクが
 * 消えるため、本番で登録した内容はこれでローカルに落としてgitコミットしないと残らない
 * (詳細は README.md の `/dev/edit-examples` の節、editExamplesStore.ts のコメント参照)。
 *
 * 使い方: node scripts/sync-edit-examples.mjs https://<本番のURL>
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error("使い方: node scripts/sync-edit-examples.mjs https://<本番のURL>");
  process.exit(1);
}

const DATA_DIR = path.join(process.cwd(), "data", "edit-examples");
const CORRECT_MEDIA_DIR = path.join(DATA_DIR, "media", "correct");
const RAW_MEDIA_DIR = path.join(DATA_DIR, "media", "raw");
const METADATA_PATH = path.join(DATA_DIR, "examples.json");

const readLocalMetadata = async () => {
  try {
    return JSON.parse(await readFile(METADATA_PATH, "utf-8"));
  } catch {
    return [];
  }
};

const downloadMedia = async (id, which, filename, dir) => {
  await mkdir(dir, { recursive: true });
  const res = await fetch(`${baseUrl}/api/dev/edit-examples/${id}/media?which=${which}`);
  if (!res.ok || !res.body) {
    throw new Error(`${which}動画のダウンロードに失敗しました(id=${id}, status=${res.status})`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(path.join(dir, filename)));
};

const main = async () => {
  const res = await fetch(`${baseUrl}/api/dev/edit-examples/export`);
  if (!res.ok) {
    throw new Error(`examples.jsonの取得に失敗しました(status=${res.status})`);
  }
  const remoteExamples = await res.json();

  const localExamples = await readLocalMetadata();
  const localIds = new Set(localExamples.map((example) => example.id));

  const newExamples = remoteExamples.filter((example) => !localIds.has(example.id));
  if (newExamples.length === 0) {
    console.log("新しく取り込む編集例はありません(すべて取り込み済み)");
    return;
  }

  for (const example of newExamples) {
    console.log(`取り込み中: ${example.label} (${example.id})`);
    await downloadMedia(example.id, "correct", example.correctMediaFilename, CORRECT_MEDIA_DIR);
    if (example.rawMediaFilename) {
      await downloadMedia(example.id, "raw", example.rawMediaFilename, RAW_MEDIA_DIR);
    }
  }

  const merged = [...localExamples, ...newExamples];
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(METADATA_PATH, `${JSON.stringify(merged, null, 2)}\n`, "utf-8");

  console.log(`${newExamples.length}件取り込みました。data/edit-examples/ の変更をgit commitしてください。`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
