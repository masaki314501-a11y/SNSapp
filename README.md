# SNSapp

縦型ショート動画(9:16)をAIに編集させるツール。1本の動画をアップロードして不要な部分をカットし、
真似したい投稿のスクリーンショットを渡すと、Geminiが動画を見て切り方・寄り(ズーム)・強調テキスト・
効果音・冒頭の見出しまで編集をまとめて行う。字幕は編集画面で必要なら一括生成でき、
トリミング・並べ替え・スタイル調整・SE/BGM/AIナレーション追加をした上で、Remotionで
動画として書き出せる。

## 使い方

`npm run dev` 後、`http://localhost:3000/create` を開く。編集の流れは
**アップロード → カット → 参考スクショ → 自動編集 → クリップ編集 → 書き出し** の6画面。

### 1. `/create` — アップロード

動画ファイルをアップロードする(`/api/upload` → `public/videos/` に保存、実際の長さを
ブラウザ側で自動検出)。完了すると動画全体を1つの「使う範囲」として保存し、`/create/cut` へ。
長さの自動検出はSafari(iOS/iPadOS)で一部の動画形式だと失敗することがあり、その場合は
エラー表示と「長さの取得を再試行」ボタンを出す。

### 2. `/create/cut` — ラフカット

不要な部分(前置き・言い淀み・撮り直し等)を先に切り捨てる画面。分割(`S`キー)・イン/アウト点
(`I`/`O`キー)・トリム・削除・並べ替えで「使う範囲」を絞り込む。ここで捨てた範囲は、
この後の自動編集・字幕の一括生成の対象にならない(自動編集はこの範囲の中からだけ切り出す)。

プレビュー下の「元動画のうち使う範囲」バーは操作できる。クリックでその時刻へ移動、
横にドラッグで元動画上の範囲を選ぶと「この範囲を捨てる」「ここだけ残す」が出る
(分割→分割→選択→削除の4手を1手にするための導線。何テイクも撮った中から1テイクだけ
使いたい場合は「ここだけ残す」)。キーボードは `Space`(再生/一時停止)、`←`/`→`(1フレーム
送り、`Shift`併用で1秒)、`S`(分割)、`I`/`O`(イン/アウト点)、`Delete`(選択を削除)。
トリム(ドラッグ・`I`/`O`)もUndo/Redoの対象。

### 3. `/create/style` — 参考スクショ(見た目の手本)

(任意)真似したい投稿の**スクリーンショットまたは動画**をアップロードすると、Geminiが配色・フォント・
テロップ位置・テロップの背景の付き方・出現演出をまとめて抽出する(`/api/extract-style` または
`/api/extract-style-from-video`、非同期ジョブ+ポーリング)。判定は既定でProモデル(`gemini-pro-latest`)
が行い、文字の太さ・縁取り・帯・差し色・配置を観察してから候補を選ぶ。スクリーンショットは細部を
読めるよう高解像度で渡す。`/dev/style-examples`(開発者用、下記参照)で正解データを登録しておくと、
抽出のたびにfew-shot例として自動的に使われ精度が上がる。

渡した参考はサーバーに保存し(画像は `public/references/`、動画は `public/videos/`)、パスを
プロジェクトの `styleReference` に残す。次の自動編集がこれを**最優先の手本**として直接見るため。
新しい参考を渡さずに進んだ場合は前回の参考を使い続ける。「自動編集へ進む」を押すと、カットで残した
範囲を `cutKeepRanges` として保存して `/create/auto-edit` に遷移する。

以前はここで音声から字幕を生成していたが、字幕を付けるかどうかは編集画面で決める流れにしたため、
編集画面の「字幕を一括生成」に移した。

### 4. `/create/auto-edit` — 自動編集(バズる動画)

