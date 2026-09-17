# スタイル抽出の正解データ(few-shot例)

`src/lib/gemini/extractStyle.ts` (参考画像/参考動画からテロップの配色・フォント・配置・
背景の付き方・出現演出を抽出するAPI)の精度を上げるためのfew-shot例を保存する場所。

登録した内容は抽出リクエストのたびに新しいものから最大6件が「この画像/動画ならこう
抽出するのが正解」という例としてGeminiへのリクエストに差し込まれる
(`src/lib/gemini/styleExamplesStore.ts` の `loadStyleFewShotContext`)。

Render等へのデプロイはコンテナが実行時に書いたファイルを永続化しないため、ここに
置いたファイルは**開発者がgitコミットして初めて本番にも反映される**。

## 中身

- `examples.json` — 登録済み正解データのメタデータ(1件ごとに
  `{ id, kind, mediaFilename, mimeType, correctStyle, label?, createdAt }`)。
  自動生成されるので手で編集しない。
- `media/` — 登録済みの参考画像/参考動画の実体(`{id}.{拡張子}`)。
- `inbox/` — 手元に用意した動画・画像をまとめて取り込むための受け皿。
  詳しくは `inbox/README.md` を参照。

## 登録方法

1. `npm run dev` を起動し、`/dev/style-examples` を開く(エンドユーザー向けの導線は
   無いので直接アクセスする)。1件ずつ画像/動画をアップロードしてフォームで正解の
   スタイル値を入力する。
2. まとめて手元にある場合は `inbox/` にファイルを置いて
   `POST /api/dev/style-examples/import` を叩く(`/dev/style-examples` 画面の
   「inboxから取り込み」ボタンから実行できる)。

登録・削除は `/dev/style-examples` のUI、または以下のAPIから行う。

- `GET /api/dev/style-examples` — 一覧
- `POST /api/dev/style-examples` — 1件登録(multipart: `image` ファイル +
  `correctStyle`(JSON文字列) + 任意の `label`)
- `DELETE /api/dev/style-examples/[id]` — 1件削除
- `GET /api/dev/style-examples/[id]/media` — 画像/動画本体の取得(UIのサムネイル表示用)
- `GET /api/dev/style-examples/import` — inbox内の未取り込みファイル数の確認
- `POST /api/dev/style-examples/import` — inboxから一括取り込み
