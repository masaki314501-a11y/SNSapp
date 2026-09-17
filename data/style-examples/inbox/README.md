# 受け皿(inbox)

手元にある参考動画・参考画像と、それぞれの「正解のスタイル」をまとめて取り込むための
フォルダ。このフォルダに以下を置いて `POST /api/dev/style-examples/import` を実行すると
(または `/dev/style-examples` 画面の「inboxから取り込み」ボタン)、1件ずつ
`data/style-examples/media/` に取り込まれ、取り込んだファイルはこのフォルダから消える。

## 手順

1. 動画・画像ファイルをこのフォルダに直接コピーする
   (対応形式: 動画 `.mp4` `.mov` `.webm` `.m4v` / 画像 `.png` `.jpg` `.jpeg` `.webp`)。
2. `answers.json` に、ファイル名ごとの正解データを追記する(下の形式を参照)。
   `answers.example.json` に記入例あり。
3. `/dev/style-examples` を開き「inboxから取り込み」を押す(または
   `curl -X POST http://localhost:3000/api/dev/style-examples/import`)。

## answers.json の形式

```json
{
  "clip1.mp4": {
    "correctStyle": {
      "primaryColor": "#FF3366",
      "fontFamily": "Noto Sans JP",
      "captionPosition": "bottom",
      "captionStyle": "pill",
      "captionAnimation": "slide-up"
    },
    "label": "競合A社のTikTok投稿(任意のメモ)"
  }
}
```

- キーはこのフォルダに置いたファイル名そのもの(拡張子込み)。
- `correctStyle` の各値は以下の候補からのみ選べる
  (`remotion/shared/schema.ts` の `CAPTION_*_OPTIONS` が正)。
  - `primaryColor`: `#RRGGBB` 形式の16進数カラーコード
  - `fontFamily`: `Noto Sans JP` / `M PLUS Rounded 1c` / `Zen Maru Gothic` /
    `Kosugi Maru` / `Zen Kaku Gothic New` / `Dela Gothic One` / `Yusei Magic` /
    `Potta One` / `Reggae One` / `RocknRoll One` / `Mochiy Pop One` /
    `Noto Serif JP` / `Shippori Mincho` / `Yomogi` / `Kaisei Decol`
  - `captionPosition`: `top` / `middle` / `bottom`
  - `captionStyle`: `pill`(カラー背景) / `outline`(縁取り文字)
  - `captionAnimation`: `slide-up` / `fade` / `pop` / `zoom-in` /
    `highlight-sweep` / `shake-in` / `blur-in` / `slide-side` / `flip-in`
- `label` は任意(登録一覧での表示用メモ)。

取り込み時にファイルが見つからない・値が不正な場合はそのエントリだけスキップされ、
`answers.json` にはそのまま残る(他の正しいエントリは取り込まれる)。
