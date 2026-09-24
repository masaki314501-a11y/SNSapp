# SNSapp 外部サービス・ライブラリ・アセットの現状確認(無料枠/料金/ライセンス/商標)

- 調査日: 2026-09-25
- 調査目的: システム説明ページに載せるため、現在使用中の外部サービス・ライブラリ・アセットについて、無料枠/料金/レート制限/ライセンス/商標条件を一次情報で確認する(新規導入検討ではなく現状確認)
- 判定基準: 各項目について「結論(平易な説明)/ 根拠URL / 確認日 / 未確認点」を一次情報(公式ドキュメント・料金ページ・ライセンス/規約ページ)で示す。一次情報で確認できない場合は「未確認」と明記し、推測で埋めない。

## 結論(要約)

- Gemini API・Google Maps Places API (New) は、**現状の使い方(モデル・フィールド)では無料枠の範囲外**であり、課金アカウントを結び付けた有料利用(Gemini APIはプリペイド、Places APIは従量課金)が前提になっている。これはREADME/.env.local.exampleにも明記されており、AGENTS.mdの「常に無料利用枠の範囲内で動作する」という制約とは既に矛盾した状態で運用されている(既知の例外として記載されているが、Places API側は現状「無料枠内」という説明は無く要確認)。
- Remotion・Render.com・フォント・効果音・Next.js等のOSSライブラリは、**現在の使い方であれば無料条件を満たしている**と一次情報で確認できた。ただしRender Freeプランの制約(メモリ512MB・スリープ・750時間/月)は既にREADMEにも記載の通り実運用上の制約になっている。
- Gemini APIの `-latest` エイリアス(`gemini-pro-latest`)は、2026年3月6日時点で無料枠が一切無い**プレビュー版モデル(Gemini 3.1 Pro Preview)** を指すようになっており、今後もエイリアス先が予告なく変わる(過去にGemini 3 Pro Previewが2026年3月9日に廃止された例あり)。無料枠がある/なしを固定の事実として説明することはできない。

---

## 1. Gemini API(Gemini Developer API / Google AI Studio)

### 1-1. モデルと `-latest` エイリアスの指し先

**結論**: `gemini-flash-latest` や `gemini-pro-latest` のような `-latest` は「特定のモデル系統の最新リリースを指すエイリアス」で、Googleが新しいモデルを出すたびに指し先が入れ替わる(安定版とは限らず、プレビュー版に切り替わることもある)。2026年3月6日、`gemini-pro-latest` は「Gemini 3.1 Pro Preview」(`gemini-3.1-pro-preview`)を指すよう切り替えられた。このモデルには**無料枠が存在しない**(有料アカウントでしか呼べない)。旧`gemini-3-pro-preview` は2026年3月9日に廃止(shutdown)されている。`gemini-flash-latest` は最新のFlash系(2026年9月時点でGemini 3.8 Flash)を指すとみられ、Gemini 3.8 Flashは無料枠が「Standard modeで無償」と明記されている。

- 根拠URL:
  - https://ai.google.dev/gemini-api/docs/models(latestエイリアスの説明)/ 確認日 2026-09-25
  - https://discuss.ai.google.dev/t/migrate-from-gemini-3-pro-preview-to-gemini-3-1-pro-preview-before-march-9-2026/127062(2026-03-06に`gemini-pro-latest`をGemini 3.1 Pro Previewへ切替、旧モデルは2026-03-09廃止)/ 確認日 2026-09-25
  - https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview(Status: Preview)/ 確認日 2026-09-25
  - https://ai.google.dev/gemini-api/docs/pricing(Gemini 3.1 Pro Preview: Free Tier "Not available"。Gemini 3.8 Flash: Free Tier "Free of charge")/ 確認日 2026-09-25
- 未確認点: `gemini-flash-latest` が2026-09-25時点で正確にどのモデルID(Gemini 3.8 Flashそのものか、それ以降の版か)を指しているかは、公式ページで明示的に確認できなかった(エイリアスの仕組み上、確認した時点でも将来変わりうる)。

### 1-2. 各モデルの無料枠・Tier 1の料金・プリペイドの仕組み

