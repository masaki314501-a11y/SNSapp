# 実装差分方針書(S3)

作成: メインセッション(`fullstack-developer`ペルソナを注入して実施。詳細は
[00-agent-plan.md](./00-agent-plan.md) §2, §4参照)
対象コミット: `d489138`(ブランチ `prototype/1`)
前提: [01-requirements.md](./01-requirements.md)(壊してはいけない機能一覧・非機能要件)、
[02-architecture.md](./02-architecture.md)(論理レイヤー構成、将来分割候補の言語化のみで
物理変更はしない方針)をすべて満たすこと。

## 1. 方針の要約

02-architecture.mdの結論通り、**大規模な構造変更は行わない**。本書は実際にコード
(`src/**`、`remotion/**`、`package.json`等)を通読して見つかった、具体的で裏付けのある
改善点のみを対象にする。改善点が無い/リスクに見合わない領域は§5「現状維持が妥当な領域」に
正直に記載し、変更量の水増しはしない。

読んだファイル数: 約60ファイル(`src/app/api/**/route.ts` 全12本、`src/lib/**` 全14本、
`src/components/editor/**` 全19本、`remotion/**` 全17本、設定ファイル`package.json`
`next.config.ts` `remotion.config.ts`)。

見つかった改善点は重大度別に **高2件・中5件・低4件** の計11件。内訳と詳細は§2〜§4。

## 2. 優先度「高」— 入力検証の抜け(壊してはいけない機能への影響は無いが、堅牢性に関わる)

### H1. `/api/media/[...path]` のパス検証が `.` / `..` セグメントを弾けていない

- **対象ファイル**: `src/app/api/media/[...path]/route.ts`
- **現状のコード(引用)**:
  ```ts
  const SAFE_SEGMENT = /^[0-9a-zA-Z_.-]+$/;
  ...
  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch { ... }
  ```
- **問題**: `SAFE_SEGMENT` は英数字・`_`・`.`・`-` のみのチェックであり、`.` や `..` も
  「許可された文字だけで構成された文字列」として通過してしまう。`rest.length` は1〜2に
  制限されているため被害範囲は限定的だが、例えば `rest = ["..", ".."]` を渡すと
  `path.join(public, videos, "..", "..")` は `public/videos` の2階層上(=プロジェクト
  ルート、`process.cwd()`)を指す。さらに `stat()` の結果に対して `isFile()` の確認が
  無いため、ディレクトリに対してもサイズ取得までは成功し、直後の
  `createReadStream(filePath)` がディレクトリに対して呼ばれてエラーを起こす
  (単一Node.jsプロセス前提の本アプリでは、ここでの予期しない例外は全利用者に影響する)。
  また `rest=["..", "任意のファイル名"]` の形で `public/` 直下の他ディレクトリ
  (`videos`/`audio`/`renders`以外に将来置かれるもの)へも到達できてしまう。
- **修正方針**: `SAFE_SEGMENT` を「`.`のみ・`..`のみを禁止する」形に強化するか
  (例: `segment !== "." && segment !== ".." && SAFE_SEGMENT.test(segment)`)、より
  堅牢には解決後の絶対パスが `path.join(process.cwd(), "public", dir)` 配下に
  収まっていることを `path.resolve` + `startsWith` で確認する。加えて `stat()` の後に
  `fileStat.isFile()` を確認し、ディレクトリなら404を返す(`src/lib/uploadedVideo.ts`の
  `resolveUploadedVideo`が既に行っている `isFile()` チェックと同じパターンに揃える)。
- **リスク**: 低。`/api/media`はGET専用の読み取りAPIで、修正は「正規のリクエストの
  挙動を変えない範囲でチェックを厳格化する」だけ。壊してはいけない機能一覧
  4.4「`/api/media/[...path]`でのRange対応配信」への影響が無いことを、修正後に
  動画・音声・レンダー結果それぞれの正常系(通常のパス・Rangeリクエスト双方)で
  手動確認する。
