# システム説明アーティファクト 調査計画

- 対象: SNSapp(`C:\workspace\systems\SNSapp`、ブランチ `feature/system-overview-artifact` = origin/main と同一)
- 割り振りパターン: **パターン4(調査)**。実装は行わない。調査結果を基に、メインエージェントがHTMLページを作って公開する
- 作成日: 2026-09-25

## 1. 要件(明文化)

| #   | 要件                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------ |
| R1  | 最終成果物はシステムを説明するHTMLページ1枚。公開はメインエージェントが行う                            |
| R2  | 読者は非エンジニアと新規参加の開発者の両方                                                             |
| R3  | 各節は「平易な概要 → 開発者向け詳細」の二段構成にする                                                  |
| R4  | 開発者向け詳細には、ファイルパス・APIルート・環境変数名を書く。**環境変数・APIキーの値は書かない**     |
| R5  | 観点1〜6(ページ一覧 / ページ機能 / 画面パーツ / データの流れ / 外部連携 / 生成AI呼び出し)はすべて必須 |
| R6  | `/dev/*` は「開発者向けツール」として利用者向けページとは別枠で扱う                                    |
| R7  | 調査はmicroservices-architect(今回は読み取り専用の調査として依頼)に4タスクで並列に投げる           |
| R8  | 事実はコードで確かめる。推測で補った箇所には「未確認」と書く                                           |

## 2. 事前把握した構造(下見の結果)

- フレームワーク: Next.js 16.3.1(App Router)、React 19.2、Tailwind CSS 4、zod 4
- 主な依存: `@google/genai`(Gemini)、`remotion` 系一式(`@remotion/renderer`・`bundler`・`player`・`web-renderer`・`media`・`fonts`・`google-fonts`・`zod-types`)
- ページ(`src/app`): `/`、`/create`、`/create/style`、`/create/cut`、`/create/auto-edit`、`/edit`、`/edit/export`、`/insights`、`/dev/style-examples`、`/dev/edit-examples`
- APIルート(`src/app/api`): `upload`、`upload-audio`、`media/[...path]`、`render`(+`[jobId]`)、`auto-edit`(+`[jobId]`)、`extract-style`(+`[jobId]`)、`extract-style-from-video`、`transcribe-captions`(+`[jobId]`)、`generate-voiceover`、`insights/search-place`、`insights/place-details/[placeId]`、`dev/style-examples/*`、`dev/edit-examples/*`
- エディタ部品: `src/components/editor/**`(`ClipEditor`・`CutEditor`・`ExportScreen`・`RenderPanel`・`timeline/*` の各InspectorPanel など)
- ライブラリ: `src/lib/gemini/**`、`src/lib/googleMaps/places.ts`、`src/lib/remotion/**`、`src/lib/videoProject.ts`、`src/lib/uploadedVideo.ts`、`src/lib/styleReference.ts`
- 動画テンプレート: `remotion/**`(`Root.tsx`、`templates/standard/*`、`shared/*`)、`remotion.config.ts`
- データ・資産: `data/style-examples/**`、`data/edit-examples/**`、`public/fonts/**`、`public/audio/presets/**`(`CREDITS.md` あり)、`public/videos/`
- デプロイ・運用: `render.yaml`、`Dockerfile`、`.dockerignore`、`.env.local.example`、`scripts/sync-edit-examples.mjs`、`next.config.ts`
- コード中の環境変数名: `GEMINI_API_KEY`、`GEMINI_MODEL`、`GEMINI_STYLE_MODEL`、`GEMINI_AUTO_EDIT_MODEL`、`GEMINI_TTS_MODEL`、`GEMINI_MIN_INTERVAL_MS`、`GEMINI_TTS_MIN_INTERVAL_MS`、`GOOGLE_MAPS_API_KEY`、`NEXT_PUBLIC_REMOTION_LICENSE_KEY`、`PORT`、`NODE_ENV`
- ブラウザ保存(`localStorage` など)やAPIキーの受け渡しに関する記述があるファイル: `src/lib/videoProject.ts`、`src/app/create/UploadGenerator.tsx`、`src/app/create/style/StyleAndTranscribe.tsx`、`src/app/create/auto-edit/AutoEditScreen.tsx`、`src/components/editor/{ClipEditor,CutEditor,ExportScreen}.tsx`、`src/lib/gemini/{autoEditPlan,extractStyle,generateVoiceover,transcribeCaptions}.ts`

## 3. 調査タスク(Exploreで並列実行、4タスク)

どのタスクにも共通する指示:

