# SNSapp 再構築タスク — エージェント編成計画

作成者: agent-organizer（本セッションでは `general-purpose` にこのペルソナを注入して実行）
対象コミット: `d489138`（ブランチ `prototype/1`）

## 1. タスクの要約

SNSapp（縦型ショート動画の音声字幕自動生成・編集ツール。Next.js 16 App Router + React 19 +
TypeScript + Remotion 4 + Gemini API、DBなし・`localStorage` 状態管理、Render.com Free
プランで単一Node.jsプロセス運用）について、「新規作成のつもりで」計画・設計をゼロから
書き直し、既存コードには**大規模リライトをせず**改善を適用する。対象範囲はアプリ全体
(`/create` → `/create/cut` → `/create/style` → `/edit` → `/edit/export`、および `/insights`)。

確定済み方針（ユーザー確認済み、変更しない）:

- モノリシックな Next.js アプリのまま。DBなし、Render Free、単一プロセス前提のインメモリ
  ジョブストア（`transcribeJobs.ts` / `extractStyleJobs.ts` / `renderJobs.ts`）は維持する。
- **マイクロサービス化はしない。** ただし将来分割したくなった場合に移行しやすいよう、
  モジュール境界・疎結合を意識した設計にする（動作に影響が出ない範囲で）。
- 動いている機能を壊さない。実装は「既存コードへの改善差分」であり、フルリライトではない。

成果物: 要件定義書、アーキテクチャ設計書、実装差分方針書、レビュー結果、テスト計画。
すべて `docs/design/` 配下に置く（ファイル名は §5 参照）。既存の `docs/README.md` /
`architecture.md` / `api-reference.md` / `glossary.md` は土台として参照し、変更があれば
最終工程で追従更新する。

## 2. 運用上の重要な注記（実行前に必ず読むこと）

**カスタムエージェント名は `subagent_type` として直接呼び出せない。**
`Agent` ツールが現在のセッションで受け付ける `subagent_type` は組み込みの
`claude` / `claude-code-guide` / `Explore` / `general-purpose` / `Plan` /
`statusline-setup` のみで、`agent-organizer` / `fullstack-developer` /
`microservices-architect` / `code-reviewer` / `qa-expert` という名前は認識されない
（実際に `Glob` で `C:\Users\81903\.claude\agents\*.md` を確認し、5ファイルの存在は
確認済みだが、これらは登録済み `subagent_type` の一覧には出てこない）。

したがって本計画の各サブタスクを実行する際は、次の手順を取る:

1. 該当エージェント定義ファイル（例: `C:\Users\81903\.claude\agents\fullstack-developer.md`）
   を `Read` で読み込む。
2. その本文（frontmatterのペルソナ・チェックリスト・ワークフロー記述）を、呼び出す
   `Agent` の `prompt` 冒頭に「あなたはこのペルソナに従うこと」として丸ごと注入する。
3. `subagent_type` には `general-purpose` を指定する（`Explore`・`Plan` は書き込み系
   ツールが使えないため実装・レビュー・修正タスクには不可）。
4. 各定義ファイルにある「Communication Protocol」節の JSON（`requesting_agent` /
   `context_manager` 宛のクエリ）は、実際には存在しない外部サービスへの呼び出しなので
   **無視してよい**。文中の「Query context manager」は「本計画書と前工程の成果物ファイルを
   読むこと」に読み替える。
5. エージェント間の情報伝達は本物のメッセージバスではなく、**共有ファイル**
   （`docs/design/` 配下の各成果物）経由で行う。次工程の担当は前工程が書いたファイルを
   `Read` してから着手する。

## 3. サブタスク分解