- **優先度**: 高

### H2. `/api/render` のクリップ/SE/BGMの`src`がパス形式を検証していない

- **対象ファイル**: `src/app/api/render/route.ts`、`remotion/shared/schema.ts`
- **現状のコード(引用)**:
  ```ts
  // mediaItemBaseSchema (remotion/shared/schema.ts)
  src: z.string().optional().describe("動画ファイルのパス(public/配下、staticFile()で参照)またはURL。...")
  // sfxClipSchema / bgmSchema も同様に z.string() のみ
  ```
  ```ts
  // src/app/api/render/route.ts
  const resolveUploadedSrc = (src?: string): string | undefined => {
    if (!src || src.startsWith("http://") || src.startsWith("https://")) return src;
    return `${LOCAL_ORIGIN}/api/media/${src}`;
  };
  ```
- **問題**: `/api/transcribe-captions` と `/api/extract-style-from-video` は
  `videoPath: z.string().regex(VIDEO_PATH_PATTERN)`(`src/lib/uploadedVideo.ts`)で
  厳格にパス形式を検証しているのに対し、`/api/render`のクリップ・SE・BGMの`src`は
  任意の文字列を許容している。これにより、(a) `src`に`"../../..."`のような値を渡すと
  H1の脆弱性と組み合わさってパストラバーサルの起点になる、(b) `src`が`http://`/`https://`
  で始まる場合はそのままヘッドレスChromiumに渡され外部URLを直接読み込ませてしまう
  (アプリのUI上、クリップ/SE/BGMはすべて自アプリの`/api/upload`系エンドポイントか
  同梱プリセット由来のパスしか生成されないため、任意の外部URLを許容する必要は本来無い)。
- **修正方針**: `mediaItemBaseSchema.src` / `sfxClipSchema.src` / `bgmSchema.src` を、
  「`videos/`・`audio/`配下の相対パス(`VIDEO_PATH_PATTERN`相当の正規表現、SE/BGM用の
  拡張子も許可する版を追加)」のみを許容する形に狭める。既存の同梱プリセット
  (`audio/presets/sfx/*.mp3`)や生成音声(`audio/generated/*.wav`)のパス形式も
  漏れなく通ることを確認する。
- **リスク**: 中。スキーマを厳格化すると、想定していない形式のプロジェクトJSON
  (`handleExportProject`でエクスポートした古い形式や、手動編集されたJSON)を
  インポートして書き出そうとした際に拒否される可能性がある。壊してはいけない機能一覧
  4.3「プロジェクトのJSONエクスポート/インポート」・4.4「書き出しジョブ」に関わるため、
  修正後は実際に`/edit`で一通り(クリップ・SE・BGM・AIナレーション音声すべてを含む)
  編集したプロジェクトを書き出せることを確認する。
- **優先度**: 高

## 3. 優先度「中」

### M1. 非同期ジョブの「起票→ポーリング」パターンが3系統(文字起こし/スタイル抽出/レンダー)で
   API層・クライアント層それぞれに重複実装されている

- **対象ファイル**:
  - APIステータス取得: `src/app/api/render/[jobId]/route.ts`、
    `src/app/api/transcribe-captions/[jobId]/route.ts`、
    `src/app/api/extract-style/[jobId]/route.ts`
  - クライアントのポーリングフック: `src/components/editor/useRenderJob.ts`、
    `src/app/create/useTranscribeJob.ts`、`src/app/create/useExtractStyleJob.ts`
- **根拠**: 3本の`[jobId]/route.ts`は、参照するジョブストアの関数名以外は
  完全に同一の制御フロー(`getXxxJob`→無ければ404→あれば200でそのまま返す)。
  3つのポーリングフックも「`setInterval`で`fetch`→終了状態なら`clearInterval`」という
  同じ形の処理を個別に実装している。
