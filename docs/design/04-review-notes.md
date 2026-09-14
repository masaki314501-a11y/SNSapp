# コードレビュー記録(S5)

作成: メインセッション(`code-reviewer`ペルソナを注入して実施)
対象コミット: 未コミットの作業ツリー差分(ブランチ `prototype/1`、S4実装分)
対象範囲: `remotion/shared/schema.ts`、`src/app/api/media/[...path]/route.ts`、
`src/app/api/upload/route.ts`、`package.json`(H1・H2・L3)、および新規テスト5本
(`src/components/editor/timelineUtils.test.ts`、
`src/components/editor/timeline/timelineScale.test.ts`、
`remotion/templates/standard/duration.test.ts`、`src/lib/gemini/textUtils.test.ts`、
`src/lib/videoProject.test.ts`)・`vitest.config.ts`。

## 0. レビュー方法

- `git diff -- remotion/shared/schema.ts "src/app/api/media/[...path]/route.ts" src/app/api/upload/route.ts package.json` で実差分を確認。
- `docs/design/03-implementation-plan.md` のH1・H2・L3の記述と実装を照合。
- 関連ファイル(`src/lib/uploadedVideo.ts`、`src/app/api/render/route.ts`、
  `remotion/templates/standard/schema.ts`、`src/components/editor/audioPresets.ts`、
  `src/app/api/upload-audio/route.ts`、`src/app/api/generate-voiceover/route.ts`、
  `src/lib/videoProject.ts`、テスト対象の実装本体4本)を通読し、パターンの過不足・
  テストの妥当性を確認。
- `npx vitest run` を実行し、新規テスト5本・計48件がすべて成功することを確認済み。

## 1. 総評

H1(パストラバーサル対策)・H2(`src`のパス形式検証)・L3(リネーム取り残し)は
いずれも `03-implementation-plan.md` に記載された修正方針通りに実装されており、
既存の正常系(Range対応配信、許可ディレクトリ判定、`/api/upload`系が生成する
実際のパス形式)を壊す変更は見当たらなかった。`01-requirements.md` の
「壊してはいけない機能一覧」に抵触する変更も無い。新規テストは実装の詳細に
べったり依存する無意味なアサーションではなく、境界値(トリムの最小尺、
range境界での吸収、フレーム丸め、サロゲートペア等)を実際に検証しており、
実装ロジックの裏付けとして機能している。

重大な指摘は無し。中程度の指摘が1件(H1/H2で新規導入したセキュリティ境界の
テストが無い)、軽微な指摘が2件。

## 2. 重大(Critical)

該当なし。

## 3. 中(Medium)

### M-1. H1/H2で新規導入した検証ロジック自体のテストが無い

- **対象ファイル**: `src/app/api/media/[...path]/route.ts`(`isTraversalSegment`、
  19行目)、`remotion/shared/schema.ts`(`MEDIA_SRC_PATTERN`、13-14行目)
- **問題**: フェーズ3で追加された自動テスト5本は、いずれも
  `03-implementation-plan.md` §6.1の対象リスト(トリム/分割ロジック・秒⇔px変換・
  フレーム尺・テキスト切り詰め・プロジェクト正規化)のみを対象にしており、
  同じくフェーズ2で追加された`isTraversalSegment`と`MEDIA_SRC_PATTERN`という、
  副作用の無い純粋な検証ロジック(まさに§6.1が「テスト導入が現実的」と判断した
  基準に合致する形)には1件もテストが無い。特に`MEDIA_SRC_PATTERN`は
  `remotion/shared/schema.ts`からexportされたただの正規表現であり、Reactにも
  Next.jsのリクエストコンテキストにも依存しないため、他の5本と全く同じ要領で
  ユニットテストできる。今回実際に手動で以下を確認したところロジック自体は
  正しかったが(`videos/{uuid}.{mp4,mov,webm,m4v}`、
  `audio/{uuid}.{mp3,wav,m4a,ogg,aac}`、`audio/generated/{uuid}.wav`、
  `audio/presets/sfx/{name}.mp3`をすべて許可し、`../`を含むパスやプロトコル付き
  URLは拒否する)、この確認が自動テストとして残っていないため、将来
  誰かが拡張子や許可パスパターンを追加した際に、意図せず正規表現の境界を
  壊してもCIでは検知できない。`isTraversalSegment`は現状route.ts内の非export
  ローカル関数のため直接テストするにはexportが必要になる。