- 着手前に `AGENTS.md` を読む。コードは読むだけで、編集はしない
- `.env*` を読むのは `.env.local.example` だけにする。キーなどの**値は書き写さない**(変数名だけを書く)
- 各項目は「平易な説明(1〜2文)」と「開発者向け詳細(ファイルパス・関数名・APIルート・環境変数名)」の二段で返す
- 確かめられなかった点は「未確認」と書く
- 担当範囲の境界にあるファイルは、担当外の観点の説明を省き、該当タスク番号を書いて参照だけにする

### タスクA: 利用者向けページとページ遷移(観点1・2・3のうち、エディタ以外の部分)

- 見る場所
  - `src/app/layout.tsx`、`src/app/page.tsx`、`src/app/globals.css`(全体レイアウトとナビだけ)
  - `src/app/create/**`(`page.tsx`、`UploadGenerator.tsx`、`uploadVideoFile.ts`、`style/*`、`auto-edit/*`、`cut/page.tsx`、`use*Job.ts`)
  - `src/app/insights/**`(`page.tsx`、`InsightsExplorer.tsx`)
  - `src/components/icons.tsx`
- 成果物に含める項目
  1. 利用者向けページの一覧表(パス / ページ名 / 役割 / 実体ファイル)
  2. 利用者の動線図のもとになる情報(トップ → 作成 → スタイル・文字起こし → 自動編集 → カット → 編集 → 書き出し など、実際の遷移条件とクエリ・状態の受け渡し)
  3. 各ページの機能(できること・前提条件・待ち時間やジョブ進行の表示)
  4. 各ページの画面パーツの一覧(ボタン・タブ・フォーム・ダイアログ・進行表示などすべて。部品名 / 何ができるか / 押すと呼ばれるAPIや関数)
  5. APIキー入力欄など、利用者に設定を求めるUIがあればその場所と文言(値の扱いの詳細はタスクDに任せる)

### タスクB: 編集画面・書き出し画面の部品(観点2・3のうち、エディタ部分)

- 見る場所
  - `src/app/edit/page.tsx`、`src/app/edit/export/page.tsx`
  - `src/components/editor/**`(`ClipEditor.tsx`、`CutEditor.tsx`、`ExportScreen.tsx`、`RenderPanel.tsx`、`requestVoiceover.ts`、`uploadAudioFile.ts`、`audioPresets.ts`、`stylePresets.ts`、`timelineUtils.ts`、`useRenderJob.ts`、`useWebRender.ts`、`editor-theme.css`)
  - `src/components/editor/timeline/**`(`TimelineRoot`、`VideoTrack`、`AudioTracks`、各 `*InspectorPanel`、`TextOverlayFields`、`useAudioWaveform`、`useClipThumbnails`、`pointerDrag`、`timelineScale`)
  - `/create/cut` から使われる `CutEditor` もここで担当する
- 成果物に含める項目
  1. 編集画面の構成図のもとになる情報(プレビュー・タイムライン・インスペクタ・タブの配置)
  2. タブ・パネルごとの機能一覧(クリップ / 字幕 / テキスト / ナレーション / BGM / 効果音 / 演出 など。実際にあるタブ名を使う)
  3. 操作できる部品をすべて並べた表(部品名 / 場所 / 何ができるか / 関係する状態・関数)。ドラッグ・キーボード操作も含める
  4. プリセット(スタイル・フォント・音声)の中身の概要と、その定義ファイル
  5. 書き出し画面の選択肢(ブラウザ内書き出しとサーバー書き出しの切り替え条件、進捗表示、失敗時の表示)。仕組みの詳細はタスクC・Dに任せる

### タスクC: データの流れと保存先(観点4)

- 見る場所
  - `src/lib/videoProject.ts`、`src/lib/uploadedVideo.ts`、`src/lib/styleReference.ts`
  - `src/app/api/upload/route.ts`、`src/app/api/upload-audio/route.ts`、`src/app/api/media/[...path]/route.ts`、`src/app/api/render/**`
  - ジョブ管理: `src/lib/gemini/{autoEditJobs,extractStyleJobs,transcribeJobs,voiceoverCache,styleExamplesStore,editExamplesStore}.ts`、`src/lib/remotion/renderJobs.ts`
  - クライアント側の保存・書き出し: `src/app/create/uploadVideoFile.ts`、`src/components/editor/uploadAudioFile.ts`、`src/components/editor/useWebRender.ts`、`src/components/editor/useRenderJob.ts`
  - `data/**`(`README.md` と `examples.json` の構造。動画ファイルの中身は見ない)、`public/**`(`videos/`、`fonts/`、`audio/presets/`)、`scripts/sync-edit-examples.mjs`、`next.config.ts`(アップロード上限など)、`.dockerignore`
  - `/dev/*`(`src/app/dev/**`、`src/app/api/dev/**`)のデータの流れもここで担当する
