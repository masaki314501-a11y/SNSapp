# SNSapp

縦型ショート動画(9:16)の音声字幕を自動生成する編集ツール。1本の動画をアップロードすると、
不要な部分をカットし、Geminiが音声を発話の区切りごとに文字起こししてテロップとして重ねる。
トリミング・並べ替え・スタイル調整・SE/BGM/AIナレーション追加をした上で、Remotionで
動画として書き出せる。

## 使い方

`npm run dev` 後、`http://localhost:3000/create` を開く。編集の流れは
**アップロード → カット → 参考画像・字幕生成 → クリップ編集 → 書き出し** の5画面。

### 1. `/create` — アップロード

動画ファイルをアップロードする(`/api/upload` → `public/videos/` に保存、実際の長さを
ブラウザ側で自動検出)。完了すると動画全体を1つの「使う範囲」として保存し、`/create/cut` へ。
長さの自動検出はSafari(iOS/iPadOS)で一部の動画形式だと失敗することがあり、その場合は
エラー表示と「長さの取得を再試行」ボタンを出す。

### 2. `/create/cut` — ラフカット

不要な部分(前置き・言い淀み・撮り直し等)を先に切り捨てる画面。分割(`S`キー)・イン/アウト点
(`I`/`O`キー)・トリム・削除・並べ替えで「使う範囲」を絞り込む。ここで捨てた範囲は、
この後の参考画像でのスタイル抽出・音声からの字幕生成の対象にならない。

### 3. `/create/style` — 参考画像・動画・字幕生成

1. (任意)参考にする**画像または動画**(競合の投稿・スクリーンショット等)をアップロードすると、
   Geminiが配色・フォント・テロップ位置・テロップの背景の付き方・出現演出をまとめて抽出する
   (`/api/extract-style` または `/api/extract-style-from-video`、非同期ジョブ+ポーリング)。
   動画を渡した場合はテロップが実際にどう動いて出てくるかも見て演出を判定する。手動で
   後から変更してもよい。
2. 「音声から字幕を生成」を実行する。`/api/transcribe-captions` がジョブを開始し、
   `/api/transcribe-captions/[jobId]` をポーリングして進捗
   (アップロード中→処理中→生成中→完了)を取得する。文字起こしは動画全体に対して行うが、
   結果はカットで選んだ範囲だけに切り詰められる(`clipTranscribedToKeepRanges`)。
3. 完了する(または「字幕生成をスキップして編集へ進む」を押す)と、編集内容が
   `videoProject.ts` 経由で localStorage に保存され `/edit` に遷移する。

### 4. `/edit` — クリップ編集

Remotion Playerでのプレビューを見ながら、以下を編集できる。

- **クリップ**: トリミング(開始秒・長さ、ドラッグ or イン/アウト点`I`/`O`)、分割(`S`)、
  追加・削除・複製・結合、ドラッグ&ドロップや↑↓での並べ替え、複数選択(Shift/Ctrl)、
  字幕の個別編集・一括編集、クリップごとの音量(元の音声だけをミュートするチェックボックス
  付き)、テロップ出現アニメーション(9種)、Undo/Redo
- **スタイル**: プリセット(6種)一括適用、配色、テロップの見た目(カラー背景/縁取り文字)、
  フォント(15書体)、テロップ位置、文字サイズ、全体フェードイン/アウト
- **音声(SE・BGM・AIナレーション)**: 効果音の追加(プリセット10種 or アップロード、最大30個、
  `/api/upload-audio`)、BGM設定(音量・フェードイン/アウト、ループ再生)、テロップをAI音声で
  読み上げてナレーションとして追加(`/api/generate-voiceover`、クリップ単位 or 全クリップ一括)

編集内容は操作のたびに自動保存され、リロード/再訪問時に復元される。プロジェクトの
JSONエクスポート/インポートにも対応する。

### 5. `/edit/export` — 書き出し

「動画を書き出す」を実行すると `/api/render` がジョブを開始し、`/api/render/[jobId]` を
ポーリングして進捗・残り時間の目安・完成した動画のURLを取得する(Remotionのヘッドレス
レンダリング)。

## ディレクトリ構成

### Next.js側 (`src/`)

- `src/app/create/` — アップロードのUI(`UploadGenerator.tsx`)
  - `uploadVideoFile.ts` — 動画アップロードの進捗付きfetch
  - `useTranscribeJob.ts` — 文字起こしジョブの開始とポーリング
  - `useExtractStyleJob.ts` — スタイル抽出ジョブ(画像/動画どちらも)の開始とポーリング
  - `cut/` — ラフカットのUI(`CutEditor.tsx` を配置)
  - `style/` — 参考画像・動画/字幕生成のUI(`StyleAndTranscribe.tsx` を配置)