| # | サブタスク | 目的 / 完了基準 | 依存 |
|---|---|---|---|
| S1 | 現状把握・要件定義 | 既存 `docs/` とコード実体を突き合わせ、対象範囲全体（/create〜/edit/export、/insights）の要件を再言語化。非機能要件（Render Free運用、DBなし、単一プロセス制約、壊してはいけない既存機能一覧）を明記。完了基準: `01-requirements.md` に主要ユーザーフロー・制約・非機能要件が漏れなく列挙されている | なし（起点） |
| S2 | アーキテクチャ設計 | S1を受け、モジュール境界・データフロー（`VideoProject`、ジョブ+ポーリング、ファイル配信）を「新規設計」として書き直す。将来マイクロサービス化する場合の分割候補（例: ジョブ実行系、メディア変換系、Gemini呼び出し系を独立モジュール/将来的な別サービス候補として境界だけ明示）を追記。完了基準: `02-architecture.md` に画面/モジュール構成図、境界線、将来分割候補が明記され、既存 `docs/architecture.md` と矛盾しない（変える場合は差分を明示） | S1 |
| S3 | 実装差分方針の設計 | S2の設計と現行コードの差分を洗い出し、「どのファイルに何を、なぜ変えるか」を列挙した実装計画を作る（大規模リライトはしない前提の粒度）。完了基準: `03-implementation-plan.md` に変更対象ファイル・変更内容・優先順位・リスクが列挙されている | S2 |
| S4 | 実装（改善適用） | S3の計画に従い、既存コードへ実際に差分を適用する。既存の動作するテスト・機能を壊さない。完了基準: S3に列挙された変更が反映され、`npm run build` 等が通る状態 | S3 |
| S5 | コードレビュー | S4の差分をレビューし、正確性・セキュリティ・保守性・S2で定めたモジュール境界が守られているかを検証する。完了基準: `04-review-notes.md` に指摘事項（重大度別）と対応状況が記録されている | S4 |
| S6 | 修正反映 | S5の指摘のうち対応が必要なものを実装に反映する。完了基準: `04-review-notes.md` の各指摘に対応結果（fixed/skipped/no_change_needed）が追記される | S5 |
| S7 | テスト計画・実施 | 対象範囲（/create〜/edit/export、/insights）のテスト計画を作成し、可能な範囲で実施する（既存にDBなし・E2Eフレームワーク未整備の前提を踏まえ、実行可能な範囲を明記した上で計画とマニュアル確認項目を優先）。完了基準: `05-test-plan.md` にテスト観点・実施結果・既知の未検証範囲が記録されている | S6 |
| S8 | ドキュメント追従更新 | S2〜S7の内容を踏まえ、既存 `docs/README.md` / `architecture.md` / `api-reference.md` / `glossary.md` に実態との差分があれば更新する。完了基準: 各docsファイルが実装後の実態と一致している | S6, S7 |

リスク・不確実点:

- S7（テスト実施）は、このリポジトリに自動E2E基盤が整備されているか未確認。整備されて
  いない場合、qa-expert は「テスト計画の作成」までを主成果とし、実施は手動確認手順書の
  形にとどめる可能性がある。S1完了時点で自動テストの有無を確認し、S7担当への申し送りとして
  `01-requirements.md` に明記すること。
- S2で「将来のマイクロサービス化に備えた境界」を検討する際、microservices-architect の
  定義は Kubernetes/Istio/Kafka 等の本格分散システムを前提にしており、今回の方針（分割しない）
  とはズレがある。そのため S2 では同エージェントを**限定利用**とし、「サービス分割・K8s設計」
  ではなく「モジュール境界のレビュー観点の提供」のみを依頼する（詳細は §4 参照）。
- S4「実装」は対象範囲が広い（5画面 + insights）。一度に `fullstack-developer` へ丸投げする
  と差分が肥大化しレビューしづらくなるため、S3の実装計画で変更を優先順位付けし、必要なら
  S4を複数回（画面/モジュール単位）に分けて実行することを推奨する。

## 4. エージェント割り当て

読み込んだ5つの定義ファイル（`C:\Users\81903\.claude\agents\*.md`）のうち、実際の担当は
以下の通り。根拠は各定義ファイルの記述を引用する。

| サブタスク | 担当エージェント | 根拠（定義ファイルの記述） |
|---|---|---|
| S1 要件定義 | **agent-organizer**（本計画作成の延長として、または呼び出し元セッションが直接実施） | 定義に専用の「要件定義」担当エージェントは存在しない。agent-organizerの役割（タスク分解・現状整理）がもっとも近いが、本来は要件定義専任ではないため、実質は**呼び出し元（メインセッション）が直接読み書きして作成する**のが妥当。ギャップとして明記する。 |
| S2 アーキテクチャ設計 | **fullstack-developer**（主）+ **microservices-architect**（限定利用・助言のみ） | fullstack-developer定義: "Architecture Planning"節に「Data model design」「API contract定義」「Scalability considerations」があり、DBなし・単一プロセスの本アプリの全体設計に対応可能。microservices-architectは"Domain Analysis"節の「Bounded context mapping」「Service boundary」の考え方のみを、K8s/Istio/Kafka等の実装提案を除外して助言的に使う。 |
| S3 実装差分方針 | **fullstack-developer** | 同定義の "Implementation Workflow > 1. Architecture Planning" から "2. Integrated Development" への橋渡しが担当領域と一致（データ層〜UI層を横断する差分設計）。 |
| S4 実装 | **fullstack-developer** | 定義の主目的「build complete features spanning database, API, and frontend layers together as a cohesive unit」。本アプリはDB層はないが API Route Handlers〜React UIの横断実装という点で該当。`tools: Read, Write, Edit, Bash, Glob, Grep` を保持しコード変更が可能。 |
| S5 コードレビュー | **code-reviewer** | 定義そのものが「comprehensive code reviews focusing on code quality, security vulnerabilities, and best practices」。"Security review" "Performance analysis" "Design patterns(SOLID/DRY)" のチェックリストがS2で定めたモジュール境界の遵守確認にも使える。 |
| S6 修正反映 | **fullstack-developer** | S5の指摘を実装に戻す作業のため、実装担当と同一エージェントが担当するのが自然（`Edit`/`Write`権限を持つ）。 |
| S7 テスト計画・実施 | **qa-expert** | 定義の主目的「comprehensive quality assurance strategy, test planning across the entire development cycle」。ただし `tools: Read, Grep, Glob, Bash` のみで `Write` が無いため、`05-test-plan.md` 自体を書き出すには呼び出し時にWrite権限を追加するか、メインセッションが清書する運用注記が必要（下記「ギャップ」参照）。 |
| S8 ドキュメント追従更新 | **fullstack-developer** | 実装内容を最も把握している担当が更新するのが整合性を保ちやすい。定義内 "Documentation creation" が該当。 |