- 成果物に含める項目
  1. 入力元の一覧(動画・音声のアップロード、フォーム入力、外部データ、`data/` の見本データ)
  2. 処理の流れ(アップロード → 保存 → AI処理ジョブ → 編集状態 → 書き出し)。図にできるよう「入力 / 処理 / 出力先 / 担当ファイル」の表にする
  3. 保存先ごとの一覧: ブラウザ(localStorage / IndexedDB / sessionStorage / メモリ。キー名と保存内容)、サーバーのファイル(保存パス、配信ルート `/api/media/...`、消えるタイミング)、サーバーのメモリ(ジョブMapなど。再起動で消えるか)、`data/`、`public/`
  4. 書き出しファイルの行き先(ブラウザ内書き出しでのダウンロード / サーバー書き出しの出力パス)
  5. `/dev/*` の開発者向けツールのデータの流れ(見本の登録・取り込み・書き出し、`sync:edit-examples` の役割)
  6. データが残る期間・消えるタイミングで、利用者が注意すべき点(平易な言葉で)

### タスクD: 外部連携と生成AIの呼び出し(観点5・6)

- 見る場所
  - `src/lib/gemini/**`(`autoEditPlan`、`extractStyle`、`transcribeCaptions`、`generateVoiceover`、`geminiFiles`、`geminiErrors`、`rateLimiter`、`voiceOptions`、`textUtils`、`styleTypes`、`autoEditTypes`)
  - AIを呼ぶAPIルート: `src/app/api/{auto-edit,extract-style,extract-style-from-video,transcribe-captions,generate-voiceover}/**`、`src/app/api/dev/style-examples/suggest/route.ts`
  - `src/lib/googleMaps/places.ts`、`src/app/api/insights/**`
  - Remotion: `src/lib/remotion/{bundle,browser,renderJobs}.ts`、`remotion/**`、`remotion.config.ts`、`src/components/editor/useWebRender.ts`(ライセンスキー変数の扱い)
  - デプロイ: `render.yaml`、`Dockerfile`、`.env.local.example`、`package.json`、`README.md`
  - アセットの出典: `public/audio/presets/CREDITS.md`、`remotion/shared/font.ts`(フォントの読み込み元)
- 成果物に含める項目
  1. 外部連携の一覧表(サービス・SDK名 / 用途 / 呼び出す場所 / 使う環境変数名 / サーバー側かブラウザ側か)。Gemini API、Google Maps(Places)、Remotion(サーバー書き出し・ブラウザ書き出し・Player)、Google Fonts、Render(`render.yaml`)、Docker を含める
  2. 生成AI呼び出しの一覧表(ファイル / 関数名 / 呼ばれるAPIルート / プロバイダ / モデル(既定値と上書き用の環境変数名) / 目的 / 入力(動画・音声・テキスト) / 出力の形(JSONスキーマなど))
  3. Gemini Files API の使い方(アップロード・削除のタイミング)
  4. レート制御: `rateLimiter.ts` の仕組み(間隔の設定と環境変数名)、再試行・エラー分類(`geminiErrors.ts`)、キャッシュ(`voiceoverCache.ts`)
  5. キーの管理: サーバーの環境変数キーと、**利用者自身のAPIキー**の受け渡し(入力場所・ブラウザでの保存有無と保存先・リクエストでの渡し方(ヘッダー名など)・サーバー側の優先順位・ログに出ないか)。値は書かない
  6. デプロイ構成の要点(`render.yaml` のサービス定義・プラン名、`Dockerfile` のベースイメージとChromium等の書き出し用の依存、メモリ制約への対策の経緯。関連コミット `de3ece5`、`4b47ac6`、`d93d01c`)
  7. 無料枠・ライセンスに関わる注意点で、**コードや同梱文書から読み取れる範囲のもの**(例: Remotionのライセンスキー変数、効果音のクレジット)。料金ページなど一次情報での確認はこのタスクでは行わず、必要なら「tech-researcherで要確認」と書く

## 4. 実行順序と引き継ぎ

1. タスクA〜Dを Explore エージェントに**並列で**投げる(互いに依存しない)
2. 各タスクは結果をメインエージェントへ直接返す(ファイルには書かない)
3. メインエージェントが4つの結果を突き合わせる。重なる部分(書き出しはB/C/D、APIキーはA/D、`/dev/*` はC/D)は、担当タスクの記述を正とする
   - 画面の見え方はA・B、データの行き先はC、外部サービスとAIはD
