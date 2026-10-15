# 自動編集の学習・正解動画(few-shot例)

自動編集機能(`src/lib/gemini/autoEditPlan.ts`、`/create/auto-edit`)の精度を上げるための
few-shot例(「良い編集とはこういうもの」の実例)を保存する場所。
`data/style-examples/`(スタイル抽出の正解データ)とは別物で、こちらは色などの構造化値
ではなく動画そのものが正解データになる。

登録した内容は自動編集リクエストのたびに最大3件が「参考になる編集例」
としてGeminiへのリクエストに差し込まれる(`src/lib/gemini/editExamplesStore.ts` の
`loadEditFewShotContext`)。3件より多い場合は、今回の動画に近いものを選ぶ
(`src/lib/gemini/editExampleSelection.ts`、各手本の`profile`=AIが書いた「どんな動画か」の説明で判断)。画像のスタイル抽出(6件)より件数を絞っているのは、動画の
アップロード・解析がコスト/時間ともに重いため。

Render等へのデプロイはコンテナが実行時に書いたファイルを永続化しないため、ここに
置いたファイルは**開発者がgitコミットして初めて本番にも反映される**。

## 中身

- `examples.json` — 登録済み編集例のメタデータ(1件ごとに
  `{ id, label, notes?, correctMediaFilename, correctMimeType, rawMediaFilename?, rawMimeType?, profile?, createdAt }`)。
  手本を変える時は直接編集する。
- `media/correct/` — 正解動画(完成度の高い参考動画)の実体。
  ファイル名は `{ラベルから作ったスラッグ}-{短いランダムID}.{拡張子}`
  (OSのファイルエクスプローラーから見ても中身が分かるように、UUIDそのままにはしていない)。
- `media/raw/` — 学習動画(正解動画のもとになった生素材)の実体。任意項目なので無い場合もある。

## 登録方法

登録用の開発者ページ(`/dev/edit-examples`)と、本番から手元へ取り込むスクリプトは廃止した。手本を変える時は、
`media/correct/`(と`media/raw/`)に動画を置き、`examples.json` に1件ぶんの情報を書き足してgitコミットする。
`profile`(どんな動画か)・`breakdown`(正解動画の書き起こし)が無い手本は、`breakdown`だけ自動編集の時に一度作られる。