### ギャップ（無理に割り当てず明記する）

- **要件定義（S1）専任のエージェントは存在しない。** 5エージェント中、要件定義書の作成を
  主目的とするものはない。agent-organizerはタスク分解が専門でありゴール自体の要件定義は
  範囲外。**推奨: メインセッション（呼び出し元）が既存 `docs/` とコードを読み、要件定義書の
  ドラフトを作成し、必要ならfullstack-developerにレビューさせる。**
- **qa-expertに`Write`ツールがない。** 定義ファイル1行目 `tools: Read, Grep, Glob, Bash` の
  通り、ファイル作成権限を持たない。テスト計画書 `05-test-plan.md` を実際に書き出すには、
  (a) 呼び出し時にペルソナ注入と合わせて`Write`を使えるようにする、または (b) qa-expertには
  テスト観点の洗い出し・実施結果の报告のみをさせ、メインセッションがファイルに清書する、
  のいずれかを選ぶ必要がある。**推奨は(b)**（定義の意図（Read/Grep/Glob/Bashのみ＝分析役）を
  尊重する）。
- **microservices-architectは本タスクの大部分に不適合。** Kubernetes・Istio・Kafka・
  サービスメッシュ等、単一Node.jsプロセス+Render Freeという制約と正反対の前提を持つ。
  S2でのみ「モジュール境界を考える視点の提供」に限定利用する。それ以外のサブタスクには
  割り当てない。

## 5. 成果物ファイル一覧（`docs/design/` 配下）

| ファイル | 内容 | 作成/更新するサブタスク |
|---|---|---|
| `docs/design/00-agent-plan.md` | 本計画書 | (本タスク) |
| `docs/design/01-requirements.md` | 要件定義書（対象範囲・非機能要件・壊してはいけない既存機能一覧・自動テスト有無の確認結果） | S1 |
| `docs/design/02-architecture.md` | アーキテクチャ設計書（モジュール境界図、データフロー、将来のマイクロサービス化に備えた分割候補と現時点で分割しない理由） | S2 |
| `docs/design/03-implementation-plan.md` | 実装差分方針（変更対象ファイル・変更内容・優先順位・リスク） | S3 |
| `docs/design/04-review-notes.md` | レビュー結果（指摘事項・重大度・対応状況） | S5, S6 |
| `docs/design/05-test-plan.md` | テスト計画・実施結果・未検証範囲 | S7 |

既存 `docs/README.md` / `docs/architecture.md` / `docs/api-reference.md` / `docs/glossary.md`
は S8 で実態と差分があれば直接更新する（新規ファイルは作らない）。

## 6. 実行順序

```
S1(要件定義)
  → S2(アーキテクチャ設計。microservices-architectは限定利用でS2内にのみ関与)
    → S3(実装差分方針)
      → S4(実装)
        → S5(コードレビュー)
          → S6(修正反映)
            → S7(テスト計画・実施)  ※S6完了後
              → S8(ドキュメント追従更新)  ※S6・S7の内容を両方踏まえる
```

すべて直列。理由: 各工程が前工程の成果物ファイルを読んで着手する設計（本物のエージェント間
通信が無く、ファイル経由の受け渡しのみのため）であり、対象範囲が単一アプリの一貫した
編集フロー（/create〜/edit/export）であるため並列化してもレビュー観点が分散するだけで
効率化しない。ただしS4（実装）内部は、S3で画面/モジュール単位に優先順位付けされていれば、
「/create〜/create/style系」「/edit〜/edit/export系」「/insights」のように**サブ単位で
逐次実行**することを推奨する（並列Agent呼び出しではなく、同じfullstack-developerペルソナを
差分の小さい単位で繰り返し呼ぶ、という意味）。