- **02-architecture.mdとの関係**: 02-architecture.md §2は「ジョブストア3種
  (`transcribeJobs.ts`/`extractStyleJobs.ts`/`renderJobs.ts`)自体の共通化は、
  ジョブごとに状態遷移の型が異なるため無理に共通化すると型安全性が下がる」として
  見送りを結論づけている。**この結論には同意する**(§5で改めて記載)。ただし
  今回新たに読み直して分かったのは、**ジョブストアより外側の「APIステータス取得
  ハンドラ」と「クライアントのポーリングフック」は、ジョブの型に依存しない純粋な
  制御フローであり、ジェネリクスで型安全性を落とさずに共通化できる**という点である。
- **修正方針**:
  - APIステータス取得: `getXxxJob(jobId) => TJob | undefined`を受け取り、無ければ404・
    あれば200で返す小さな共有ヘルパー(例: `src/lib/jobStatusResponse.ts`の
    `jobStatusResponse<TJob>(job: TJob | undefined)`)を作り、3本の`route.ts`は
    それぞれ1行の呼び出しに縮める(ジョブ型はジェネリクスで維持されるため型安全性は
    落ちない)。
  - クライアント: `usePollingJob<TState>(url: string, isTerminal: (state) => boolean)`
    的な共有フックを作り、`useRenderJob`/`useTranscribeJob`/`useExtractStyleJob`は
    それぞれの状態型・エンドポイント・完了時コールバックだけを渡す形にする。
- **リスク**: 低〜中。挙動は変えない前提の機械的な抽出だが、3つの非同期フロー
  (書き出し・字幕生成・スタイル抽出)すべてに触れるため、壊してはいけない機能一覧
  4.2〜4.4の進捗表示・完了検知を手動で一通り確認する。
- **優先度**: 中

### M2. Gemini呼び出しの「タイムアウトRace + リトライループ」が3箇所に個別実装されている

- **対象ファイル**: `src/lib/gemini/transcribeCaptions.ts`(136-174行目)、
  `src/lib/gemini/extractStyle.ts`(162-201行目)、
  `src/lib/gemini/generateVoiceover.ts`(70-135行目)
- **根拠**: 3ファイルとも「`Promise.race([generateContentの呼び出し, タイムアウト用Promise])`
  を`runWithGeminiRateLimit`経由で実行し、リトライ可否を判定して指数的バックオフ後に
  再試行する」という同じ形のループを個別に書いている。リトライ可否の判定だけが異なる
  (`transcribeCaptions`/`extractStyle`は`isRetryableApiError`(429/503)のみ、
  `generateVoiceover`は`NoAudioDataError`も含め原因不明のエラーも全種類、という
  01-requirements.md §4.3の要件に基づく意図的な違い)。
- **修正方針**: `callGeminiWithRetry<T>(fn, { maxAttempts, baseDelayMs, timeoutMs,
  shouldRetry })`のような共有ヘルパーに抽出し、`shouldRetry`のみ呼び出し元ごとに
  渡す。この関数は純粋な非同期制御フロー(実際のGemini呼び出し部分は引数の`fn`に
  閉じ込める)なので、フェイクタイマー+モック関数で単体テストしやすい
  (§6のテスト基盤導入と合わせて実施すると相性が良い)。
- **リスク**: 中〜高。**01-requirements.md §4.2/§4.3のリトライ要件
  (文字起こし・スタイル抽出・AIナレーション生成それぞれの再試行挙動)に直接関わる**
  ため、自動テストが無い現状では抽出時にリトライ回数・遅延時間・エラー種別ごとの
  分岐を1つでも取り違えると壊れたことに気づきにくい。3箇所とも個別のリトライ方針
  (最大試行回数・遅延計算)を持つ点も踏まえ、**単体テストを併設できる場合に限り
  着手する**(§6参照)。テストを用意できないなら、この項目は今回のS3スコープでは
  見送り、現状維持とすることを推奨する。