カット後・手動編集に入る前に割り込む画面。「🪄 自動編集する」を押すと `/api/auto-edit` が
ジョブを開始し(非同期ジョブ+ポーリング、`useAutoEditJob.ts`)、Gemini(既定は `gemini-pro-latest`)に
編集の判断を**すべて任せる**。決まった候補から選ばせるのではなく、文言・位置・色・大きさ・倍率・秒数は
Geminiが自由に決めた値をそのまま描く(フォントとテロップの出現演出だけは、同梱・実装済みの中から選ぶ)。

Geminiに渡すもの(この順が手本の優先順位):

1. **参考スクショ/動画**(手順3で渡したもの。最優先・絶対)
2. **編集例**(`/dev/edit-examples`で登録した学習動画=編集前と正解動画=編集後のペア、最大3組。
   「素材に何を足したか」の差分から編集者の癖を学ばせる。低解像度で渡してコストを抑える)
3. **本人の動画**(カットで残した範囲と一緒に)

Geminiが決めること:

- **切り方**: 残した範囲の中から、間・言い淀み・無音を詰めて1〜4秒ほどのクリップに切り直し、
  並べ替えてもよい(範囲外は使わない。サーバー側でも範囲に収める)
- **寄り(ズーム)**: 倍率・一気に寄るかじわじわ寄るか・寄る中心の位置
- **強調テキスト**: 「実は3倍!」のような字幕とは別の文字。文言・位置・大きさ・色・縁取り・帯・傾き・タイミング
- **ずっと出す文字**: 参考にあれば、動画上部に常に出ているタイトル
- **冒頭の見出し(0〜3秒・画面中央)**と**締めの一言(最後の5秒・画面下寄り)**
- **効果音**(クリップ内の秒位置まで)と**AIナレーション**(最大10個)
- **全体の差し色・フォント・字幕の位置と見た目**、字幕を付けた時に色を変える強調単語
- 各クリップで話している内容の書き起こし(`speechText`。編集画面の「字幕を一括生成」で使う)

控えめすぎる編集にならないよう、寄りはクリップの4〜6割、強調テキストは半分以上、効果音は半分前後を
目安として指示している。見出し・タイトル・字幕・締めの一言が重ならないよう、画面のどこに何が出るかも伝える。

生成結果は「この案を使う」を押すまでプロジェクトに書き込まれない。使うとクリップ構成・効果音・
ナレーションが置き換わる(BGMはそのまま)。「別の案を作る」でやり直せる。ジョブが失敗・処理中でも
「スキップして編集へ進む」は常に押せる(自動編集がパイプラインを詰まらせないようにするため)。
1回あたりの目安は入力約3.5万トークン+出力・思考約5千トークン、2〜3分(53秒の動画・参考スクショ1枚・
編集例2組で実測)。

### 5. `/edit` — クリップ編集

Remotion Playerでのプレビューを見ながら、以下を編集できる。

- **クリップ**: トリミング(開始秒・長さ、ドラッグ or イン/アウト点`I`/`O`)、分割(`S`)、
  追加・削除・複製・結合、ドラッグ&ドロップや↑↓での並べ替え、複数選択(Shift/Ctrl)、
  字幕の個別編集・一括編集・**一括生成**(自動編集の書き起こしがあればそれを流し込むだけで
  APIを呼ばない。無ければ動画全体を文字起こしし、クリップの切り方は変えずに各クリップへ割り当てる
  `assignTranscriptToSegments`)・全部消す、クリップごとの音量(元の音声だけをミュートするチェックボックス
  付き)、テロップ出現アニメーション(9種)、Undo/Redo
- **スタイル**: 自動編集が付けた冒頭の見出し・締めの一言の修正(空にすると消える)と、ずっと出す文字の削除、
  プリセット(6種)一括適用、配色、テロップの見た目(カラー背景/縁取り文字)、
  フォント(15書体)、テロップ位置、文字サイズ、全体フェードイン/アウト
- **音声(SE・BGM・AIナレーション)**: 効果音の追加(プリセット10種 or アップロード、最大30個、
  `/api/upload-audio`)、BGM設定(音量・フェードイン/アウト、ループ再生)、テロップをAI音声で
  読み上げてナレーションとして追加(`/api/generate-voiceover`、クリップ単位 or 全クリップ一括)

