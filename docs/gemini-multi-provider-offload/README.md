# Gemini以外のAIへの処理分散(検討メモ)

## 実装状況(2026-09-23)

**方針案1(transcribeCaptions/autoEditPlanのGroq移行)を実装済み。** `src/lib/groq/`配下に
新設し、`src/lib/gemini/transcribeCaptions.ts`・`autoEditPlan.ts`は削除した。実際に
Groqを呼んで動作確認(スモークテスト)はまだ行っていないため、下記「実装後に残っている
未検証事項」を必ず確認してから本番運用に入ること。

## 何を検討しているか

[gemini-token-usage](../gemini-token-usage/README.md)ではGemini自体のトークン消費を減らす対応を
行ったが、今回はさらに一歩進めて、**5つのAI機能のうち一部をGemini以外のサービスに任せることで、
共有の無料枠そのものへの負荷を分散できないか**を調査した。実装はまだ行っておらず、このドキュメントは
方針案の比較と、次に確認すべきことの整理まで。

## 前提条件(合意済み)

- **管理者(1人)が持つAPIキーの範囲で完結させる。** 友人に新しいサービスのAPIキーを個別登録して
  もらうことはしない(既存のGemini BYOKとは違う方針)
- **対象は5機能すべて**(extractStyle / transcribeCaptions / generateVoiceover / autoEditPlan /
  editExampleDigest)を広く検討する
- 「性能向上」と「無料枠の負荷分散」が両立しない場合は、**負荷分散を優先**する

## 各機能のおさらい(現状)

| 機能 | 入力 | 出力 | Gemini上の制約 |
|---|---|---|---|
| `extractStyle` | 参考動画(先頭12秒・低解像度)/画像 | テロップスタイルのJSON | 通常枠。動画の「動き」を見て判断させている |
| `transcribeCaptions` | 動画から抽出した音声のみ | 字幕セグメントのJSON | 通常枠 |
| `generateVoiceover` | テロップ文言(テキスト) | 読み上げ音声(WAV) | 無料枠が最も厳しい(実測RPM3回程度)。キャッシュ済み |
| `autoEditPlan` | few-shot例のdigest(テキスト)+動画情報 | 編集プランのJSON | 通常枠 |
| `editExampleDigest` | お手本動画(登録時1回のみ) | 要約のJSON | 通常枠だが呼び出し頻度が低い |

## 調査した代替候補(一次情報で確認した事実、確認日: 2026-09-23)

### Groq(groq.com)