- **優先度**: 中(ただし着手条件付き。詳細は§7実行順序)

### M3. `ClipEditor.tsx`と`CutEditor.tsx`でUndo/Redo・選択・キーボードショートカットの
   ロジックがほぼ丸ごと重複している

- **対象ファイル**: `src/components/editor/ClipEditor.tsx`、
  `src/components/editor/CutEditor.tsx`
- **根拠**: 両ファイルとも次のロジックをほぼ同一の実装で個別に持つ。
  - Undo/Redo(`history`/`future`のstate、`pushHistory`/`undo`/`redo`)
  - トリム時のクランプ処理(`applySegmentPatch` / `applyTrimPatch`。内部で
    `clampTrimStart`/`clampTrimEnd`を呼ぶ形も同一)
  - クリップ選択(単一/Ctrl個別トグル/Shift範囲選択)の`selectSegment`
  - キーボードショートカット全体(`ClipEditor.tsx`642-704行目、
    `CutEditor.tsx`353-410行目。Undo/Redo・Delete・S(分割)・I/O(イン/アウト点)・
    Space(再生)・矢印キー(コマ送り)の判定ロジックがほぼ1文字単位で一致)
- **問題**: 現状は「カット画面でショートカットの挙動を直すと、編集画面には反映され
  ない(その逆も同様)」という保守リスクを常に抱えている。実際、両画面のキー判定は
  現時点でほぼ一致しているが、これは意図した共通化ではなく偶然の一致に近い
  (別ファイルなので今後どちらか一方だけ更新されてもコンパイルエラーにならない)。
- **修正方針**: `useSegmentHistory<T>(initialSegments)`(Undo/Redo)、
  `useSegmentSelection<T>()`(選択状態)、`useTimelineKeyboardShortcuts(handlers)`
  (キーボード判定)の3つのカスタムフックに切り出し、両画面から利用する形にする。
  `CutEditor`と`ClipEditor`で必要なハンドラ(分割・イン点・アウト点等)の集合が
  微妙に異なる(`ClipEditor`のみ複数選択削除・複製・結合等を持つ)ため、フックは
  「必要なハンドラだけを渡せば動く」形の疎結合なインターフェースにする。
- **リスク**: 中。壊してはいけない機能一覧4.1(カット画面のショートカット)・
  4.3(編集画面のUndo/Redo・複数選択)の両方に関わる中心的なロジックである。
  抽出後は両画面で全ショートカット(S/I/O/Space/矢印/Delete/Ctrl+Z/Ctrl+Shift+Z)と
  Undo/Redoの往復、複数選択(Shift/Ctrl)を手動で一通り確認する。
- **優先度**: 中

### M4. キーボードショートカットの`useEffect`に依存配列が無く、動画再生中は
   毎フレーム`window`への`keydown`リスナーを付け外ししている

- **対象ファイル**: `src/components/editor/ClipEditor.tsx`(642-704行目)、
  `src/components/editor/CutEditor.tsx`(353-410行目)
- **現状のコード(引用、ClipEditor.tsx)**:
  ```ts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { /* ... */ };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }); // ← 第2引数(依存配列)が無い
  ```
- **問題**: 依存配列が無い`useEffect`はレンダーのたびにクリーンアップ→再登録される。
  同ファイル内の`previewFrame`は`Player`の`frameupdate`イベント(299-308行目)を
  ソースに、再生中はおおよそ動画のfps(30fps)相当の頻度で更新される
  stateである。`previewFrame`の更新によるre-renderのたびに、このキーボード
  ショートカット用の`window`イベントリスナーが解除→再登録され続けることになる
  (機能的な破綻はしないが、再生中ずっと無駄なDOM操作が走り続ける)。