AIナレーションは既定で `gemini-3.8-flash-tts` を使う(旧 `gemini-2.5-flash-preview-tts` より
抑揚が自然)。「明るく読んで」のような読み方の指示を本文に付けると指示文ごと読み上げてしまう
ため、テロップ本文だけを渡している。3.x系のTTSはWAVで返し、2.5系は生PCMで返すので両方に対応する。

Gemini TTSは1日あたりの上限があり課金額も少額(プリペイド800円)のため、AIナレーションはAPIの呼び出し回数を
減らす作りにしている。

- **生成済み音声の使い回し**: 「モデル名+声+文言」から決まるファイル名で
  `public/audio/generated/` に保存し、同じ組み合わせなら再生成せずそのファイルを返す
  (`src/lib/gemini/voiceoverCache.ts` の `getOrGenerateVoiceover`、手動生成・自動編集の
  両方から共有)。テロップを直して作り直す・一括生成をやり直す・失敗した続きからやり直す、
  といった場面でAPIを消費しない
- **未生成分だけを一括生成**: ナレーションは読み上げ元クリップの `narrationSegmentKey` を
  持つため、一括生成は「まだ作っていないクリップ」だけを対象にする(ボタンにも残り件数を
  表示)。個別生成は作り直しとして既存のナレーションを差し替える(同じ台詞が重ならない)
- **上限に達したときの扱い**: 1日あたりの上限(`PerDay`)は待っても翌日まで回復しないため
  再試行せず即座にその旨を表示する。1分あたりの制限は従来通り再試行し、Geminiが返す
  `retryDelay` を「約N秒後に再度お試しください」として見せる。Gemini APIはプリペイド
  (上限800円)で運用しているため、チャージ残高切れのエラーも再試行せず「AI Studioでチャージして
  ください」と表示する。一括生成は途中で失敗しても
  そこまでの分がタイムラインに残るので、翌日押し直せば残りだけが生成される(中断ボタンもあり)

編集内容は操作のたびに自動保存され、リロード/再訪問時に復元される。プロジェクトの
JSONエクスポート/インポートにも対応する。

### 6. `/edit/export` — 書き出し

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
  - `useAutoEditJob.ts` — 自動編集ジョブの開始とポーリング
  - `auto-edit/` — 自動編集(バズる動画)のUI(`AutoEditScreen.tsx` を配置)
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
- `src/lib/styleReference.ts` — 参考スクショの保存(`public/references/`)と、参考画像/動画パスの検証・解決
  (`transcribe-captions`・`extract-style-from-video`で共用)
- `src/app/api/` — Route Handler群
  - `upload/` — 動画を `public/videos/{uuid}.{ext}` に保存(上限200MB)
  - `upload-audio/` — SE/BGM音声を `public/audio/{uuid}.{ext}` に保存(上限20MB)
  - `extract-style/` — 参考画像から配色・フォント・位置・背景・演出を抽出(Gemini、非同期ジョブ+ポーリング)
  - `extract-style-from-video/` — 参考動画版(Gemini File API経由、同じジョブストアを共有)
  - `transcribe-captions/` — 動画の音声を文字起こし(Gemini、非同期ジョブ+ポーリング)
  - `generate-voiceover/` — テロップをAIナレーション音声(WAV)に変換(Gemini TTS、同期レスポンス、
    内容から決まるファイル名で生成済み音声を使い回す)
  - `render/` — Remotionでの動画書き出し(非同期ジョブ+ポーリング)
  - `auto-edit/` — 自動編集(バズる動画)の提案を生成(Gemini、非同期ジョブ+ポーリング)。
    プラン生成に続けてAIナレーション/効果音クリップの生成まで同じジョブ内で行う
  - `media/[...path]/` — `public/videos` `public/audio` `public/renders` を都度ファイル
    システムから配信するRoute Handler。通常のpublic配信はビルド時点のスナップショット
    しか返さず、起動後にアップロード/生成されたファイルは本番ビルドで404になるため必要。
    HTTP Rangeリクエストにも対応(iOS/iPadOSの「ビデオを保存」やシーク操作に必要)