4. 矛盾や「未確認」が残った場合は、その点だけを対象にExploreを追加で1回走らせる
5. メインエージェントが下のセクション構成に沿ってHTMLを作り、公開する

## 5. 担当エージェント

| 工程                     | 担当                                     | 備考                                                                                                                                           |
| ------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| タスクA〜D(コード調査) | Explore(組み込みの読み取り専用エージェント) | 依頼者の指定による。`.claude/agents` の定義では、パターン4のコード調査はmicroservices-architectの担当。Exploreを使えない場合はmicroservices-architectで代える |
| 外部サービスの料金・規約の確認 | tech-researcher(任意)                | 今回の範囲外。HTMLに無料枠やライセンスの記述を載せる場合だけ、一次情報で確認する                                                                 |
| HTMLの作成と公開         | メインエージェント                       | 依頼者の指定による。`.claude/agents` にはドキュメントやHTMLの組版を担当するエージェントがない(担当不在)                                        |

## 6. 最終HTMLページのセクション構成案(目次)

各節は「平易な概要」→「開発者向け詳細」(折りたたみ `<details>` などで分ける案)の二段構成にする。

1. **はじめに**
   - このアプリで何ができるか(SNS向けの短い動画を、AIの助けを借りて作り・編集し・書き出す)/ 想定利用者 / このページの読み方
   - 開発者向け: 技術スタック・リポジトリ構成(`src/app`、`src/components`、`src/lib`、`remotion`、`data`、`public`)
2. **全体像(1枚図)**
   - 利用者 → ブラウザ → Next.jsサーバー → 外部サービス(Gemini / Google Maps)→ 書き出し(ブラウザ内 / サーバー)
3. **ページ一覧**(タスクA)
   - 3.1 利用者向けページの一覧表
   - 3.2 動画ができるまでの流れ(ページ遷移)
4. **各ページの機能と画面パーツ**(タスクA・B)
   - 4.1 トップ(`/`)
   - 4.2 動画の作成(`/create`、`/create/style`、`/create/auto-edit`、`/create/cut`)
   - 4.3 編集画面(`/edit`): レイアウト / タイムライン / タブ・パネル別の機能 / 操作部品の一覧
   - 4.4 書き出し(`/edit/export`)
   - 4.5 インサイト(`/insights`)
5. **データの流れと保存場所**(タスクC)
   - 5.1 入力 → 処理 → 出力の流れ図
   - 5.2 保存場所の一覧(ブラウザ / サーバーのファイル / サーバーのメモリ / `data/` / `public/`)
   - 5.3 データが消えるタイミングと注意点
6. **外部サービスとの連携**(タスクD)
   - 6.1 連携先の一覧(Gemini、Google Maps、Remotion、Google Fonts)
   - 6.2 動画書き出しの仕組み(ブラウザ内書き出し / サーバー書き出し)
   - 6.3 デプロイ構成(Render、Docker)
7. **生成AIの使いどころ**(タスクD)
   - 7.1 AIが手伝う作業の一覧(平易な言葉で)
   - 7.2 呼び出し箇所の一覧表(ファイル・関数・モデル・目的)
   - 7.3 呼び出し回数の制御・エラー時の動き・キャッシュ
   - 7.4 APIキーの扱い(サーバーのキー / 利用者自身のキー)
8. **開発者向けツール(`/dev/*`)**(別枠。タスクA・C・D)
   - 8.1 スタイル見本の管理(`/dev/style-examples`)
   - 8.2 編集見本の管理(`/dev/edit-examples`)と `sync:edit-examples`
9. **付録**
   - 9.1 APIルートの一覧(メソッド / パス / 役割 / 担当ファイル)
   - 9.2 環境変数名の一覧(名前 / 用途 / 必須か任意か。値は書かない)
   - 9.3 同梱アセットの出典(フォント・効果音)
   - 9.4 用語集(ジョブ、レンダリング、タイムライン、インスペクタ など)

## 7. 確認事項と決定(2026-09-25 ユーザー回答済み)

- Q1. 担当エージェント → **microservices-architect**(`.claude/agents` の定義どおり。ファイルは書かず結果を返すだけに限定)
- Q2. 無料枠やライセンスの記述 → **tech-researcherで一次情報を確認してから載せる**(タスクDの「要確認リスト」を入力にする。確認日を併記)
- Q3. 開発者向け詳細の見せ方 → **折りたたみ(`<details>`)**
- その他の決定: 説明対象は origin/main のみ(未マージの `feature/gemini-additional-token-savings` の内容は含めない)。成果物はclaude.ai上のHTMLアーティファクトで、リンクは `docs/system-overview.md` に置く