- **修正方針**: M3のフック抽出(`useTimelineKeyboardShortcuts`)と同時に、
  可変な値(`selectedKeys`、`canSplitAtPlayhead`、`activeSegmentKey`等)を`ref`に
  退避してリスナー登録を`[]`(マウント時1回)にする、一般的な
  "最新値をrefで読むイベントハンドラ"パターンに直す。
- **リスク**: 低(M3と同時に行えば追加の検証コストはほぼ無い)。単独で直す場合も
  挙動は変えない意図なので低リスクだが、キーボードショートカット全種の再確認は行う。
- **優先度**: 中(M3とセットで実施)

### M5. `ProjectSfxClip`はSE/AIナレーションの区別を`label`文字列の絵文字接頭辞に
   依存しており、型として区別されていない

- **対象ファイル**: `src/lib/videoProject.ts`(`ProjectSfxClip`型)、
  `src/components/editor/ClipEditor.tsx`(355-357行目)
- **現状のコード(引用)**:
  ```ts
  // ClipEditor.tsx
  const isNarrationClip = (clip: ProjectSfxClip) => clip.label.startsWith("🎙");
  ```
- **問題**: `sfxClips`配列にはSEとAIナレーションが同じ`ProjectSfxClip`型で混在しており、
  「AIナレーションかどうか」は`label`が絵文字`🎙`で始まるかという**文字列の慣習**でしか
  判定できない。アップロードしたSEの元ファイル名(`uploadAudioFile`が返す`fileName`が
  そのまま`label`になる、`ClipEditor.tsx`706-731行目)がたまたま`🎙`から始まる場合、
  「SE」タブと「AI音声」タブの振り分けを誤る。低確率ではあるが、型で表現できる区別が
  文字列規約に依存している点は型安全性上の抜けである。
- **修正方針**: `ProjectSfxClip`に`kind?: "sfx" | "narration"`を追加し、
  `appendNarrationClip`(ClipEditor.tsx 764-778行目)では`kind: "narration"`を
  明示的に付与する。`videoProject.ts`の`normalizeProject`(既存フィールド追加時と
  同じ後方互換パターン)で、`kind`が無い既存データ(localStorageに保存済みの
  プロジェクト)は現行の`label.startsWith("🎙")`判定で一度だけ補完する。
- **リスク**: 中。永続化される`VideoProject`のスキーマに触れるため、既存の
  localStorageデータ(壊してはいけない機能一覧4.3「リロード/再訪問時の復元」)との
  互換性を保つ後方互換ロジックが必須。修正後は、既存の(接頭辞ベースの)保存データを
  読み込んでSE/AIナレーションの振り分けが変わらないことを確認する。
- **優先度**: 中

## 4. 優先度「低」

### L1. `[jobId]/route.ts`が3ファイルとも実質同一の定型コード

- **対象ファイル**: `src/app/api/render/[jobId]/route.ts`、
  `src/app/api/transcribe-captions/[jobId]/route.ts`、
  `src/app/api/extract-style/[jobId]/route.ts`
- M1の一部として、共有ヘルパー`jobStatusResponse`への置き換えで自然に解消する
  (独立issueとして別途手を入れる必要はない)。
- **優先度**: 低(M1に統合)

### L2. 数値入力(`<input type="number">`)が複数のインスペクターパネルで
   `Number(e.target.value)`をガード無しでそのままstateに反映している

- **対象ファイル**: `src/components/editor/timeline/ClipInspectorPanel.tsx`、
  `SfxInspectorPanel.tsx`、`NarrationInspectorPanel.tsx`、`BgmInspectorPanel.tsx`
  (開始秒・長さ・音量・フェード秒のフィールドすべて)
- **問題**: 入力欄を選択して一度空にすると`e.target.value === ""`となり、
  `Number("")`は`0`を返すため、まだ数値を打ち直している途中で値が一瞬`0`に
  スナップする(UXの気持ち悪さ。データ破損には至らない)。4ファイルすべてで
  同じパターンが個別に書かれている。
