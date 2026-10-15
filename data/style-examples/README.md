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
  手本を変える時は直接編集する。
- `media/` — 登録済みの参考画像/参考動画の実体(`{id}.{拡張子}`)。

## 登録方法

登録用の開発者ページ(`/dev/style-examples`)と一括取り込み(inbox)は廃止した。手本を変える時は、
`media/` にファイルを置き、`examples.json` に1件ぶんの情報を書き足してgitコミットする。
