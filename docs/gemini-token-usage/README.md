# Geminiの無料枠がすぐ枯渇する問題について

## 何が起きているか

このアプリは「Gemini」というGoogleのAIを、次の3つの場面で使っている。

- 参考画像・動画からテロップのスタイル(色・フォントなど)を提案する
- 動画の音声からテロップ(字幕)を自動で作る
- テロップをAIの声で読み上げる(ナレーション機能)

これらは全員が同じ1つの「無料枠」を共有して使っている。無料枠には「1分間に呼べる回数」
「1日に呼べる回数」といった上限があり、身内・知人だけの少人数で試しているだけでも、
使い方によってはこの上限にすぐ達してしまい、「しばらく使えなくなる」状態が起きていた。

## 今回やったこと:まず「何が一番消費しているか」を測る

対策はいくつも考えられる(後述)が、どれが一番効くかは「今、3つの機能のうちどれが
一番無料枠を消費しているか」が分からないと決められない。体感では判断できなかったため、
今回はまず**計測を追加しただけ**で、機能や画面の見た目は何も変わっていない。

具体的には、Geminiを呼び出すたびに「どの機能が」「どのモデルで」「トークンを何個
使ったか」を記録に残すようにした。「トークン」はGeminiが処理する文章・画像・音声の量を
数える単位で、無料枠の上限はこのトークン数や呼び出し回数をもとに決まっている。

あわせて、「今日の上限に達しました」というエラーが起きた時に、それがどの機能で
起きたかも分かるようにした。

## ログの見方

サーバーの動作記録(ログ)に、Geminiを呼ぶたびに次のような行が増えていく。

```
[gemini_usage] call=extractStyle model=gemini-3.6-flash tokens(prompt/output/thoughts/total)=1523/42/580/2145 累計(このプロセス起動から): calls=3 totalTokens=4210
```

- `call=` … どの機能か(`extractStyle`=スタイル抽出、`transcribeCaptions`=字幕生成、
  `generateVoiceover`=AIナレーション、`autoEditPlan`=自動編集「バズる動画」の提案生成)
- `tokens(prompt/output/thoughts/total)=` … その1回の呼び出しで使ったトークン数。
  `thoughts`はAIが画面に出さない「内部の思考」に使った分で、テキストとしては見えないが
  無料枠はきちんと消費する。実際に計測したところ、これが全体の3〜4割を占めるケースがあった
- `累計` … サーバーが起動してからの合計(サーバーが再起動すると0に戻る、ざっくりした
  傾向をつかむためのもの)

上限に達した回だけ、別途こういう行も出る。

```
[gemini_usage] call=generateVoiceover が本日の無料枠上限に到達 累計(このプロセス起動から): dailyQuotaExceededCount=1
```

デプロイ先(Render)の管理画面のログ画面で `gemini_usage` を検索すれば、この行だけを
抜き出して見られる。しばらく普段どおり使ってもらったあと、このログを見れば
「どの機能が一番トークンを使っているか」「上限に達しているのはどの機能か」が分かる。

## 分かったこと:AIナレーション(TTS)が最大の原因だった

実機で試したところ、AIナレーション生成でだけ「上限に達しました」が頻発した。原因は
実際のエラーメッセージに出ていた。

```
Quota exceeded ... limit: 3, model: gemini-2.5-flash-tts
```

**AIナレーションに使うTTS(読み上げ)モデルは、無料枠が1分あたりたった3回まで。**
スタイル抽出・字幕生成に使っている通常モデルよりも桁違いに厳しい。さらに、このTTS
モデルには「音声が空で返ってくる」といった既知の不具合があり、失敗するたびに
自動で再試行していたため、1回のナレーション生成で実質2〜3回分の枠を使ってしまう
ケースもあった。

## 対応したこと

1. **TTSだけ呼び出し間隔を専用に分離**(`rateLimiter.ts`) — 今まで全機能共通だった
   間隔(約6.5秒に1回)を、TTSだけ実際の上限に合わせて約22秒に1回に変更。他の2機能は
   従来どおり
2. **やり直しても直らない失敗はリトライをやめる**(`generateVoiceover.ts`) — 引数
   エラーのような、リトライしても結果が変わらない失敗で、ただでさえ少ないTTSの枠を
   無駄に消費しないようにした