- **修正方針**: `onChange`側で`e.target.value === ""`の場合は更新をスキップする
  (または簡易な`<NumberField>`ラッパーコンポーネントを1つ作り4箇所から使う)。
- **リスク**: 低。見た目の微修正であり、壊してはいけない機能一覧への影響は無い。
- **優先度**: 低

### L3. リネームの取り残し: `package.json`の`remotion:render`スクリプトが
   存在しないコンポジションID`"ShortVideo"`を参照している

- **対象ファイル**: `package.json`(11行目)、`src/app/api/upload/route.ts`(75行目、
  コメント)
- **現状のコード(引用)**:
  ```json
  "remotion:render": "remotion render ShortVideo out/short-video.mp4"
  ```
  現在登録されているコンポジションIDは`remotion/templates/registry.ts`の
  `compositionId: "Standard"`であり、`"ShortVideo"`というIDは存在しない
  (`remotion/Root.tsx`は`clientTemplateRegistry.standard.compositionId`を使う)。
  `src/app/api/upload/route.ts`にも同じ旧名を参照するコメント
  `// ShortVideoProps.clips[].src にそのまま入れられる相対パス`が残っている
  (現行の型名は`StandardVideoProps`)。テンプレートが以前`ShortVideo`という名前
  だった頃の名残と考えられる。
- **修正方針**: `package.json`の`remotion:render`スクリプトを
  `remotion render Standard out/short-video.mp4`に修正し、
  `upload/route.ts`のコメントを現行の型名`StandardVideoProps`に合わせて更新する。
- **リスク**: なし。`remotion:render`はCLIから手動実行するスクリプトで
  アプリの実行時経路には含まれないため、アプリの挙動には一切影響しない。
- **優先度**: 低(ただし修正コストがほぼゼロなので早期に着手して良い)

### L4. `/api/upload-audio`のみ`/api/upload`と異なりストリーミングでなく
   ファイル全体をメモリに載せている

- **対象ファイル**: `src/app/api/upload-audio/route.ts`
- **根拠**: `src/app/api/upload/route.ts`のコメント(15-19行目)は「Node(undici)の
  `formData()`実装はファイル全体を一度メモリ上のBlobに載せるため、メモリの少ない
  本番環境(Render無料プラン=512MB)で大きい動画のアップロード時にメモリ不足で
  クラッシュ/タイムアウトすることがあった」と明記し、そのためストリーミング書き込みに
  変更した経緯が読み取れる。一方`upload-audio/route.ts`は`request.formData()`と
  `file.arrayBuffer()`(全体をメモリに展開)のままである。
- **リスク評価**: 現状は音声の上限が20MB(動画の200MBより十分小さい)であり、
  01-requirements.md §5の非機能要件(アップロード上限は現状の値を変更しない)にも
  合致するため、**今回は実害が小さいと判断し、修正は見送る**。ただし将来
  音声の上限を引き上げる際は、動画アップロードと同じ非対称性の問題が顕在化するため、
  そのタイミングで見直すべき点として記録しておく。
- **優先度**: 低(記録のみ。今回のS3スコープでは変更しない)

## 5. 現状維持が妥当と判断した領域

以下は実際にコードを読んだ上で、変更の必要が無いか、変更のコストがメリットに見合わないと
判断した領域。改善点の水増しを避けるため、判断根拠とともに明記する。

- **ジョブストア3種の共通化(`transcribeJobs.ts`/`extractStyleJobs.ts`/`renderJobs.ts`)**:
  02-architecture.md §2の結論(型が異なるため無理な共通化は型安全性を下げる)に同意する。
  M1で外側のAPIハンドラ・クライアントフックのみを共通化する方針とし、ジョブストア自体は
  現状維持。
- **物理的なディレクトリ・ファイル構成全般**: 02-architecture.mdの結論を踏襲。今回の
  通読でも、`src/lib`配下のドメイン分割(`gemini/`・`remotion/`・`googleMaps/`)は
  実装と一致しており、変更の必要は無い。