- `src/app/edit/` — クリップ編集のUI(`ClipEditor.tsx` を配置)
- `src/app/edit/export/` — 書き出しのUI(`ExportScreen.tsx` を配置)
- `src/components/editor/` — 編集画面のコンポーネント・ロジック
  - `ClipEditor.tsx` — プレビュー・クリップ編集・スタイル・音声タブをまとめる本体(`/edit`)
  - `ExportScreen.tsx` — 書き出し専用画面の本体(`/edit/export`)
  - `CutEditor.tsx` — ラフカット専用の簡易版(`/create/cut`、キャプション/SE/BGM無し)
  - `RenderPanel.tsx` — 書き出しボタンと進捗表示(不確定プログレス・残り時間の目安)
  - `useRenderJob.ts` — 書き出しジョブの開始とポーリング
  - `uploadAudioFile.ts` — SE/BGMアップロードの progress 付きfetch
  - `requestVoiceover.ts` — AIナレーション生成APIの薄いfetchラッパー
  - `stylePresets.ts` / `audioPresets.ts` — スタイル/SE・BGMのプリセット一覧
  - `timelineUtils.ts` — クリップのトリム範囲クランプ・分割・結合可否・文字起こし結果の
    範囲絞り込みなど、タイムライン共通ロジック
  - `timeline/` — タイムラインUI本体(`TimelineRoot.tsx` / `VideoTrack.tsx` / `AudioTracks.tsx` /
    `ClipInspectorPanel.tsx` 等)。`ClipEditor`/`CutEditor` の両方から共有
- `src/lib/videoProject.ts` — `/create`〜`/edit` をまたいで編集状態を受け渡す共有ストア
  (localStorageへの保存・復元、JSONエクスポート/インポート)
- `src/lib/uploadedVideo.ts` — アップロード済み動画パスの検証・絶対パス/MIMEタイプ解決
  (`transcribe-captions`・`extract-style-from-video`で共用)
- `src/app/api/` — Route Handler群
  - `upload/` — 動画を `public/videos/{uuid}.{ext}` に保存(上限200MB)
  - `upload-audio/` — SE/BGM音声を `public/audio/{uuid}.{ext}` に保存(上限20MB)
  - `extract-style/` — 参考画像から配色・フォント・位置・背景・演出を抽出(Gemini、非同期ジョブ+ポーリング)
  - `extract-style-from-video/` — 参考動画版(Gemini File API経由、同じジョブストアを共有)
  - `transcribe-captions/` — 動画の音声を文字起こし(Gemini、非同期ジョブ+ポーリング)
  - `generate-voiceover/` — テロップをAIナレーション音声(WAV)に変換(Gemini TTS、同期レスポンス)
  - `render/` — Remotionでの動画書き出し(非同期ジョブ+ポーリング)
  - `media/[...path]/` — `public/videos` `public/audio` `public/renders` を都度ファイル
    システムから配信するRoute Handler。通常のpublic配信はビルド時点のスナップショット
    しか返さず、起動後にアップロード/生成されたファイルは本番ビルドで404になるため必要。
    HTTP Rangeリクエストにも対応(iOS/iPadOSの「ビデオを保存」やシーク操作に必要)
- `src/lib/gemini/` — Gemini API呼び出しのラッパー
  - `transcribeCaptions.ts` / `transcribeJobs.ts` — 動画をFile APIにアップロードし、発話区切り
    ごとの `{startFromSeconds, durationInSeconds, caption}` 配列を取得する。ジョブはインメモリ管理
    (単一プロセス前提)
  - `extractStyle.ts` / `extractStyleJobs.ts` — 参考画像/動画から配色・フォント・位置・背景・
    演出を抽出する(画像はinlineData、動画はFile API経由)
  - `generateVoiceover.ts` — Gemini TTSでテロップを読み上げ音声(WAV)に変換する
  - `voiceOptions.ts` — AIナレーションの声のプリセット一覧(クライアント/サーバー共用)
  - `geminiFiles.ts` — Gemini File APIアップロード後のACTIVE待ちポーリング(共通処理)
  - `geminiErrors.ts` — 429/503などリトライ可能なエラーの判定と日本語エラーメッセージ変換
  - `rateLimiter.ts` / `textUtils.ts` — レート制御・テキスト整形の共通処理
- `src/lib/remotion/` — レンダーAPI用のRemotionラッパー(`bundle.ts` / `browser.ts` / `renderJobs.ts`)

### Remotion側 (`remotion/`)

- `remotion/templates/standard/` — 唯一のテンプレート「音声字幕」(テンプレート選択UIは無い)
  - `schema.ts` — 入力プロパティのzodスキーマ(クリップ配列は1〜40個、SEは最大30個、
    `hook`/`cta`は任意)
  - `StandardVideo.tsx` — クリップを`<Series>`でつなぐルートコンポーネント
    (`hook`/`cta`が無ければ該当セクションを描画しない)
  - `duration.ts` — クリップ尺の合計から動画全体の尺(フレーム数)を算出する共通ロジック
  - `defaultProps.ts` — Remotion Studioで確認する際のサンプルデータ
