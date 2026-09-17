# 自動編集の学習・正解動画(few-shot例)

自動編集機能(`src/lib/gemini/autoEditPlan.ts`、`/create/auto-edit`)の精度を上げるための
few-shot例(「良い編集とはこういうもの」の実例)を保存する場所。
`data/style-examples/`(スタイル抽出の正解データ)とは別物で、こちらは色などの構造化値
ではなく動画そのものが正解データになる。

登録した内容は自動編集リクエストのたびに新しいものから最大2件が「参考になる編集例」
としてGeminiへのリクエストに差し込まれる(`src/lib/gemini/editExamplesStore.ts` の
`loadEditFewShotContext`)。画像のスタイル抽出(6件)より件数を絞っているのは、動画の
アップロード・解析がコスト/時間ともに重いため。

Render等へのデプロイはコンテナが実行時に書いたファイルを永続化しないため、ここに
置いたファイルは**開発者がgitコミットして初めて本番にも反映される**。

## 中身

- `examples.json` — 登録済み編集例のメタデータ(1件ごとに
  `{ id, label, notes?, correctMediaFilename, correctMimeType, rawMediaFilename?, rawMimeType?, createdAt }`)。
  自動生成されるので手で編集しない。
- `media/correct/` — 正解動画(完成度の高い参考動画)の実体。
  ファイル名は `{ラベルから作ったスラッグ}-{短いランダムID}.{拡張子}`
  (OSのファイルエクスプローラーから見ても中身が分かるように、UUIDそのままにはしていない)。
- `media/raw/` — 学習動画(正解動画のもとになった生素材)の実体。任意項目なので無い場合もある。

## 登録方法

`npm run dev` を起動し、`/dev/edit-examples` を開く(エンドユーザー向けの導線は無いので
直接アクセスする)。ラベル・正解動画(必須)・学習動画(任意)・メモ(任意)を入力して登録する。
一括取り込み(inbox)は今のところ無い(1件ずつの登録で足りるため)。

登録・削除は `/dev/edit-examples` のUI、または以下のAPIから行う。

- `GET /api/dev/edit-examples` — 一覧
- `POST /api/dev/edit-examples` — 1件登録(multipart: `label` + 任意の `notes` +
  `correct` ファイル(必須) + 任意の `raw` ファイル)
- `DELETE /api/dev/edit-examples/[id]` — 1件削除
- `GET /api/dev/edit-examples/[id]/media?which=correct|raw` — 動画本体の取得(UIのプレビュー用)