**結論**: Gemini APIには「Free tier(無料)」「Tier 1〜3(課金アカウント連携で自動昇格)」がある。Tier 1になるには「有効な課金アカウント(Cloud Billing account)をリンクする」ことが条件で、Tier 1では最低$5相当のプリペイド残高が必要。Google AI Studioの「プリペイド」機能は実在し、事前に購入したクレジット残高からほぼリアルタイムで差し引かれる仕組み(自動チャージはオプトインでオフにできる)。プロジェクト単位で「Monthly spend cap(月間支出上限)」を設定でき、Tier自体にも上限(Tier 1は$250/月)がある。README記載の「プリペイド(上限800円)」は、この最低$5のプリペイド購入+スペンドキャップ設定に相当すると考えられる(金額の対応関係そのものは今回一次情報では確認できていない)。

- 根拠URL:
  - https://ai.google.dev/gemini-api/docs/billing(課金設定手順、Tier 1条件、プリペイド残高、月間スペンドキャップ、Tier別上限)/ 確認日 2026-09-25
  - https://ai.google.dev/gemini-api/docs/rate-limits(Free tierとTier1の違い、Tier1昇格条件、spend-based rate limit)/ 確認日 2026-09-25
- 未確認点:
  - 「上限800円」という具体的な金額とAI Studioの「Monthly spend cap」設定値との対応関係(円建てかドル建てかも含め)は一次情報で未確認。
  - モデルごとのRPM/TPM/RPDの具体的な数値。現在の公式ドキュメントには固定の数値表が無く、"View your active rate limits in AI Studio"(https://aistudio.google.com/rate-limit、要ログイン)でアカウントごとに確認する方式になっている。ネット上のブログには具体的数値(例: TTS 15RPD等)が出回っているが、いずれも二次情報であり、更新頻度も不明なため未確認とする。

### 1-3. TTSモデル(`gemini-3.8-flash-tts` / 旧 `gemini-2.5-flash-preview-tts`)

**結論**: `gemini-3.8-flash-tts` は**正式版(GA、"New Stable")**であり、プレビュー版ではない。無料枠は「Standard tierで無償」。有料Tierの料金は2026年12月31日まで 入力$0.50/出力$9.00(100万トークンあたり)。`gemini-2.5-flash-preview-tts` は名称通り**プレビュー版**で、無料枠ありだが有料Tier料金は入力$0.50/出力$10.00。

- 根拠URL:
  - https://ai.google.dev/gemini-api/docs/pricing(両モデルの料金・Free tier表記)/ 確認日 2026-09-25
  - https://ai.google.dev/gemini-api/docs/models(gemini-3.8-flash-ttsが"New Stable"と明記)/ 確認日 2026-09-25
  - https://ai.google.dev/gemini-api/docs/speech-generation(prebuilt voice一覧にKore/Puck/Charon/Aoede/Fenrirなど実在、responseModalities AUDIOの使い方)/ 確認日 2026-09-25
- 未確認点: TTSモデル固有のRPM/RPD数値(1-2と同じ理由で未確認)。プレビュー版(`gemini-2.5-flash-preview-tts`)が将来いつ廃止されるかの予告は今回の調査範囲では見つからず。

### 1-4. 使用機能(responseSchema / mediaResolution / responseModalities AUDIO / prebuiltVoiceConfig)の技術的実現可能性

**結論**: いずれも公式ドキュメントに存在する正規機能。`mediaResolution` はGemini 3系モデル限定の機能で、`low`(280px相当)/`high`(画像1120px・動画280px相当)などのレベルがあり、コスト・レイテンシとのトレードオフとして公式に説明されている。prebuiltVoiceConfigの声(Kore, Puck, Charon, Aoede, Fenrir, Leda)はすべて公式voice一覧に実在する。

- 根拠URL:
  - https://ai.google.dev/gemini-api/docs/media-resolution / 確認日 2026-09-25
  - https://ai.google.dev/gemini-api/docs/speech-generation / 確認日 2026-09-25
- 未確認点: なし(機能存在は確認済み。個別のコスト影響は1-2の未確認点に準じる)

### 1-5. 無料枠でのデータ学習利用・生成物の利用条件・"Gemini"名称表示

**結論**:
- **Unpaid Services(無料枠)**: Googleはユーザーが送信した内容と生成結果を「製品の提供・改善・開発」に使用する。機密情報の送信は避けるよう明記されている。
- **Paid Services(有料枠)**: 改善目的には使用されない。ただし違反検知・防止のため一定期間ログを保持する。
- 「Paid Service」の定義は**サービスごとに異なる**: Google AI Studio自体は「課金アカウントがリンクされたCloud Projectを使っている限り、無料機能を使っていても常にPaid Service」。一方 **Gemini API は「課金アカウントに紐づいたCloud Projectを通してアクセスした場合にのみPaid Service」**。→ SNSappはGEMINI_API_KEYを課金(Tier 1)アカウントで運用しているため、Gemini APIの呼び出しはPaid Service扱いになり、学習に使われない区分に該当すると考えられる。
- 生成物(Outputs)の所有権はユーザーに残り、Googleは所有権を主張しない。ただし生成物の利用にあたっては適用法令の遵守が必要。
- "Gemini"の名称は、ロゴを使わず・提携関係を示唆せず・自社製品名に組み込まない形であれば、形容詞的に言及すること自体は一般的なGoogle商標ガイドライン上許容される(例:「Geminiを使って〜する」という説明文はOK、"〇〇 Gemini"のような自社ブランドへの組み込みはNG)。

- 根拠URL:
  - https://ai.google.dev/gemini-api/terms(Unpaid/Paid Servicesの定義、データ利用、生成物の扱い)/ 確認日 2026-09-25
  - https://partnermarketinghub.withgoogle.com/brands/google/trademarks-and-terms/trademark-guidelines-for-proper-usage/(商標の形容詞的使用ルール)/ 確認日 2026-09-25
- 未確認点: 「Gemini」固有の商標ガイドラインページ(Google全般の商標ガイドラインを援用した推定であり、Gemini専用の文書は今回見つからなかった)。また、AI生成コンテンツである旨の開示義務(SynthIDやウォーターマーク表示義務の有無)は今回未確認。

---

## 2. Gemini Files API

**結論**: ファイル保持期間は48時間で自動削除される。1ファイル最大2GB、プロジェクトあたり合計20GBまで。**料金は無料**(Gemini APIが利用可能な全リージョンで無償)。

- 根拠URL: https://ai.google.dev/gemini-api/docs/files / 確認日 2026-09-25
- 未確認点: なし

---

## 3. Google Maps Platform Places API (New)

### 3-1. SKU区分とフィールドの対応

**結論**: 現在のコードが要求しているフィールドの組み合わせは、**いずれも無料枠が非常に少ない高額SKU(Enterprise系)に該当する**。

- Text Search(`places.id`, `displayName`, `formattedAddress`, `rating`, `userRatingCount`):
  - `id`のみ: Text Search Essentials ID Only SKU
  - `displayName`, `formattedAddress`: Text Search **Pro** SKU
  - `rating`, `userRatingCount`: Text Search **Enterprise** SKU ← 混在時は最高位のSKUで一括課金される
- Place Details(`id`, `displayName`, `formattedAddress`, `rating`, `userRatingCount`, `googleMapsUri`, `reviews`):
  - `id`: Essentials IDs Only
  - `displayName`, `formattedAddress`: Essentials/Pro
  - `rating`, `userRatingCount`, `googleMapsUri`: **Enterprise** SKU
  - `reviews`: **Enterprise + Atmosphere** SKU ← 最高位

課金は「リクエストに含まれる最も高いSKUに統一される」ため、現状のフィールド指定では **Text Search Enterprise / Place Details Enterprise + Atmosphere** の単価がそのまま適用される。

- 根拠URL:
  - https://developers.google.com/maps/documentation/places/web-service/text-search(FieldMaskとSKUの対応)/ 確認日 2026-09-25
  - https://developers.google.com/maps/documentation/places/web-service/place-details(同上)/ 確認日 2026-09-25
  - https://developers.google.com/maps/documentation/places/web-service/usage-and-billing(「最も高いSKUで課金される」旨)/ 確認日 2026-09-25

### 3-2. 無料利用量・料金

**結論**: Places API (New) の**「月$200クレジット」は2025年2月28日で終了**しており、現行の仕組みはSKUごとに個別の「無料利用枠(Free Usage Cap)」が設定される方式に変わっている。具体的に確認できた値は以下の通り(1,000リクエストあたりの価格、料金表はUSD建て):

| SKU | 無料利用枠(月) | 価格(1,000件あたり、最初の層) |
| --- | --- | --- |
| Text Search Essentials(IDのみ) | Unlimited(無料) | $0 |
| Place Details Essentials | 10,000 | 超過分 $4.00〜 |
| Text Search Enterprise | **1,000** | $35.00 |
| Place Details Enterprise | **1,000** | $20.00 |
| Place Details Enterprise + Atmosphere | **1,000** | $25.00 |

つまり、現状の `rating`/`userRatingCount`/`reviews` を含むフィールド構成では、**月1,000リクエストを超えた瞬間から高額課金(1,000件$20〜$35)が発生する**。「無料枠の範囲内」という説明は現状のフィールド構成では成立しない。

- 根拠URL: https://developers.google.com/maps/billing-and-pricing/pricing(SKU別価格表、Free Usage Cap記載)/ 確認日 2026-09-25
- 未確認点: この価格表ページ自体の最終更新日はページ上に明記されておらず、今後変更される可能性がある。実際の呼び出し頻度・想定月間リクエスト数に基づく試算は行っていない(利用状況次第で無料枠1,000件に収まる可能性はある)。

### 3-3. 課金アカウントの要否・帰属表示・キャッシュ規約・商標表記

**結論**:
- 課金アカウント(クレジットカード登録を伴うCloud Billingの有効化)は**必須**。「Places APIを使うには各プロジェクトで課金を有効にし、APIキーまたはOAuthトークンを全リクエストに含める必要がある」と明記。
- 口コミ・写真の著者帰属表示(アバター・名前・プロフィールリンク)は**常に必須**(写真ギャラリー等スペースが限られる場合のみ簡略化可、ただし完全な帰属表示に別途アクセスできる必要あり)。
- Place IDはキャッシュ制限の例外で無期限保存可能だが、**reviews等の他データの具体的なキャッシュ保持可能日数は今回のドキュメントでは確認できなかった**(別ページ「Places API のポリシーとアトリビューション」を参照する必要がある旨の案内のみ)。
- 「Google Maps」というテキスト表記は大文字小文字を変更しない・改行しない・翻訳しないことが求められ、ロゴを使う場合は最小高さ16dp、コントラスト比4.5:1以上が必要。

- 根拠URL:
  - https://developers.google.com/maps/billing-and-pricing/pricing(課金必須の記載)/ 確認日 2026-09-25
  - https://developers.google.com/maps/documentation/places/web-service/policies(帰属表示要件、Place IDのキャッシュ例外、"Google Maps"表記ルール)/ 確認日 2026-09-25
- 未確認点:
  - reviewsフィールドで返却される口コミの最大件数(READMEは「API仕様上、最大5件まで」と記載しているが、今回参照したPlace Detailsページ本文には明記された記載を見つけられなかった。別ページ「Place Data Fields」を確認する必要がある)。
  - reviews等のキャッシュ保持可能日数の具体的な上限日数。
  - Google Maps Platform利用規約(cloud.google.com/maps-platform/terms)本文は内容が長く今回は全文確認できなかった(ページ取得がtruncateされた)。

---

## 4. Remotion 4.0.513(remotion, @remotion/player, web-renderer, renderer, bundler, cli, media, fonts, google-fonts, zod-types)

**結論**: Remotion Licenseは**独自ライセンス**(MITなどのOSSライセンスではない)。無料利用の対象は「個人(商用・非商用問わず)」「従業員3名以下の営利組織」「非営利組織」。合計人数(パートタイム・業務委託含む)が4名以上になると有料の Company License が必要。SNSappのように少人数で開発している前提なら無料条件に該当すると考えられる(実際の開発体制の人数はコード調査の範囲外のため、要件に当てはまるかはユーザー側の実態確認が必要)。`licenseKey: "free-license"` は `@remotion/web-renderer` において「Free Licenseの対象であることを自己申告する」正規の値で、常にテレメトリイベントが送信されるがレンダリングはブロックされない。ライセンス自体はRemotionのソフトウェア全体(パッケージを問わず)が対象と考えられ、`web-renderer`/`renderer`など特定パッケージを除外する記載は見当たらない。商標(ロゴ・名称表示義務)についての明記は今回確認した範囲内(ライセンスFAQ)には無かった。

- 根拠URL:
  - https://www.remotion.dev/docs/license/faq(無料条件の人数基準、法人化していても3名以下なら無料)/ 確認日 2026-09-25
  - https://raw.githubusercontent.com/remotion-dev/remotion/main/LICENSE.md(ライセンス全体が対象、4名以上でCompany License必須)/ 確認日 2026-09-25
  - https://www.remotion.dev/docs/licensing/(`licenseKey: "free-license"`の目的、テレメトリ送信の仕様)/ 確認日 2026-09-25
- 未確認点:
  - 現在のSNSapp開発チームの実際の人数構成(個人か、3名以下の組織か)。ライセンス条件に該当するかどうかはユーザー側で確認が必要。
  - Remotion名称・ロゴの表示義務の有無(ドキュメント上に明記された記載は見つからず)。
  - `licenseKey`を未設定または不正な値にした場合の具体的な挙動(コンソール警告の内容など)は、公式ドキュメントの該当箇所を今回のセッションでは特定できなかった(READMEの記載する挙動と矛盾する情報は見つかっていない)。

---

## 5. Render.com(Web Service, Docker, Freeプラン, Singapore)

**結論**: Render Freeプランの制約は概ねREADMEの記述と整合する一次情報が確認できた。

- CPU/メモリ: 0.1 CPU、512MB RAM(Render公式ブログ記事より。Render公式ドキュメント本体には具体的なCPU/RAM数値の明記箇所を今回のセッションでは直接引用できなかったため、この数値は二次情報の側面がある)
- 月間無料稼働時間: **750インスタンス時間/ワークスペース/月**。使い切ると翌月まで停止。
- スリープ(スピンダウン): 15分間リクエストが無いとスピンダウンし、次のリクエストで再起動(約1分)。
- 帯域幅: 無料枠には上限があり、超過分は課金対象になる(具体的な無料GB数は公式ドキュメント内で直接確認できず、二次情報では「5GB/月」との記載あり=未確認)。
- ディスクの永続化: Freeプランのウェブサービスは永続ストレージを持てない。
- Docker環境変数: Renderの環境変数(ダッシュボード/render.yamlで設定したもの)は**自動的にDockerビルド引数(build arguments)としても利用可能になる**。ただし「機密情報を含む値をビルド引数として参照しない」よう注意喚起がある(イメージに焼き込まれてしまうため)。

- 根拠URL:
  - https://render.com/docs/free(750時間/月、15分スピンダウン・約1分で復帰、帯域幅超過課金、ディスク非永続の記載)/ 確認日 2026-09-25
  - https://render.com/docs/docker(環境変数がDockerビルド引数として自動的に利用可能になる旨、機密情報の扱い注意)/ 確認日 2026-09-25
- 未確認点:
  - 0.1 CPU/512MB RAMという数値そのものの一次情報(公式ドキュメント本文)での明記箇所(README記載の「512MB」は本セッションでは検証できたとは言い切れず、コミュニティ記事由来の可能性が高い→再確認推奨)。
  - 無料帯域幅の具体的な上限GB数。
  - **重要**: 環境変数がビルド引数として「利用可能になる」だけであり、Dockerfile側で`ARG <変数名>`を宣言していないと実際にはビルドステージで参照されない。現在の`Dockerfile`(本調査で読み取った内容)には`ARG`宣言が無く、`render.yaml`にも`NEXT_PUBLIC_REMOTION_LICENSE_KEY`がenvVarsとして登録されていない。そのため、本番ビルドでは`NEXT_PUBLIC_REMOTION_LICENSE_KEY`がNext.jsのクライアントバンドルに埋め込まれない可能性が高く、README記載の「ブラウザのコンソールに警告が出る」という状態が本番で常時発生していると考えられる。この点は設計判断が必要なため、microservices-architectへの申し送り事項とする。

---

## 6. Dockerイメージ(node:22-bookworm-slim, chromium, fonts-liberation, chrome-headless-shell)

**結論**:
- `fonts-liberation`(Debian パッケージ)は **SIL Open Font License** でライセンスされている。
- Remotionが`npx remotion browser ensure`でダウンロードする`chrome-headless-shell`は、Chrome for Testing基盤で配布される実行バイナリで、**BSD-3-Clauseライセンス**(`LICENSE.headless_shell`同梱)。フル版のChrome for Testingバンドルには再配布を禁止する利用規約があるが、`chrome-headless-shell`単体はより緩やかなオープンソースライセンスとされている(二次情報=GitHub issue/PRのコメントが情報源であり、Googleの一次情報での明記は今回確認できていない)。

- 根拠URL:
  - https://sources.debian.org/copyright/license/fonts-liberation2/2.00.1-3/ 等(fonts-liberationのOFLライセンス)/ 確認日 2026-09-25(検索結果からの間接確認。Debianパッケージのcopyrightファイル本体は未直接取得)
- 未確認点:
  - `chrome-headless-shell`のライセンス(BSD-3-Clause)を明記したGoogle公式の一次情報(developer.chrome.com等)は今回のセッションでは直接確認できておらず、GitHub上の議論(二次情報寄り)に基づく。念のため`chrome-headless-shell`同梱の`LICENSE.headless_shell`ファイル自体を実機で確認することを推奨。
  - Debianの`chromium`パッケージ自体(起動はしないが依存ライブラリ供給元として同梱)のライセンス構成(Chromiumは複数ライセンスの集合体)は今回详细確認していない。

---

## 7. 同梱フォント15書体(public/fonts/、ライセンスファイル同梱なし)

**結論**: 15書体のうち **14書体はSIL Open Font License 1.1**、**Kosugi MaruのみApache License 2.0** であることを、Google Fonts配布元のGitHubリポジトリ(google/fonts、ライセンスの種類ごとに`ofl/`または`apache/`ディレクトリに分類されている)から直接確認した。

| フォント | ライセンス | 確認方法 |
| --- | --- | --- |
| Noto Sans JP | OFL 1.1 | OFL.txt本文で確認 |
| Noto Serif JP | OFL 1.1 | OFL.txt本文で確認 |
| M PLUS Rounded 1c | OFL(バージョン明記は今回未確認) | google/fontsの`ofl/`ディレクトリ配下に格納されていることを確認。M+ FONTS公式サイトも「SIL Open Font Licenseで公開」と明記 |
| Zen Maru Gothic | OFL 1.1 | OFL.txt本文で確認 |
| Zen Kaku Gothic New | OFL 1.1 | OFL.txt本文で確認 |
| Kosugi Maru | **Apache License 2.0**(OFLではない) | google/fontsの`apache/kosugimaru/LICENSE.txt`本文で確認 |
| Dela Gothic One | OFL 1.1 | OFL.txt本文で確認 |
| Yusei Magic | OFL 1.1 | OFL.txt本文で確認 |
| Potta One | OFL 1.1 | OFL.txt本文で確認 |
| Reggae One | OFL 1.1 | OFL.txt本文で確認 |
| RocknRoll One | OFL 1.1 | OFL.txt本文で確認 |
| Mochiy Pop One | OFL 1.1 | OFL.txt本文で確認 |
| Shippori Mincho | OFL 1.1 | OFL.txt本文で確認 |
| Yomogi | OFL 1.1 | OFL.txt本文で確認 |
| Kaisei Decol | OFL 1.1 | OFL.txt本文で確認 |

**再配布時のライセンス文同梱義務について**: OFL公式FAQによれば、「フォントがドキュメントに埋め込まれる場合、またはプログラムに同梱される場合(bundled within a program)に限り、OFLライセンス全文を同梱せずに配布できる例外がある」。ただし同FAQは「メタデータにOFLへのリンクを含めることは法的に十分だが、完全なライセンステキストの同梱を強く推奨する」とも述べている。**Apache License 2.0(Kosugi Maru)は、再配布時にライセンス全文とNOTICEファイル(存在する場合)の同梱が明示的に要求される**ライセンスであり、OFLより要件が厳格。

- 根拠URL:
  - https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/OFL.txt 他13フォント分の同様URL(各OFL.txt本文で"SIL OPEN FONT LICENSE Version 1.1"を確認)/ 確認日 2026-09-25
  - https://raw.githubusercontent.com/google/fonts/main/apache/kosugimaru/LICENSE.txt(Apache License Version 2.0であることを確認)/ 確認日 2026-09-25
  - https://openfontlicense.org/documents/OFL-FAQ.txt(プログラムへの同梱は例外規定、リンクのみでも法的に十分だが全文同梱推奨)/ 確認日 2026-09-25
  - https://mplusfonts.github.io/(M+ FONTSがSIL Open Font Licenseで公開されている旨)/ 確認日 2026-09-25
- 未確認点:
  - `openfontlicense.org`がSIL(SIL International)公式の後継サイトであるかどうかの一次情報での裏付け(旧`scripts.sil.org/OFL`からの移行先として広く言及されているが、今回のセッションではSIL自身の告知ページまでは辿れていない)。
  - Apache License 2.0(Kosugi Maru)に必要な「NOTICEファイル」が、google/fontsの当該フォント配布物に実際に存在するかどうか(未確認。存在する場合は同梱が必要)。
  - M PLUS Rounded 1c のOFLバージョン番号(1.0か1.1か)。

---

## 8. 効果音(Kenney「Interface Sounds」, CC0 1.0)

**結論**: プロジェクト同梱の`public/audio/presets/CREDITS.md`に記載の通り、KenneyがCC0 1.0 Universal(パブリックドメイン相当)で配布している「Interface Sounds」アセットであることを、Kenney公式サイトの当該アセットページで確認した。CC0のためクレジット表記は法的に不要。商用利用も問題ない。

- 根拠URL: https://kenney.nl/assets/interface-sounds(CC0ライセンス表記)/ 確認日 2026-09-25
- 未確認点: なし

---

## 9. next 16.3.1、react/react-dom 19.2.8、zod 4.4.3、tailwindcss 4、@google/genai 2.18.0

**結論**: いずれもOSSライセンスで、商用利用に問題は無い。

| ライブラリ | ライセンス | 確認方法 |
| --- | --- | --- |
| next | MIT | vercel/next.js リポジトリの`license.md`本文で確認 |
| react / react-dom | MIT | facebook/react リポジトリの`LICENSE`本文で確認 |
| tailwindcss | MIT | tailwindlabs/tailwindcss リポジトリの`LICENSE`本文で確認 |
| zod | MIT | colinhacks/zod リポジトリの`LICENSE`本文で確認 |
| @google/genai | Apache License 2.0 | googleapis/js-genai リポジトリの`LICENSE`本文で確認 |

商標については、Vercelの商標ガイドラインで「Vercelの商標(Next.jsを含むと思われる)を形容詞的に、提携を示唆しない形で言及すること」は一般に許容される一方、製品名やドメイン名への組み込みなど無断使用には事前許可が必要とされる。React(Meta)・Tailwind Labsもそれぞれ独自の商標ガイドラインを持ち、「自社ブランドを主役にしつつ、対象OSSの名称を形容詞的に添える」形が推奨されている(例: "ComponentStudio for Tailwind CSS"は可、"Tailwind Studio"のように主要ブランドに組み込むのは不可)。現行READMEの「This is a Next.js project bootstrapped with `create-next-app`」という定型文は、この種のガイドラインに沿った一般的な表現と考えられる。

- 根拠URL:
  - https://raw.githubusercontent.com/vercel/next.js/canary/license.md / 確認日 2026-09-25
  - https://raw.githubusercontent.com/facebook/react/main/LICENSE / 確認日 2026-09-25
  - https://raw.githubusercontent.com/tailwindlabs/tailwindcss/next/LICENSE / 確認日 2026-09-25
  - https://raw.githubusercontent.com/colinhacks/zod/main/LICENSE / 確認日 2026-09-25
  - https://raw.githubusercontent.com/googleapis/js-genai/main/LICENSE / 確認日 2026-09-25
  - https://vercel.com/legal/trademark-policy(Vercelの商標ガイドライン、形容詞的使用の可否)/ 確認日 2026-09-25(WebSearchによる要約引用。ページ本文の直接取得は未実施)
- 未確認点: React(Meta)・Tailwind Labs固有の商標ガイドライン文書は検索結果の要約に基づく確認であり、各社公式ページ本文を直接取得しての一次確認までは今回実施できていない。

---

## AGENTS.mdの制約(常に無料利用枠内で動作する)と照らして問題になりそうな点

1. **Gemini API(スタイル抽出・自動編集)**: 既定モデル`gemini-pro-latest`は現在プレビュー版(Gemini 3.1 Pro Preview)を指しており、**無料枠が一切無い**(有料Tier必須)。README/.env.local.exampleでは「プリペイド運用」として既に無料枠の制約から明示的に外れている状態。ページに掲載する際は「一部機能は有料APIを前提にしている」ことを明記する必要がある。
2. **Gemini TTS**: `gemini-3.8-flash-tts`自体は無料枠ありだが、README記載の「1日あたりの上限」等の具体的な数値は現在の公式ドキュメントには非公開(AI Studioの個別ダッシュボードでしか確認できない)。ページに具体的なRPM/RPD数値を載せる場合は「公式には非公開・変動しうる」旨の注記が必要。
3. **Google Maps Places API**: 現在のフィールド指定(`rating`, `userRatingCount`, `reviews`等)は無料枠が極めて少ない(月1,000件)Enterprise系SKUに該当し、超過すれば1,000件あたり$20〜$35という高額課金が発生する。「無料枠内で運用」とは言えない状態であり、AGENTS.mdの制約と最も強く矛盾している。ページに載せる際は、想定利用頻度と実際の月間コスト試算をセットで示すか、フィールドを減らして無料枠に収まるSKU(Essentials)に変更する設計判断が必要(microservices-architectへの申し送り事項)。
4. **Render.com Freeプランの環境変数注入**: `render.yaml`に`NEXT_PUBLIC_REMOTION_LICENSE_KEY`が登録されておらず、また`Dockerfile`にも`ARG`宣言が無いため、本番ビルドでこの値がクライアントバンドルに埋め込まれていない可能性が高い。無料ライセンス条件を満たしていても、キー未設定のままだとREADME記載通り警告が出続ける。設計判断が必要なため申し送り。
5. **フォントのライセンス表記**: Kosugi MaruはApache License 2.0であり、OFLの14書体と同列に扱えない(NOTICEファイルの有無次第でライセンス全文同梱が明確に必要)。現状`public/fonts/`にライセンスファイルが同梱されていない点は、OFL側は「プログラム同梱」の例外に該当し得るが、Apache 2.0側はより厳格な要件がある可能性があり、ページ・リポジトリでの扱いを再検討する必要がある。

---

## 参照した情報源の一覧

### 一次情報
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/rate-limits
- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview
- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- https://ai.google.dev/gemini-api/docs/latest-model
- https://ai.google.dev/gemini-api/docs/billing
- https://ai.google.dev/gemini-api/docs/files
- https://ai.google.dev/gemini-api/docs/media-resolution
- https://ai.google.dev/gemini-api/docs/speech-generation
- https://ai.google.dev/gemini-api/terms
- https://developers.google.com/maps/documentation/places/web-service/text-search
- https://developers.google.com/maps/documentation/places/web-service/place-details
- https://developers.google.com/maps/documentation/places/web-service/usage-and-billing
- https://developers.google.com/maps/documentation/places/web-service/policies
- https://developers.google.com/maps/billing-and-pricing/pricing
- https://www.remotion.dev/docs/license/faq
- https://www.remotion.dev/docs/licensing/
- https://raw.githubusercontent.com/remotion-dev/remotion/main/LICENSE.md
- https://render.com/docs/free
- https://render.com/docs/docker
- https://kenney.nl/assets/interface-sounds
- https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/OFL.txt(他13フォント分の同様URL)
- https://raw.githubusercontent.com/google/fonts/main/apache/kosugimaru/LICENSE.txt
- https://openfontlicense.org/documents/OFL-FAQ.txt
- https://mplusfonts.github.io/
- https://raw.githubusercontent.com/vercel/next.js/canary/license.md
- https://raw.githubusercontent.com/facebook/react/main/LICENSE
- https://raw.githubusercontent.com/tailwindlabs/tailwindcss/next/LICENSE
- https://raw.githubusercontent.com/colinhacks/zod/main/LICENSE
- https://raw.githubusercontent.com/googleapis/js-genai/main/LICENSE
- https://partnermarketinghub.withgoogle.com/brands/google/trademarks-and-terms/trademark-guidelines-for-proper-usage/
- SNSapp内部ファイル(コード調査のみ、編集無し): `package.json`, `README.md`, `.env.local.example`, `render.yaml`, `Dockerfile`, `public/audio/presets/CREDITS.md`, `public/fonts/`配下のファイル一覧

### 二次情報(参考程度、一次情報での裏付けが取れなかった箇所に限定使用)
- https://discuss.ai.google.dev/t/migrate-from-gemini-3-pro-preview-to-gemini-3-1-pro-preview-before-march-9-2026/127062(Google公式フォーラムの投稿。運営からの一次情報に近いが公式ドキュメントページではないため区別)
- chrome-headless-shellのBSD-3-Clauseライセンスに関するGitHub issue/PRのコメント
- Render Freeプランの0.1 CPU/512MB RAM、帯域幅5GBに関するコミュニティ記事(render.com公式ドキュメント本文では直接確認できず)
- Vercel/Tailwind Labsの商標ガイドラインの要約(WebSearchの要約結果であり、各社ページ本文の直接取得はしていない)