- `src/lib/gemini/` — Gemini API呼び出しのラッパー
  - `transcribeCaptions.ts` / `transcribeJobs.ts` — 動画をFile APIにアップロードし、発話区切り
    ごとの `{startFromSeconds, durationInSeconds, caption}` 配列を取得する。ジョブはインメモリ管理
    (単一プロセス前提)
  - `extractStyle.ts` / `extractStyleJobs.ts` — 参考画像/動画から配色・フォント・位置・背景・
    演出を抽出する(画像はinlineData、動画はFile API経由)。`styleExamplesStore.ts` に
    登録済みの正解データがあれば、リクエストのたびにfew-shot例として先頭に差し込む
  - `styleExamplesStore.ts` / `styleTypes.ts` — スタイル抽出のfew-shot例(正解データ)の
    保存・読み込み(`data/style-examples/`、詳細は後述の`/dev/style-examples`参照)
  - `autoEditPlan.ts` / `autoEditTypes.ts` / `autoEditJobs.ts` — 自動編集(バズる動画)。参考スクショ →
    編集例(`editExamplesStore.ts`の学習動画+正解動画のペア、最大3組) → 本人の動画の順にGeminiへ渡し、
    編集の判断をすべて任せる。Geminiの生の応答はあえて緩いスキーマで受け、範囲外の数値の丸め込みや
    不正な要素の除外は要素ごとに行う(1か所の不備で編集案全体を捨てないため)
  - `editExamplesStore.ts` — 自動編集のfew-shot例(学習動画・正解動画)の保存・読み込み
    (`data/edit-examples/`、詳細は後述の`/dev/edit-examples`参照)
  - `generateVoiceover.ts` — Gemini TTSでテロップを読み上げ音声(WAV)に変換する
  - `voiceoverCache.ts` — 生成済み音声の使い回し(キャッシュ)ロジック。手動生成
    (`/api/generate-voiceover`)と自動編集の両方から共有する
  - `voiceOptions.ts` — AIナレーションの声のプリセット一覧(クライアント/サーバー共用)
  - `geminiFiles.ts` — Gemini File APIアップロード後のACTIVE待ちポーリング(共通処理)
  - `geminiErrors.ts` — 429/503などリトライ可能なエラーの判定と日本語エラーメッセージ変換
  - `rateLimiter.ts` / `textUtils.ts` — レート制御(テキスト系とTTSで別々の列に直列化)・テキスト整形の共通処理
- `src/lib/remotion/` — レンダーAPI用のRemotionラッパー(`bundle.ts` / `browser.ts` / `renderJobs.ts`)

### Remotion側 (`remotion/`)

- `remotion/templates/standard/` — 唯一のテンプレート「音声字幕」(テンプレート選択UIは無い)
  - `schema.ts` — 入力プロパティのzodスキーマ(クリップ配列は1〜40個、SEは最大30個、
    `hook`/`cta`/`globalOverlays`は任意)。クリップごとに寄り(`zoom`)・強調テキスト(`overlays`)・
    強調単語(`emphasisWords`)も持てる
  - `StandardVideo.tsx` — クリップを`<Series>`でつなぐルートコンポーネント。`hook`/`cta`は尺を足さず、
    冒頭/末尾のカットの上に重ねる(1フレーム目から本人の映像が見えている方がスクロールを止めやすいため。
    効果音の秒位置がクリップの累積秒とずれないようにするためでもある)
  - `duration.ts` — クリップ尺の合計から動画全体の尺(フレーム数)を算出する共通ロジック
  - `defaultProps.ts` — Remotion Studioで確認する際のサンプルデータ