- **Remotion描画コンポーネント群**
  (`remotion/templates/standard/ClipSequence.tsx`・`StandardVideo.tsx`、
  `remotion/shared/MediaBackground.tsx`・`AnimatedCaption.tsx`・
  `captionAnimations.ts`・`font.ts`・`Hook.tsx`・`CTA.tsx`): 全ファイルを読んだが、
  バグ・型不整合・重複は見つからなかった。フォントの遅延読み込み・キャッシュ、
  アニメーションごとのspring設定など、既に丁寧に作り込まれている。
- **`googleMaps/places.ts`、`/api/insights/**`、`InsightsExplorer.tsx`**:
  01-requirements.md §2の通り動画編集機能と独立したドメインであり、実装も
  zodによる応答検証・エラーハンドリングが一貫していて改善点は見つからなかった。
- **タイムラインの基盤ユーティリティ**
  (`src/components/editor/timeline/pointerDrag.ts`・`timelineScale.ts`・
  `useClipThumbnails.ts`・`useAudioWaveform.ts`): Pointer Events・
  requestAnimationFrameによる間引き、共有video/canvas要素の使い回し、
  Web Audio APIのデコード結果キャッシュなど、パフォーマンスを意識した設計が
  既になされており改善点は見つからなかった(`timelineScale.ts`は§6でテスト対象
  候補として言及するのみで、実装変更は無い)。
- **Geminiレート制限(`rateLimiter.ts`)・エラー変換(`geminiErrors.ts`)・
  File API待機(`geminiFiles.ts`)**: シンプルかつ目的に対して過不足のない実装。

## 6. 自動テスト基盤導入の検討(01-requirements.md §7への回答)

01-requirements.md §7で申し送られた「影響範囲の小さい純粋関数へのユニットテスト導入が
現実的か」を検討した結論: **現実的であり、導入を推奨する。**

### 6.1 対象にする関数(いずれも副作用・DOM依存が無い、または`typeof window`ガード済み)

| ファイル | テスト対象 | 備考 |
|---|---|---|
| `src/components/editor/timelineUtils.ts` | `canMergeWithNext`/`mergeWithNext`/`canSplitSegment`/`splitSegment`/`findLargestGap`/`clipTranscribedToKeepRanges`/`clampTrimStart`/`clampTrimEnd` | 壊してはいけない機能一覧4.1(分割/トリム)・4.2(カット範囲への切り詰め)の中核ロジック。境界値(最小/最大尺、range境界をまたぐ場合)のテストが特に有効 |
| `src/components/editor/timeline/timelineScale.ts` | `clampPixelsPerSecond`/`secondsToPixels`/`pixelsToSeconds`/`pickRulerStepSeconds`/`formatTimecode` | 純粋な数値変換のみ |
| `remotion/templates/standard/duration.ts` | `getStandardVideoDurationInFrames` | hook/cta有無・端数フレームの丸めを確認 |
| `src/lib/gemini/textUtils.ts` | `truncateNaturally`/`graphemeLength` | 日本語の句読点区切り・サロゲートペア絡みの境界値 |
| `src/lib/videoProject.ts` | `parseProjectJson`経由での`normalizeProject`の後方互換動作、`buildStandardVideoProps` | 古い保存データ(フィールド欠落)の補完、`durationInSeconds`の0.3秒下限処理を確認 |

### 6.2 テストランナーの追加

自動テストが皆無(`package.json`にtestスクリプト無し、jest/vitest等の依存無し、
`*.test.*`ファイル無し)なため、新規導入が必要。**vitest**を推奨する(理由: ESM/TypeScript
strictとの親和性が高く設定が最小限、対象が上記の副作用の無いピュア関数のみで
Next.jsのビルド設定に触れる必要が無い、実行が高速)。