## 7. ハンドオフポイント（共有ファイル）

- S1 → S2: `01-requirements.md` を読んでからアーキテクチャ設計に着手。
- S2 → S3: `02-architecture.md` の境界定義を読んでから実装差分を洗い出す。
- S3 → S4: `03-implementation-plan.md` の変更リストに従って実装。計画にない変更を追加する
  場合は`03-implementation-plan.md`を先に更新してから実装する。
- S4 → S5: 実装差分（`git diff`）と`03-implementation-plan.md`を突き合わせてレビュー。
- S5 → S6: `04-review-notes.md` の指摘一覧を読んで対応し、対応結果を同ファイルに追記。
- S6 → S7: 修正後のコードとS1の「壊してはいけない既存機能一覧」を突き合わせてテスト計画を
  実施。
- S6, S7 → S8: 実装最終版とテスト結果を踏まえ、既存docsとの差分を更新。

## 8. 参照した既存資料

- `docs/README.md`（docs/ の役割分担、修正依頼の出し方）
- `docs/architecture.md`（画面遷移、`VideoProject`共有状態、ジョブ+ポーリングパターン、
  ファイル配信の注意点、Render Free運用前提・単一プロセス制約）
- `C:\Users\81903\.claude\agents\agent-organizer.md`
- `C:\Users\81903\.claude\agents\fullstack-developer.md`
- `C:\Users\81903\.claude\agents\microservices-architect.md`
- `C:\Users\81903\.claude\agents\code-reviewer.md`
- `C:\Users\81903\.claude\agents\qa-expert.md`

## 9. 実行結果(全工程完了後の記録)

S1〜S8を通し完了した。各工程の成果物は§5の表の通り。実装(S4)の範囲は、
[03-implementation-plan.md](./03-implementation-plan.md)で見つかった11件の改善点のうち
**優先度「高」の2件(H1・H2)と「低」のL3、およびテスト基盤導入(フェーズ1〜3)のみ**に
絞った。中優先度以降(M1〜M5、L2、L4)は、自動テスト・ブラウザでのUI確認が伴わないと
リスクが上がる変更(既存の`ClipEditor`/`CutEditor`の重複排除、ジョブAPI/ポーリングフックの
共通化等)のため、今回のスコープでは実装を見送り、`03-implementation-plan.md`に
「今後の課題」として残した(ユーザーが選んだ深さの方針「計画・設計をゼロから書き直す」
「実装は既存動作を壊さない範囲」に合わせた判断)。

- **S1〜S3(計画)**: `01-requirements.md`・`02-architecture.md`・`03-implementation-plan.md`。
  02の結論は「モノリシック維持、物理構造は変更しない」。03は「11件中、実装したのは高2件・
  低1件のみ」。
- **S4(実装)**: H1(`/api/media`のパストラバーサル対策)・H2(`/api/render`の`src`検証強化)・
  L3(リネーム取り残し修正)、vitest導入。`npx tsc --noEmit`・`npx eslint .`・`npm run build`
  すべて成功。
- **S5(レビュー)**: 重大0件・中1件(M-1: 新規検証ロジック自体のテスト不足)・軽微2件。
- **S6(修正反映)**: M-1・L-1を修正(`isValidPathSegment`のexport+テスト追加、
  `MEDIA_SRC_PATTERN`のテスト追加、`/i`フラグ削除)。L-2は記録のみ。最終的に
  vitestは7ファイル・81件全て成功。
- **S7(テスト)**: API層の手動確認(curl)でH1・H2の正常系/攻撃パターンを実際に検証。
  ブラウザでのE2E確認は実行環境の制約(`chromium-cli`未導入)により未実施、
  書き出しジョブの完走確認は他セッションとのポート競合により未実施(いずれも
  `05-test-plan.md`に理由と共に記録)。
- **S8(ドキュメント追従更新)**: `docs/architecture.md`(パス検証の多層防御を追記)、
  `docs/api-reference.md`(`/api/render`・`/api/media`の検証内容を追記)を更新。

### 運用注記(microservices-architectの実際の使われ方)

計画通り、02-architecture.mdの§4「将来マイクロサービス化する場合の分割候補」でのみ
限定利用した。Kubernetes/Istio/Kafka等の提案は行わず、「継ぎ目の言語化」に徹した。
実際の実装(S4)ではマイクロサービス化に関する変更は一切行っていない
(ユーザー確認済み方針「モノリシックのまま、拡張性は意識のみ」に合致)。