- `remotion/shared/` — テンプレート間で共有するコンポーネント・スキーマ
  - `AnimatedCaption.tsx` — テロップのアニメーション表示(発話が無い区間は非表示)
  - `captionAnimations.ts` — テロップ出現アニメーション(9種)のtransform/opacity/filter算出
  - `MediaBackground.tsx` — クリップの動画/画像背景描画と寄り(`zoom`: punch=一気に寄る / slow=じわじわ寄る)
  - `TextOverlays.tsx` — 字幕とは別に重ねる強調テキスト(位置・色・大きさ等は指定値をそのまま描く)
  - `Hook.tsx` / `CTA.tsx` — 冒頭の見出し(画面中央、文字数に応じて縮む)・締めの一言(画面下寄り)
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

## `/dev/style-examples` — スタイル抽出の正解データ登録(開発者用)

エンドユーザー向けの導線は無く、URLを直接開いて使う(`/insights`と同じ運用)。参考画像/
参考動画と「本来抽出してほしいスタイル」の組を正解データとして登録しておくと、以後の
スタイル抽出(`extractStyle.ts`)でfew-shot例として自動的に使われ、抽出精度が上がる
(新しいものから最大6件)。

登録内容は `data/style-examples/` にファイルとして保存される。Render等のデプロイ環境は
実行時に書いたファイルを永続化しないため、**本番にも反映したい場合は開発者がそのまま
gitコミットする必要がある**。詳しい形式は `data/style-examples/README.md` を参照。

- 1件ずつ登録: `/dev/style-examples` の画面から画像/動画をアップロードし、正解の
  スタイル値をフォームで入力する。「🤖 今のAIの判定を下書きにする」
  (`POST /api/dev/style-examples/suggest`)を押すと、その素材を今の抽出にかけた結果が
  フォームに入るので、全項目を手入力せず外れている項目だけ直せばよい。人が直した項目には
  「AIの判定: ○○」が添えられ、全項目一致なら「この素材は既に正しく読めています」と出る
  (=登録しても増えるものが少ない素材だと分かる)
- まとめて取り込み: 手元にある動画・画像を `data/style-examples/inbox/` に置き、
  同じ場所の `answers.json` に正解データを記入してから、画面の
  「inboxから取り込み」ボタン(または `POST /api/dev/style-examples/import`)を実行する
  (書式は `data/style-examples/inbox/README.md` を参照)

主なAPI(`src/app/api/dev/style-examples/`): `GET/POST /`(一覧・1件登録)、
`DELETE /[id]`(削除)、`GET /[id]/media`(画像/動画本体の取得)、
`GET/POST /import`(inbox内の件数確認・一括取り込み)、
`POST /suggest`(登録前の素材を今の抽出にかけて下書きを返す。登録前なので`data/`には
残さず一時ファイル経由で渡す)。

## `/dev/edit-examples` — 自動編集の学習・正解動画登録(開発者用)

エンドユーザー向けの導線は無く、URLを直接開いて使う(`/dev/style-examples`と同じ運用)。
`/dev/style-examples`とは別のストア(色などの構造化値ではなく、動画ペアそのものが正解データ)。
「正解動画」(完成度の高い参考動画)を登録しておくと、自動編集(`/create/auto-edit`)で
few-shot例として自動的に使われる(新しいものから最大3件。動画のアップロード・解析は
コスト/時間が重いため画像スタイルの6件より絞っている)。もとになった「学習動画」
(生素材)も任意で登録でき、登録してあれば正解動画とペアでGeminiに渡して「編集前→編集後で
何が足されたか」を読み取らせる(登録を強く推奨)。

登録内容は `data/edit-examples/` にファイルとして保存される(`/dev/style-examples`と同じ
git-commitの前提、詳細は `data/edit-examples/README.md` を参照)。ファイル名は
`{ラベルのスラッグ}-{短いランダムID}.{拡張子}` で保存し、OSのファイルエクスプローラーから
見ても中身が分かるようにしている(UUIDそのままにはしていない)。1件ずつの登録のみ対応
(inboxからの一括取り込みは無い)。