- **提案**: 最低限`MEDIA_SRC_PATTERN`について、`remotion/shared/schema.test.ts`
  のようなファイルを追加し、(a)実際に生成される4パターンすべてが一致すること、
  (b)`../../etc/passwd`や`videos/../../secret.mp4`のようなトラバーサル文字列、
  (c)`http://`/`https://`で始まる外部URL、(d)空文字列、を拒否することを
  アサートする。`isTraversalSegment`も`export`してテストに含めるか、
  同等の境界値(`"."`、`".."`、`"..."`、`"a..b"`)をコメントとして
  `route.ts`側に残す。
- **重大度**: 中(現状のロジック自体にバグは無いため実害は今は無いが、
  セキュリティ境界であるため回帰検知が無いのはリスク)。

## 4. 軽微(Minor)

### L-1. `MEDIA_SRC_PATTERN`の`/i`(大文字小文字無視)フラグが実質無意味かつ検証意図と食い違う

- **対象ファイル**: `remotion/shared/schema.ts`14行目
- **問題**: パターン全体に`/i`が付いているため、ディレクトリ部分のリテラル
  (`videos/`、`audio/`、`generated/`、`presets/sfx/`)まで大文字小文字を
  区別せず通過する(例: `"VIDEOS/ab12-cd34.MP4"`がzodバリデーションを通る)。
  しかし実際に生成されるパスは`randomUUID()`・拡張子とも常に小文字
  (`upload/route.ts`・`upload-audio/route.ts`・`generate-voiceover/route.ts`
  いずれも`.toLowerCase()`または固定文字列)であり、`/api/media/[...path]/route.ts`
  側の`ALLOWED_DIRS`は大文字小文字を区別するSetなので、大文字混じりのパスは
  結局そちらで400になる。実害は無いが、「意図的に許可している」のか
  「単に付け忘れの緩さ」なのか読み手に伝わらず、コメントとも
  (「実際の生成パス全パターンのみを許可する」という意図)微妙に食い違う。
- **提案**: 拡張子部分だけ大文字小文字を許容したいなら
  拡張子の選択肢だけ`(?:mp4|MP4|...)`のように個別に書くか、素直に`/i`を外して
  完全に生成パスの実形式(すべて小文字)に一致させる。どちらでも実装上の
  影響は無いが、後者の方が「許可リストは実際に生成される形だけ」という
  コメントの意図に忠実。

### L-2. BGMプリセットが将来追加された場合、`bgmSchema`側の`MEDIA_SRC_PATTERN`が対応できない

- **対象ファイル**: `remotion/shared/schema.ts`14行目、
  `src/components/editor/audioPresets.ts`26行目
- **問題**: `MEDIA_SRC_PATTERN`は`presets/`配下として`presets/sfx/{name}.mp3`
  のみを許可している。`audioPresets.ts`の`BGM_PRESETS`は現時点で空配列だが、
  コメント上「適切な楽曲を選定中」であり、将来`audio/presets/bgm/{name}.mp3`
  のようなパスで収録される可能性が示唆されている。その場合、`bgmSchema.src`は
  `MEDIA_SRC_PATTERN`しか許容しないため、BGMプリセットを選ぶと書き出し時に
  即座にzod検証エラーになる。今回のスコープ(H2)としては現状の生成パスを
  過不足なくカバーできており問題ないが、後から気づきにくい形で踏み抜く
  可能性があるため記録しておく。
- **提案**: 今回は変更不要。`BGM_PRESETS`に実際にエントリを追加するタイミングで
  `MEDIA_SRC_PATTERN`に`presets/bgm/[0-9a-zA-Z_-]+\.mp3`相当を追記することを
  忘れないよう、`audioPresets.ts`側のコメントか`MEDIA_SRC_PATTERN`のJSDocに
  一言メモを残すと安全。

## 5. 確認して問題が無かった点(参考)

- **H1**: `isTraversalSegment`が`"."`/`".."`を明示的に拒否し、`SAFE_SEGMENT`
  (英数字・`_`・`.`・`-`のみ)と組み合わせることでbackslashやNULバイト等の
  経路混入も防げている。`stat()`後の`isFile()`チェック追加により、
  ディレクトリを指すパスが来た場合も404で正しく弾かれ、既存の
  `resolveUploadedVideo`(`src/lib/uploadedVideo.ts`)と同じパターンに揃っている。
  Rangeリクエスト対応部分(416判定、`Content-Range`/`Accept-Ranges`ヘッダ)は
  無変更で、`01-requirements.md` 4.4の要件に影響しない。
