# API リファレンス

`src/app/api/` 配下の Route Handler 一覧。共通パターンは [architecture.md](./architecture.md)
の「非同期ジョブ + ポーリングのパターン」を参照。

## 動画編集系

| Method & Path | 実装 | 用途 | リクエスト | レスポンス | 方式 |
|---|---|---|---|---|---|
| `POST /api/upload` | [upload/route.ts](../src/app/api/upload/route.ts) | 動画アップロード | 生バイト列(`x-file-name`ヘッダにファイル名)。拡張子: mp4/mov/webm/m4v、上限200MB | `{ path: "videos/{uuid}.{ext}" }` | 同期 |
| `POST /api/upload-audio` | [upload-audio/route.ts](../src/app/api/upload-audio/route.ts) | SE/BGM音声アップロード | `multipart/form-data`(`file`)。拡張子: mp3/wav/m4a/ogg/aac、上限20MB | `{ path: "audio/{uuid}.{ext}" }` | 同期 |
| `POST /api/extract-style` | [extract-style/route.ts](../src/app/api/extract-style/route.ts) | 参考**画像**から配色/フォント/位置/背景/演出を抽出 | `multipart/form-data`(`image`)。PNG/JPEG/WebP、上限10MB | `{ jobId }` | ジョブ |
| `GET /api/extract-style/[jobId]` | [extract-style/[jobId]/route.ts](../src/app/api/extract-style/%5BjobId%5D/route.ts) | 上記の進捗取得 | — | 進捗 or `{status:"done", ...style}` / `{status:"error", message}` | ポーリング |
| `POST /api/extract-style-from-video` | [extract-style-from-video/route.ts](../src/app/api/extract-style-from-video/route.ts) | 参考**動画**版(Gemini File API経由)。ジョブストアは `/api/extract-style` と共有 | `multipart/form-data`(動画ファイル) | `{ jobId }` | ジョブ |
| `POST /api/transcribe-captions` | [transcribe-captions/route.ts](../src/app/api/transcribe-captions/route.ts) | 動画音声の文字起こし→字幕候補生成 | `{ videoPath, videoDurationInSeconds }` | `{ jobId }` | ジョブ |
| `GET /api/transcribe-captions/[jobId]` | [transcribe-captions/[jobId]/route.ts](../src/app/api/transcribe-captions/%5BjobId%5D/route.ts) | 上記の進捗取得 | — | `{status:"uploading"\|"processing"\|"generating"}` → `{status:"done", segments}` / `{status:"error", message}` | ポーリング |
| `POST /api/generate-voiceover` | [generate-voiceover/route.ts](../src/app/api/generate-voiceover/route.ts) | テロップ1件をAIナレーション音声(WAV)に変換 | `{ text: string(1-200文字), voiceName?: string }` | `{ path: "audio/generated/{uuid}.wav" }` | **同期**(唯一ジョブ化していないAPI) |
| `POST /api/render` | [render/route.ts](../src/app/api/render/route.ts) | Remotionでの動画書き出し開始 | `{ templateId: string, props: StandardVideoProps }`(zodで検証) | `{ jobId }` | ジョブ |
| `GET /api/render/[jobId]` | [render/[jobId]/route.ts](../src/app/api/render/%5BjobId%5D/route.ts) | 上記の進捗取得 | — | `{status:"starting"\|"rendering", progress}` → `{status:"done", url}` / `{status:"error", message}` | ポーリング |
| `GET /api/media/[...path]` | [media/[...path]/route.ts](../src/app/api/media/%5B...path%5D/route.ts) | `public/videos` `public/audio` `public/renders` をランタイムでファイルシステムから配信 | パス(例: `videos/xxx.mp4`) | メディアバイナリ(HTTP Range対応) | 同期 |

## インサイト系(`/insights`、動画編集とは別機能)

| Method & Path | 実装 | 用途 | リクエスト | レスポンス | 方式 |
|---|---|---|---|---|---|
| `POST /api/insights/search-place` | [search-place/route.ts](../src/app/api/insights/search-place/route.ts) | 店名・住所での場所検索(Google Places Text Search) | `{ query: string(1-200文字) }` | `{ results: [...] }` | 同期 |
| `GET /api/insights/place-details/[placeId]` | [place-details/[placeId]/route.ts](../src/app/api/insights/place-details/%5BplaceId%5D/route.ts) | 評価・直近クチコミ(最大5件)取得 | パスパラメータ `placeId` | 場所の詳細情報 | 同期 |

## 入力検証の共通方針

- 上記のうちボディがJSONのAPIは `zod` の `safeParse` で検証し、失敗時は `400` +
  `{ error, issues }` を返す(`upload` / `upload-audio` はファイル系のため個別の手動検証)。
- `/api/render` はテンプレートのスキーマ(`templateRegistry[templateId].schema`、実体は
  [remotion/templates/standard/schema.ts](../remotion/templates/standard/schema.ts))で
  `props` を検証する。**Remotion側のスキーマを変更したら、対応するUI(`/edit`)と
  `videoProject.ts` の `buildStandardVideoProps()` も同時に見直す**(architecture.md参照)。

## 新しいAPIを追加する時の目安

- 処理が数秒以内で終わる → `generate-voiceover` に倣い同期レスポンス。
- Gemini呼び出しやレンダリングなど数十秒以上かかりうる → 既存の3ジョブAPIに倣い
  `createXxxJob()` / `after()` / ポーリング用 `GET /[jobId]` の構成にする。
- アップロード系ファイルを新しい種類の処理で参照する → `/api/media` 経由での絶対URL解決
  (architecture.md「ファイル配信の注意点」)を忘れない。