動画のアップロードは2段階(`POST /upload`でストリーム保存 → `POST /`でJSON登録)に
分かれている。`request.formData()`はファイル全体を一度メモリ上のBlobに読み込む実装のため、
Render無料プラン(512MB)で大きい動画をアップロードするとメモリ不足でクラッシュしていた
(`src/app/api/upload/route.ts`と同じ問題、詳細はそちらのコメント・
`editExamplesStore.ts`のコメント参照)。

本番(Render)で登録した内容はデプロイのたびに消えるため、ローカルの
`data/edit-examples/`に取り込んでgitコミットする運用が必要。
`npm run sync:edit-examples -- https://<本番のURL>` を実行すると、本番の
`GET /export`(examples.json相当)と各動画(`GET /[id]/media`)を取得し、
まだローカルに無いもの(id基準)だけ`data/edit-examples/`に追記する
(`scripts/sync-edit-examples.mjs`)。画面からの手動ダウンロード
(「examples.jsonをダウンロード」「各動画のダウンロード」)は1件だけ確認したい時用。

主なAPI(`src/app/api/dev/edit-examples/`): `GET /`(一覧)、
`POST /upload?which=correct|raw`(動画本体をストリームで保存。ヘッダーで
`X-Mime-Type`必須+`X-Label`任意、ボディは生バイト列)、
`POST /`(JSONで`label`必須+任意の`notes`+`correctMediaFilename`/`correctMimeType`必須+
任意の`rawMediaFilename`/`rawMimeType`を渡して登録)、
`DELETE /[id]`(削除)、`GET /[id]/media?which=correct|raw`(動画本体の取得・ダウンロード)、
`GET /export`(`examples.json`と同じ形式のメタデータをダウンロード)。

## 環境変数

- `GEMINI_API_KEY` — 必須。Gemini APIキー(`.env.local`)
- `GEMINI_MODEL` — 任意。文字起こしに使うモデル。既定値は `gemini-flash-latest`
- `GEMINI_STYLE_MODEL` — 任意。参考画像/動画からのスタイル抽出に使うモデル。既定値は `gemini-pro-latest`
- `GEMINI_AUTO_EDIT_MODEL` — 任意。自動編集のプラン生成に使うモデル。既定値は `gemini-pro-latest`
- `GEMINI_TTS_MODEL` — 任意。AIナレーション生成に使うモデル。既定値は `gemini-3.8-flash-tts`
- `GEMINI_MIN_INTERVAL_MS` — 任意。テキスト系Gemini APIリクエスト間の最小間隔(既定1000ms。
  課金していないキーで動かす場合は6500程度に上げる)
- `GEMINI_TTS_MIN_INTERVAL_MS` — 任意。AIナレーション(TTS)リクエスト間の最小間隔(既定6500ms)
- `GOOGLE_MAPS_API_KEY` — 任意。`/insights`で使うGoogle Maps Platform(Places API)のAPIキー

### Gemini APIの課金について

Gemini APIはプリペイド(上限800円)の有料プラン(Tier 1)で運用している。課金はAPIキー
(Google AI Studioのプロジェクト)単位なので、Render側で切り替える設定は無い(同じキーを
`GEMINI_API_KEY` に入れていれば有料枠が効く)。モデルの使い分けは以下の通り。

| 用途 | 既定モデル | 環境変数 |
| --- | --- | --- |
| 自動編集のプラン生成 | `gemini-pro-latest` | `GEMINI_AUTO_EDIT_MODEL` |
| スタイル抽出(スクショ・参考動画) | `gemini-pro-latest` | `GEMINI_STYLE_MODEL` |
| 文字起こし | `gemini-flash-latest` | `GEMINI_MODEL` |
| AIナレーション | `gemini-3.8-flash-tts` | `GEMINI_TTS_MODEL` |

自動編集は1回あたり入力約3万トークン(編集例2組・低解像度時)+思考・出力約3千トークンを
使う(サーバーログの `[autoEditPlan]` 行で毎回確認できる)。残高を使い切ると画面に
「AI Studioでチャージしてください」と表示される。

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