- **H2**: `MEDIA_SRC_PATTERN`は実際に`/api/upload`(`videos/{uuid}.{mp4,mov,webm,m4v}`)・
  `/api/upload-audio`(`audio/{uuid}.{mp3,wav,m4a,ogg,aac}`、拡張子集合も一致)・
  `/api/generate-voiceover`(`audio/generated/{uuid}.wav`)・
  `audioPresets.ts`の`SFX_PRESETS`(`audio/presets/sfx/{id}.mp3`、10件すべて)の
  すべてのパターンを過不足なく許可している。`hookSchema`/`ctaSchema`は
  `src`フィールドを持たないため、`mediaItemBaseSchema`・`sfxClipSchema`・
  `bgmSchema`の3箇所への適用で網羅できている。正規表現自体はネストした
  量指定子や後方参照を含まずReDoSのリスクは無い(線形時間で評価される)。
- **L3**: `remotion/templates/registry.ts`の`compositionId: "Standard"`と
  一致しており、`package.json`の`remotion:render`スクリプト修正は正しい。
  `upload/route.ts`のコメントも現行の型名`StandardVideoProps`
  (`remotion/templates/standard/schema.ts`)と一致している。
- **テストの質**: 5本・48件すべて`npx vitest run`で成功を確認。
  `clipTranscribedToKeepRanges`の「下限を下回ったクリップを隣接クリップに
  吸収する」ケースや`truncateNaturally`の区切り文字探索など、実装の分岐を
  実際になぞって手計算しても期待値と一致しており、アサーションは実装の
  リファクタリング耐性がある形(内部状態ではなく公開された戻り値のみを検証)
  になっている。`videoProject.test.ts`がテストで使う`bgm.src`
  (例: `"audio/bgm.mp3"`)は`MEDIA_SRC_PATTERN`の形式(UUID)とは一致しないが、
  `videoProject.ts`はzod検証を行わない型レベルの組み立て関数のみを
  テストしているため、このテスト自体に問題は無い(実際の形式検証は
  `/api/render`側の`template.schema.safeParse`で行われる、別レイヤー)。
- **壊してはいけない機能一覧との突合**: 4.1(アップロード拡張子/上限)・
  4.4(Range配信)への影響は無し。4.3(JSONエクスポート/インポート)についても、
  エクスポートされるJSONの`src`は常にアプリ自身が生成した形式のため、
  通常のエクスポート→インポート→書き出しの往復では`MEDIA_SRC_PATTERN`に
  拒否されるケースは無い(`03-implementation-plan.md`もリスク「中」として
  同じ結論)。

## 6. 指摘件数まとめ

| 重大度 | 件数 |
|---|---|
| 重大 | 0 |
| 中 | 1(M-1: H1/H2の新規検証ロジック自体のテスト不足) |
| 軽微 | 2(L-1: `/i`フラグの過剰な緩さ、L-2: BGMプリセット追加時の見落としリスク) |

## 7. 対応結果(S6)

| 指摘 | 対応 | 内容 |
|---|---|---|
| M-1 | **fixed** | `remotion/shared/schema.ts`の`isValidPathSegment`相当ロジックを`src/app/api/media/[...path]/route.ts`で`export`し(`isTraversalSegment`を`SAFE_SEGMENT`チェックと統合した`isValidPathSegment`に整理)、`route.test.ts`(11件)を追加。`MEDIA_SRC_PATTERN`にも`remotion/shared/schema.test.ts`(22件)を追加し、実際の生成パス全パターンの許可と、トラバーサル文字列・外部URL・大文字混じりパスの拒否をアサートした。 |
| L-1 | **fixed** | `MEDIA_SRC_PATTERN`から`/i`フラグを削除。実際の生成パスは常に小文字のため、大文字小文字を区別する形に統一した(レビュー提案の「後者」案を採用)。 |
| L-2 | **no_change_needed(記録のみ)** | `BGM_PRESETS`は現時点で空配列のため、今回のスコープでは`MEDIA_SRC_PATTERN`への追記は不要。`MEDIA_SRC_PATTERN`のJSDocコメントに、`BGM_PRESETS`収録時に`presets/bgm/...`パターンの追記が必要である旨を明記した(見落とし防止)。 |

修正後、`npx vitest run`(7ファイル・81件)・`npx tsc --noEmit`・`npx eslint .`・`npm run build`をすべて再実行し成功を確認。また稼働中のdevサーバー(`http://localhost:3000`、別セッションと共有)に対してH1(パストラバーサル拒否)・H2(不正な`src`の拒否、正規の`src`での書き出しジョブ起票)を再度curlで確認し、リファクタ後も同じ結果(正常系200、攻撃系400)であることを確認した。