3. **同じ文言・声質のナレーションはキャッシュ**(`voiceoverCache.ts`) — 作り直しの
   たびにAIを呼び直さないようにした

## 各自の無料キーを使えるようにした(BYOK)

上記はTTSの「無駄遣い」を減らす対応で、1分3回という上限自体は変わらない。そこで、
希望する人は自分の無料Geminiキーを使えるようにした。

- 画面右下の「AIの無料枠について」ボタンから、自分のAPIキーを設定できる
- [Google AI Studio](https://aistudio.google.com/apikey)でGoogleアカウントがあれば
  無料で発行できる
- 設定すると、以後そのブラウザからのAI機能はその人専用の枠で動く(お金はかからない)
- 設定しなくても、これまでどおり共有の枠で使える(必須ではない)
- キーはそのブラウザの`localStorage`にのみ保存され、サーバーには保存されない

## これからの流れ

引き続き検討しているもの(まだ決定ではない)。

1. **ナレーション部分だけ別のAI(VOICEVOX等)に切り替える** — Gemini以外の無料TTSを
   使えばこの上限自体から解放されるが、今のホスティング(Render無料プラン)に
   同居させられるかは未調査
2. **有料プランへの切り替え** — 予算をかけられる場合の選択肢。まだ検討段階

---

## 付録(エンジニア向け技術メモ)

- 計測ロジック: `src/lib/gemini/usageLog.ts`(`recordGeminiUsage` / `recordGeminiDailyQuotaExceeded`)
- 呼び出し箇所: `extractStyle.ts` / `transcribeCaptions.ts` / `generateVoiceover.ts` /
  `autoEditPlan.ts` の各Gemini呼び出し成功時、および `geminiErrors.ts` の
  `isDailyQuotaError()` がtrueになった時
- トークン数はGemini APIのレスポンスに含まれる `usageMetadata`(実測値)を使用。
  推定値ではない
- 現状はログ出力のみで、集計・保存は行っていない(DBやファイルへの永続化は
  Render Freeのメモリ制約もあり今回のスコープ外)
- レート制限は`rateLimiter.ts`の`createGeminiRateLimiter()`でレーンを分離。
  通常系は`runWithGeminiRateLimit`(既定6.5秒間隔)、TTSは`runWithGeminiTtsRateLimit`
  (既定22秒間隔、`GEMINI_TTS_MIN_INTERVAL_MS`で調整可)
- `GEMINI_MOCK=1`(開発用モック、`mockMode.ts`)、`extractStyleCache.ts`(スタイル抽出結果の
  インメモリキャッシュ)、参考動画の解析範囲を先頭12秒・低解像度に絞る最適化(`extractStyle.ts`)、
  文字起こしは映像を送らず音声のみアップロード(`transcribeCaptions.ts`)は、いずれも
  origin/main合流時に失われていたのを復元したもの
- `voiceoverCache.ts`は生成済み音声を`public/audio/generated/`にファイルとして永続化する
  方式(サーバー再起動でも消えない)。手動生成(`/api/generate-voiceover`)と自動編集
  (`auto-edit`)の両方から共有する
- BYOK: クライアント側は`src/lib/geminiApiKeyClient.ts`(localStorage)・
  `src/components/settings/GeminiApiKeySettings.tsx`(設定UI)。ヘッダー名は
  `src/lib/gemini/apiKeyHeader.ts`の`GEMINI_API_KEY_HEADER`(`X-Gemini-Api-Key`)で
  共有。各APIルート(スタイル抽出・字幕生成・AIナレーション・自動編集)が
  `readGeminiApiKeyOverride()`で読み取り、対応する関数の`apiKeyOverride`に渡す
  (未指定時は`process.env.GEMINI_API_KEY`にフォールバック)

## 補足: origin/mainとの合流について

このドキュメントの対応を進めている間に、origin/main側では別に自動編集
(「バズる動画」)機能・学習データ管理画面などが大きく開発が進んでおり、
同じ課題(TTSのキャッシュ化・エラーメッセージの改善)に独立に対応した
コミットも含まれていた。合流時にorigin/main側の実装(ファイル永続化キャッシュ、
日次/分単位の区別・待ち秒数表示)を活かしつつ、このドキュメントの対応
(計測ログ・BYOK・平易な文言・レート制限のレーン分離)を統合した。
また、origin/main側にはvitest(テスト基盤)自体が導入されていなかったため、
あわせて復元している。