- `remotion/shared/` — テンプレート間で共有するコンポーネント・スキーマ
  - `AnimatedCaption.tsx` — テロップのアニメーション表示(発話が無い区間は非表示)
  - `captionAnimations.ts` — テロップ出現アニメーション(9種)のtransform/opacity/filter算出
  - `MediaBackground.tsx` — クリップの動画/画像背景描画
  - `schema.ts` / `constants.ts` — 共通スキーマ(フォント15書体・テロップ見た目・位置・
    サイズ・SE/BGM等)、定数
  - `font.ts` — 選択フォントのみをオンデマンドで読み込む(`public/fonts/` に同梱した
    日本語ローカルフォントを`@remotion/fonts`で読み込み、Google Fonts CDNへの依存を避ける)
- `remotion/templates/registry.ts` — テンプレートIDからschema等を引くレジストリ
  (サーバーから安全に読み込める。描画コンポーネントは含まない)
- `remotion/templates/clientRegistry.tsx` — 描画コンポーネントを含むクライアント向けレジストリ

Studioで確認: `npm run remotion:studio`
CLIでのレンダリング: `npm run remotion:render`(`out/short-video.mp4`に出力)

## `/insights` — お店のクチコミを見る(動画編集とは別機能)

現在トップページからの導線は外してあり(一旦使わない運用のため)、直接 `/insights` に
アクセスすれば使える。機能自体はそのまま残っている。

Google Places API(APIキーのみ・OAuth不要)で、店名・住所から場所を検索し、評価と直近の
口コミ(API仕様上、最大5件まで)を表示する。自社・競合を問わず公開情報として取得できる、
SNS投稿ネタ探し用の簡易ツール。

- `src/lib/googleMaps/places.ts` — Text Search / Place Detailsの薄いラッパー(zodで応答検証)
- `src/app/api/insights/search-place/` — 店名・住所での検索
- `src/app/api/insights/place-details/[placeId]/` — 評価・口コミの取得
- `src/app/insights/InsightsExplorer.tsx` — 検索〜口コミ表示のUI(ジョブ化不要な軽量な同期API)

**設計メモ**: Instagram/TikTokのインサイト取得・投稿機能は、公式APIがOAuth連携(自分の
アカウントのみ)を前提とするため、ユーザー認証・トークン保存用のDBが別途必要になる
(現状はlocalStorageのみの単一ユーザー前提)。競合アカウントの分析は両プラットフォームとも
公式APIでは提供されておらず非対応。投稿APIも実運用にはアプリの本審査と動画の公開URLホス
ティングが要る。詳細な段階分けは開発時のやり取りを参照。

## 環境変数

- `GEMINI_API_KEY` — 必須。Gemini APIキー(`.env.local`)
- `GEMINI_MODEL` — 任意。既定値は `gemini-2.5-flash`
- `GEMINI_TTS_MODEL` — 任意。AIナレーション生成に使うモデル。既定値は `gemini-2.5-flash-preview-tts`
- `GEMINI_MIN_INTERVAL_MS` — 任意。Gemini APIリクエスト間の最小間隔(レート制御用)
- `GOOGLE_MAPS_API_KEY` — 任意。`/insights`で使うGoogle Maps Platform(Places API)のAPIキー

## デプロイ(Render.com)

`Dockerfile` と `render.yaml` を用意済みで、Render.comの Blueprint機能でデプロイできる。

1. Renderダッシュボードで **New +** → **Blueprint** から、このGitHubリポジトリを接続
2. `render.yaml` が自動検出され、Freeプランの Web Service(Dockerビルド)が構成される
3. 環境変数(`GEMINI_API_KEY`など、上記の「環境変数」参照)を入力してデプロイ

`next.config.ts` を見ると分かる通り `output: "standalone"` は使わず、`node_modules`
全体を含めるシンプルな構成にしている(`@remotion/bundler`/`@remotion/renderer`が
プラットフォーム別ネイティブバイナリを動的requireで解決しており、standaloneのファイル
トレースだと正しく検出できずランタイムでENOENTになる恐れがあるため)。ビルド時に
`npx remotion browser ensure` でヘッドレスChromeをイメージに焼き込み、実行時の初回
レンダーでのダウンロードを防いでいる。

Freeプランはメモリが少なく(512MB)、ヘッドレスChromeでの動画レンダリングが重い
(クリップ数・動画尺次第でメモリ不足になりうる)ため、書き出しが不安定な場合は
有料プランへの変更を検討する。また無操作が続くとスリープし、次のアクセス時に
再起動で数十秒かかる。

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).