- 無料枠は現存。クレジットカード登録不要([console.groq.com/docs/rate-limits](https://console.groq.com/docs/rate-limits))
- **テキスト生成**: `openai/gpt-oss-120b`等の主要モデルがRPM 30 / RPD 1,000。JSON構造化出力(strict mode)対応
- **音声認識(Whisper)**: `whisper-large-v3` / `whisper-large-v3-turbo`をホスティング。RPM 20 / RPD 2,000 /
  1日あたり処理できる音声の長さの上限(ASD)28,800秒(=8時間相当)
- **画像入力**: `qwen3.8-27b`のみ対応。1リクエスト最大3枚(静止画のみ、**動画入力への対応は未確認**)
- 商標: API利用自体にロゴ表示等の義務は見当たらず(ただし公式のtrademark-policyページは直接確認
  できておらず、WebSearchの要約経由のため確度はやや低い。**要再確認**)

### ElevenLabs(elevenlabs.io)

- 無料プランは月10,000クレジット(文字数の目安)まで
- **利用規約(Terms of Use 1(c))に「無料プランは非商用目的に限る」と明記されている。**
  SNSappは友人グループとはいえ複数人にサービス提供する形態のため、無料プランのままでの
  組み込みはToS違反のリスクがある。**今回の候補からは除外する**

### Deepgram / AssemblyAI(音声認識特化)

- どちらも「無料クレジット付与」型(Deepgram: $200、AssemblyAI: $50)で、Groq/Geminiのような
  「毎日回復する無料枠」ではなく、**使い切ったら終わりの試用クレジット**
- 日本語対応の可否はそれぞれのモデル別ページで別途確認が必要(**未確認**)
- 「無料利用枠の範囲内で運用できるか」というこのプロジェクトの制約(AGENTS.md)には
  本質的に合わない(いずれ枯渇する)ため、継続運用の主軸としては採用しない

### OpenRouter(openrouter.ai)

- 無料モデルは現存するが、レート制限が無課金だとRPD 50と非常に厳しい(少額課金でRPD 1,000まで
  緩和されるが、それは「無料のみ」という前提から外れる)。今回は主軸候補から外す

## 方針案

### 方針案1(推奨): transcribeCaptionsとautoEditPlanをGroqへ恒久移行

- `transcribeCaptions`(音声のみ送信)→ Groqの`whisper-large-v3-turbo`
- `autoEditPlan`(テキストのみ送信)→ GroqのLLM(JSON構造化出力対応モデル)
- **効果**: この2機能がGeminiの無料枠を完全に離れる。どちらも現在すでに「音声のみ」
  「テキストのみ」に最適化済みで、Groq側にそのまま渡せる形になっている(=移行コストが低い)
- **複雑さ**: 中。Groq用SDK(またはOpenAI互換エンドポイント)の追加、`GROQ_API_KEY`環境変数、
  `geminiErrors.ts`相当のエラー分類・リトライ判断をGroq向けに用意する必要がある
- **要検証**: Whisperの日本語文字起こし精度がGeminiと同等か。Groq側の商標ポリシー一次情報

### 方針案2: フォールバック方式(Geminiが上限到達時だけGroqに切替)

- 平常時はGeminiのみ使い、`isDailyQuotaError`を検知した場合だけ同じリクエストをGroqに
  切り替える(vision系のextractStyle/editExampleDigestはGroq側で代替不可のため対象外、
  実質transcribeCaptions/autoEditPlanのみに適用可能)
- **効果**: ユーザー体験としては「上限到達後もすぐには使えなくならない」という分かりやすい改善
- **複雑さ**: 高め(2系統のプロンプト・スキーマ整合、切替ロジック)。方針案1より実装コストが
  高い割に、平常時の負荷分散効果は方針案1に劣る(Geminiに集中したまま)ため、方針案1の
  **後から追加する保険**として位置づけるのが妥当

### 方針案3(保留): extractStyle / editExampleDigestのvision処理をGroqの画像モデルで簡易代替

- 動画から数フレーム(静止画)を抜き出し、Groqの`qwen3.8-27b`(画像3枚まで)に渡す
- **リスク**: 現在のプロンプトは「テロップが表示される瞬間の動き」の観察を前提にしており、
  静止画数枚では動きの情報が失われ、体感品質の低下がほぼ確実に起きる
- `editExampleDigest`は登録時1回だけの低頻度処理のため、そもそも移行のROIが低い
- 総合: 優先度は低く、今回は見送りを推奨

### 方針案4(保留): AIナレーション(TTS)は追加調査が必要

- ElevenLabsは無料プランのToSにより除外(前述)
- 自前ホスティングのOSS音声合成(例: VOICEVOX、[gemini-token-usage](../gemini-token-usage/README.md)でも
  「これからの流れ」として既出)は、Render無料プランで動かせるかが未調査のまま
- GroqにTTSモデルがあるかどうかも今回は未確認
- 現状すでにキャッシュで大きく節約できているため、他の2機能ほど急ぎではない

## 比較表

| 方針案 | 対象 | 負荷分散効果 | 複雑さ | 品質への影響 | 今回の推奨度 |
|---|---|---|---|---|---|
| 1. Groqへ恒久移行 | transcribeCaptions, autoEditPlan | 高(2機能が完全に離脱) | 中 | ほぼ影響なし(想定) | ◎ |
| 2. フォールバック | 同上2機能 | 中(平常時はGemini集中のまま) | 高 | 影響なし | ○(方針案1の追加保険) |
| 3. vision簡易代替 | extractStyle, editExampleDigest | 中〜高 | 中〜高 | 低下の可能性が高い | △(見送り推奨) |
| 4. TTS移行 | generateVoiceover | 未定(候補要追加調査) | 不明 | 不明 | △(追加調査待ち) |

## 次にやるべきこと(未確認事項の解消)

実装に着手する前に、AGENTS.mdの制約(無料枠・技術的実現可能性・商標/ライセンスの一次情報確認)に
従い、少なくとも以下を確認する:

1. Groqの日本語Whisper認識精度(公式ドキュメントの対応言語一覧、可能ならサンプル音声での試験)
2. Groqの商標ポリシー・利用規約の直接確認(現状はWebSearch要約経由のため確度が低い)
3. Groqの動画(video)入力対応の有無(方針案3を将来検討する場合に必要)
4. Groq TTSモデルの有無(方針案4に関連)
5. VOICEVOX等の自前ホスティングがRender無料プランのリソース制約内で動くか

## 確認事項(ユーザーへの質問)

1. 方針案1(Groqへの部分移行)を試作(プロトタイプ実装)に進めてよいか、それとも上記の
   未確認事項をもう少し埋めてから判断したいか → **「試作に進む」の回答を得て実装済み**
2. Groqを新しい依存関係として導入すること自体に懸念はないか(無料の第三者サービスであり、
   Google同様にアカウント作成が必要)

## 実装後に残っている未検証事項(本番投入前に必ず確認すること)

- **`GROQ_API_KEY`が未設定**。[console.groq.com](https://console.groq.com/keys)で発行し、
  デプロイ環境(Render)とローカルの`.env.local`の両方に設定する必要がある
- **実際にGroqを呼ぶスモークテストが未実施**。以下は型定義(`node_modules/groq-sdk`の
  `.d.ts`)ベースで実装したが、実際のレスポンス内容での確認はできていない:
  - Whisperの`verbose_json`応答に`segments`(`start`/`end`/`text`)が実際に含まれるか
    (groq-sdkの型定義は`{ text: string }`しか宣言しておらず、OpenAI互換の仕様から
    存在すると推測して実装している)
  - `strict: true`のJSON Schema構造化出力で、nullを許容するenum(`type: ["string","null"]`
    + `enum`に`null`を含める形)が実際に期待通り動くか
  - 日本語の字幕の文字起こし精度(語尾の言い淀み除去等はGemini版のLLM後処理が無くなった分、
    素のWhisper出力に近くなる。体感品質は要確認)
- Groqの商標ポリシー・利用規約ページの直接一次情報確認(前回はWebSearch要約経由)
- Groqの429エラーが「1日あたりの上限」か「1分あたりの上限」かを見分ける方法が未調査
  (`src/lib/groq/groqErrors.ts`のコメント参照。現状は一律リトライ対象として簡略化している)

---

## 付録(エンジニア向け技術メモ)

- 実装済みコード: `src/lib/groq/`配下(`transcribeCaptions.ts` / `autoEditPlan.ts` /
  `groqClient.ts` / `groqErrors.ts` / `rateLimiter.ts` / `usageLog.ts`)。
  レート制限レーンの土台(`createRateLimiterLane`)は`src/lib/rateLimiterFactory.ts`に
  切り出し、`gemini/rateLimiter.ts`と共有している
- `editExamplesStore.ts`(`gemini/`配下のまま)に`loadEditFewShotTextContext()`を追加。
  Groqは動画アップロードに対応しないため、digest(要約)が無い編集例はfew-shotから
  スキップされる
- 調査対象コード(旧Gemini実装、現在は削除済み): `extractStyle.ts` /
  `generateVoiceover.ts` / `editExampleDigest.ts` / `geminiErrors.ts` / `usageLog.ts` /
  `rateLimiter.ts`(これらは引き続きGeminiのまま)
- Groq公式ドキュメント(確認日 2026-09-23):
  - レート制限: https://console.groq.com/docs/rate-limits
  - Vision対応: https://console.groq.com/docs/vision
  - 構造化出力: https://console.groq.com/docs/structured-outputs
  - 商標: https://console.groq.com/docs/trademarks
- ElevenLabs利用規約(無料プラン非商用条項): https://elevenlabs.io/terms-of-use Section 1(c)
- Deepgram料金: https://deepgram.com/pricing / AssemblyAI料金: https://www.assemblyai.com/docs/billing-and-pricing
- OpenRouterレート制限: https://openrouter.ai/docs/api-reference/limits
- 方針案1を実装する場合、`geminiErrors.ts`と同等の「日次上限/分単位制限の判別・平易なエラー
  メッセージ変換」ロジックをGroq向けに新設する必要がある(Groqのエラー形式はGeminiと異なるため
  流用不可、要新規実装)