- 追加: `devDependencies`に`vitest`、`package.json`に`"test": "vitest run"`を追加。
- 対象範囲: 上表の5ファイルのみ。UIコンポーネント(React)・APIルート・Remotionの
  実際の描画・Gemini呼び出しはテスト対象に含めない(モック整備のコストが大きく、
  01-requirements.md §7の「影響範囲の小さい純粋関数に絞る」方針から外れるため)。
- 本番ビルド・デプロイ(`next build`/`next start`、Render Free運用)には一切影響しない
  (devDependency追加のみ)。01-requirements.md §5の非機能要件(ビルド構成維持)には抵触しない。

### 6.3 M2(Geminiリトライ共通化)との関係

§3 M2で述べた通り、Geminiリトライループの共通化は「壊してはいけない」再試行要件に
直接関わるため、抽出後の`callGeminiWithRetry`関数自体の単体テスト(フェイクタイマー+
モック関数で、リトライ回数・成功/失敗判定・タイムアウトの分岐を検証)を同時に用意できる
場合に限り着手する。テストを用意しない場合、M2は今回のスコープでは見送りを推奨する。

## 7. 実行順序の提案

対象範囲が画面・API・共有ロジックに広くまたがるため、S4(実装)は以下の順で
**小さい単位に分けて逐次実行**することを推奨する(一度に全部を1つの差分にしない)。

```
フェーズ1(即着手可・リスクほぼ無し)
  L3(package.json/コメントのリネーム取り残し修正)
    → フェーズ2(サーバー側の入力検証強化。クライアント変更を伴わないため独立して検証可能)
      H1(/api/media のパストラバーサル対策)
      H2(/api/render のsrc検証強化)
        → フェーズ3(テスト基盤導入。フェーズ4以降の土台)
          vitest導入 + §6.1の対象関数のテスト作成
            → フェーズ4(API層・クライアント層の重複排除。テスト基盤導入後の方が安心)
              M1(ジョブステータスAPI・ポーリングフックの共通化)
                → フェーズ5(編集画面の重複排除。対象範囲が最も広いため最後に)
                  M3 + M4(ClipEditor/CutEditorのUndo/Redo・選択・キーボード
                          ショートカット共通化。パフォーマンス改善も同時に)
                    → フェーズ6(任意・着手条件付き)
                      M5(ProjectSfxClipへのkindフィールド追加、後方互換込み)
                      M2(Geminiリトライ共通化。§6.3の単体テストとセットの場合のみ)
                      L2(数値入力のガード)
                      L4(記録のみ、今回は変更しない)
```

理由:

- フェーズ1・2はサーバー側完結で、クライアントの挙動を一切変えない(H1/H2はいずれも
  「不正な入力を弾く」方向の変更で、UIから生成される正規のリクエストは通り続ける)。
  最初に着手してレビューの見通しを立てやすくする。
- フェーズ3を先に済ませることで、フェーズ4・5(ロジックの抽出)を「テストで守られた
  純粋関数はそのまま、UIの配線だけを差し替える」形にしやすくなる(ただしフェーズ4・5の
  対象自体はReactの状態管理・イベント処理でありテスト対象外。あくまで安心材料)。
- フェーズ5(M3/M4)は変更行数・影響範囲が最も大きく、`/create/cut`と`/edit`の
  両方でキーボードショートカット全種+Undo/Redoの手動回帰確認が必要なため、
  他の変更と混ぜずに単独の差分として最後に行う。
- フェーズ6は「着手条件付き(M2)」「今回は変更しない(L4)」を含む、優先度の低い
  任意項目としてまとめて末尾に置く。

各フェーズ完了時に、01-requirements.md §4「壊してはいけない機能一覧」のうち
影響しうる項目(H1/H2→4.4、M1→4.2〜4.4、M3/M4→4.1・4.3、M5→4.3)を手動で
再確認してから次フェーズへ進むこと。
