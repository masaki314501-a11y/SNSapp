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

H.264以外の動画(iPhoneで撮ったHEVCの`.mov`など)は、アップロード前に**アップロードする人のブラウザで**
H.264のMP4に変換してから送る(`prepareVideoFile.ts`、mediabunny)。書き出しもブラウザ内で行うため、
HEVCのままだとWindows版ChromeやAndroidなど読めないブラウザで「The video could not be decoded by
the browser」になって書き出せなかった。サーバーで変換するのは512MB・非力なCPUの本番では現実的でないので、
元動画を読める撮影端末のブラウザで一度だけ変換する(ヘッドレスChromeで53秒・720pの動画が約25秒)。
変換時はキーフレームを1秒ごとにし、細かく切った動画でもプレビューの頭出しを軽くする。H.264の動画は変換せずそのまま送る。アップロードする端末でも読めない形式なら、撮影したスマホから
アップロードし直すよう案内する。変換を入れる前にアップロードされた動画で書き出しに失敗した場合は、
英語のエラーの代わりにアップロードし直すよう案内する。

### 2. `/create/cut` — ラフカット

不要な部分(前置き・言い淀み・撮り直し等)を先に切り捨てる画面。分割(`S`キー)・イン/アウト点
(画面上は「ここから使う」「ここまで使う」、`I`/`O`キー)・トリム・削除・並べ替えで「使う範囲」を絞り込む。ここで捨てた範囲は、
この後の自動編集・字幕の一括生成の対象にならない(自動編集はこの範囲の中からだけ切り出す)。

プレビュー下の「元動画のうち使う範囲」バーは操作できる。クリックでその時刻へ移動、
横にドラッグで元動画上の範囲を選ぶと「この範囲を捨てる」「ここだけ残す」が出る
(分割→分割→選択→削除の4手を1手にするための導線。何テイクも撮った中から1テイクだけ
使いたい場合は「ここだけ残す」)。キーボードは `Space`(再生/一時停止)、`←`/`→`(1フレーム
送り、`Shift`併用で1秒)、`S`(分割)、`I`/`O`(イン/アウト点)、`Delete`(選択を削除)。
トリム(ドラッグ・`I`/`O`)もUndo/Redoの対象。キーボード操作の説明は、マウスの無い端末(スマホ・タブレット)
では使えないので出さない(`.keyboard-hint`)。

### 3. `/create/style` — 参考スクショ(見た目の手本)

(任意)真似したい投稿の**スクリーンショットまたは動画**を**最大10個まで**アップロードすると、Geminiが配色・フォント・
テロップ位置・テロップの背景の付き方・出現演出をまとめて抽出する(`/api/extract-style` または
`/api/extract-style-from-video`、非同期ジョブ+ポーリング)。判定は既定でProモデル(`gemini-pro-latest`)
が行い、文字の太さ・縁取り・帯・差し色・配置を観察してから候補を選ぶ。スクリーンショットは細部を
読めるよう高解像度で渡す。`data/style-examples/`に保存してある正解データは、
抽出のたびにfew-shot例として自動的に使われる。

参考を複数渡せるのは、1枚だけだとその1枚にたまたま映っていた色や配置まで真似てしまうため。画像は追加・削除の
たびに**全部の画像をまとめて**Geminiに見せ、共通する癖から抽出し直す(保存済みの画像はパスだけ送り、同じ画像を
何度も保存しない)。画像が無く動画だけのときは、新しく追加した動画から抽出する。前回渡した参考も一覧に出し、
✕で外せる(一覧のサムネイルは `/api/media/references/…` から表示する)。

渡した参考はサーバーに保存し(画像は `public/references/`、動画は `public/videos/`)、パスを
プロジェクトの `styleReferences` に残す(1枚だけだった頃の `styleReference` は読み込み時に移す)。
次の自動編集がこれらを**最優先の手本**として直接見るため。「自動編集へ進む」を押すと、カットで残した
範囲を `cutKeepRanges` として保存して `/create/auto-edit` に遷移する。

以前はここで音声から字幕を生成していたが、字幕を付けるかどうかは編集画面で決める流れにしたため、
編集画面の「字幕を一括生成」に移した。

### 4. `/create/auto-edit` — AIで編集(工程1〜14)

編集マニュアルの工程1〜14を、AIと決まった計算で順に進める。画面の上の「ステップ 4 / 6」の中で、
工程は「工程 8 / 14」のように出す(ステップと工程の番号を取り違えないよう、工程の画面には「ステップ4「AIで編集」の中の作業」と書く)。

- **「AIで自動編集する」**: 工程1〜14を自動で順に流す(`src/lib/editSteps/client.ts`の`runAllSteps`)。1工程ずつ
  `/api/edit-step`に頼み、終わるたびにプロジェクトへ保存する。最後の工程14でチェック項目を確かめ、AIの答えのぶれで
  「要修正」になった項目は、直る見込みのある工程から流し直す(`RETRY_STEP_BY_CHECK`、2回まで)。終わると工程14のページを開く。
- **「続きから自動で進める」**: 途中で画面を閉じた・止まった時は、まだ終わっていない最初の工程から続ける(`resumeStepOf`)。
  使う範囲の画面で範囲を変えた時は、前の範囲で作った工程の結果(`editSteps`)と`cutKeepRanges`を消すので、続きは出ない。
- **「工程ごとに編集する」**(`/create/steps/<工程>`): 同じ工程を1ページずつ、結果を見ながら進める。
- 工程の中身・AIへの指示文の全文は、アプリ内の「工程ごとの指示文」(`public/docs/edit-steps-summary.html`・`edit-steps-full.html`)にまとめてある。
- 設定: 左上のタイトル(空ならAI)・長さの上限(空なら動画の長さのまま。入れた時だけ工程12で削り、工程14で確かめる)・どこに出す動画か(TikTok/広告)。

**工程14(チェック項目)**: 自動で満たした項目は出さず、直す必要がある項目(要修正)と目で確かめる項目だけを出す。
やり直しても直らない項目(冒頭の間・冒頭5秒のカット数など)には、「このままでも出せるか」と編集画面のどこで直せるかを書く。
誤字・脱字はAIが音声と見比べ、数文字だけの小さな直し(`isSmallTypoFix`)だけを自動で直す(大きく書き換える物は、利用者の言い換えを
戻してしまうことがあるので候補として出す)。広告の表現(薬機法・景品表示法・比較広告)は、引っかかった言葉と理由を出し、
その場で言い換えられる(`rewordAndRecheck`。工程13の結果を書き換えて工程14をやり直す)。
全部を満たすと「生成完了(編集画面へ)」で`/edit`へ進む(以前あった「強調する字幕を選ぶ」画面は、工程10で強調を決めるので外した)。

**話に合わせた字幕・寄りの描き方**: 動画の音から話している区間を調べ(`src/lib/audio/speechActivity.ts`。ffmpegで音の大きさを見るだけ)、
工程2・4・5の切れ目や、工程14のタイミングのチェックに使う。寄りの描き方は`remotion/shared/MediaBackground.tsx`。

以前の「自動編集(1回のAIの依頼で全部決める・`autoEditPlan.ts`)」は、工程ごとの編集に置き換えて消した。
画像の棚(`data/image-library/`)は、その頃に作った画像を使っているプロジェクトのために、`/api/media`からの配信だけ残している。

### 5. `/edit` — クリップ編集

Remotion Playerでのプレビューを見ながら、以下を編集できる。

- **クリップ**: トリミング(開始秒・長さ、ドラッグ or イン/アウト点`I`/`O`)、分割(`S`)、
  追加・削除・複製・結合、ドラッグ&ドロップや↑↓での並べ替え、複数選択(Shift/Ctrl)、
  字幕の個別編集・一括編集・**一括生成**(自動編集の書き起こしがあればそれを流し込むだけで
  APIを呼ばない。無ければ動画全体を文字起こしし、クリップの切り方は変えずに各クリップへ割り当てる
  `assignTranscriptToSegments`)・全部消す、クリップごとの音量(元の音声だけをミュートするチェックボックス
  付き)、テロップ出現アニメーション(9種)、Undo/Redo
- **演出**: 自動編集(Gemini)が決めた演出をすべて手で直せる。選択中クリップの寄り(ON/OFF・倍率・一気に/じわじわ・
  寄る中心)、字幕の強調単語と色、強調テキスト(文言・位置・大きさ・傾き・文字色・縁取り・帯・出す時刻・表示秒数・
  出現演出、追加/削除)。動画全体の冒頭の見出しと補足・締めの一言・ずっと出す文字も同じタブで直せる(`EffectsInspectorPanel.tsx`)。
  クリップを分割すると強調テキストは出す時刻で前後に振り分け、結合すると後ろの分を時刻をずらして引き継ぐ(`timelineUtils.ts`)
  - **文字のスタイル**: 強調テキスト・ずっと出す文字は、見本を見ながら**170種類のスタイル**から見た目を選べる
    (`TextStylePicker.tsx`)。選ぶと、文字色・何重もの縁取り・グラデーション・何重もの光や影・背景の箱・書体をスタイルが決める
    (色・縁取り・帯の欄は隠れる。「外す」で元に戻る)。見た目はPremiereの画面のスクリーンショットと見比べて合わせてある。スタイルは Premiere Pro のテキストスタイル(`.prtextstyle`)を
    `scripts/import-prtextstyle.mjs` で読み取って作った(下の「Remotion側」の`textStylePresets.ts`参照)
  - **画像を重ねる**: 「＋ 画像を差し込む」(クリップごと)・「＋ ずっと出す画像を差し込む」(ロゴ等、動画全体)で
    画像(png/jpg/webp/gif、10MBまで)をアップロードし、位置・幅・傾き・角の丸み・出す時刻・表示秒数・出現演出を
    指定して重ねる(`/api/upload-image` → `public/images/`、配信は`/api/media`経由、描画は`ImageOverlays.tsx`)。
    画像は強調テキストより下に重ねる(文字が画像に隠れないように)
  - **プレビュー上でドラッグして動かせる**: 止めている間、その時点で画面に出ている強調テキスト・画像
    (クリップごと・動画全体とも)に点線の枠が出て、指やマウスでつかんで動かせる(`PreviewDragLayer.tsx`)。
    文字は動画の中に描かれていてつかめないため、同じ大きさ・位置・傾きの見えない枠を重ねている
    (1080px幅の座標で描いて表示サイズに縮めるので、枠と実際の文字がずれない)。再生中は枠を出さない
- **AIに頼む(演出を足す・直す)**: 「2つ目のクリップに『ここ重要!』って大きく出して」「効果音を半分に」のような
  文章の依頼で、AI(flash、文字だけのやり取り)が今の編集内容を直した案と変更点の一覧を返す(`AiRevisePanel.tsx`・
  `/api/revise-edit`・`reviseEdit.ts`)。強調テキスト・効果音(プリセットから)は足すこともできる。変更点を見てから
  「反映する」を押した時だけ反映し、反映後も1回ぶん元に戻せる。クリップを新しく作ったり画像を差し替えたりはさせない
- **スタイル**: プリセット(6種)一括適用、配色、テロップの見た目(カラー背景/縁取り文字)、
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
- **一括生成は「未生成の分」と「違う声の分」だけ**: ナレーションは読み上げ元クリップの `narrationSegmentKey`・
  作った声(`narrationVoice`)・読み上げた文(`narrationText`)を持つ。一括生成は「まだ作っていないクリップ」と
  「今選んでいる声と違う声で作ったナレーション」を対象にし、後者は同じ文を今の声で作り直す(開始位置はそのまま)。
  以前は作ってある分を飛ばしていたため、自動編集で作った分や別の声を選んでいた時の分が残り、男性っぽい声と
  女性っぽい声が混ざっていた。声を記録していない古いナレーションも「違う声」として扱う(同じ文・同じ声なら
  保存済みの音声を使うのでAPIは使わない)。ボタンには件数を出し、違う声が混ざっていれば注意書きを出す。
  個別生成は作り直しとして既存のナレーションを差し替える(同じ台詞が重ならない)
- **声の選択**: 声は「女性・落ち着いた(Kore)」のように性別と感じを添えて表示する(`voiceOptions.ts`。名前だけでは
  選べなかったため)。選んだ声はプロジェクトに保存し、画面を開き直しても戻らない
- **元の音を消す**: 「ナレーションを入れたクリップは、元の音(話し声など)を消す」をONにすると、ナレーションが
  付いているクリップだけ元の音量を0にして書き出す(`buildStandardVideoProps`の`muteOriginalUnderNarration`)。
  クリップの音量設定自体は書き換えないので、OFFに戻せば元の音量に戻る。全部ではなく特定のクリップだけ消したい時は、
  AI音声タブでクリップを選ぶと出る「このクリップの話し声を消す」で切り替えられる(クリップの音量を0にする)
- **上限に達したときの扱い**: 1日あたりの上限(`PerDay`)は待っても翌日まで回復しないため
  再試行せず即座にその旨を表示する。1分あたりの制限は従来通り再試行し、Geminiが返す
  `retryDelay` を「約N秒後に再度お試しください」として見せる。Gemini APIはプリペイド
  (上限800円)で運用しているため、チャージ残高切れのエラーも再試行せず「AI Studioでチャージして
  ください」と表示する。一括生成は途中で失敗しても
  そこまでの分がタイムラインに残るので、翌日押し直せば残りだけが生成される(中断ボタンもあり)

編集内容は操作のたびに自動保存され、リロード/再訪問時に復元される。編集の状態をJSONファイルに
保存/復元することもできる(画面上は「💾 編集データを保存」「📂 保存した編集データを開く」。以前は
「プロジェクトを書き出す/読み込む」だったが、「動画を書き出す」と紛らわしく何が保存されるのか分からないと
言われたため改名し、動画そのものは入らないことを常に見える説明で書いた)。

使い方の説明は、マウスを乗せると出る説明(`title`)だけに頼らず画面に常に出す(スマホでは`title`が見えないため)。
タイムラインの「分割」「ここから使う」「ここまで使う」も、赤い線(再生位置)に合わせて効くことを
ツールバーの下に書いている。

画面幅は、どのページもスマホ幅(320px〜)で横にはみ出さないようにしている。`globals.css`で
画像・動画・入力欄を親の幅に収め、英数字だけの長いファイル名も折り返す。ページの`<main>`には
必ず`w-full`を付ける(付けないと中身の最小幅に合わせて広がり、ファイル選択欄の既定幅で
`/create`などがiPhone幅からはみ出していた)。

### 6. `/edit/export` — 書き出し

画面を開くと、**利用者のブラウザの中で**動画を書き出す(`@remotion/web-renderer`、`useWebRender.ts`)。
サーバー(Render無料プラン、512MB)でヘッドレスChromeを使って書き出すと実メモリが最大約1.5GBになり、
サーバーごと落ちて保存できなかったため(解像度を下げてもほぼ減らなかった。下記「デプロイ」参照)。
書き出し中はこの画面を開いたままにする必要があり、画面が暗くならないよう対応ブラウザでは
Wake Lockを取る。書き出し前に `canRenderMediaOnWeb` でブラウザが対応しているか確かめ、非対応なら
理由を日本語で出す(Safari・Chromeの新しめのバージョンが必要)。

ブラウザの動画エンコーダー(WebCodecs)は、端末やその時の状態によって途中で止まることがある
(Safariで「Buffer has no frame」「Encoding task did not complete」)。同じ設定で押し直しても同じ所で
止まりやすいため、エンコーダーのエラーで止まった時は設定を変えて**自動でやり直す**(`RENDER_FALLBACKS`):
通常 → 端末の動画支援(ハードウェア)を使わない → ハードウェア指定+画質を一段下げる → 解像度を0.75倍に下げる、の順。
どの設定でもだめだった時だけ、ほかのアプリやタブを閉じるかパソコンのChromeで試すよう案内する。

完成したら「ダウンロード」に加え、iPhone/iPadなど共有シート(Web Share API)にファイルを渡せる
環境では「写真に保存・共有」を出す(Safariの`<a download>`は「ファイル」アプリに保存され、
写真アプリには入らないため)。ヘッドレスChromeで約11秒・4クリップの書き出しを確認済み
(約60秒、H.264+AAC、1080×1920)。Safari/iPhone実機での速度・安定性は未確認。

サーバーで書き出すAPI(`/api/render`、`useRenderJob.ts`)も残してあり、メモリに余裕のある環境
(ローカル等)では使える。画面からは使っていない。

**表紙(サムネイル)**: 書き出し画面の「表紙(サムネイル)を作る」で、動画の場面を選び、タイトルを大きく重ねた画像
(1080×1920のJPEG)を保存できる(`remotion/templates/cover/Cover.tsx`・`CoverMaker.tsx`)。動画と同じ部品で描くので、
文字のスタイルは170種類から選べる(おすすめを先に出す)。画像にするのはブラウザの中(`renderStillOnWeb`)で、
スマホでは共有シートから写真に保存できる。タイトルの初期値は、左上のタイトル → 動画全体に出していた文字 → 冒頭の見出しの順。

### 全画面共通

- **エラーの見せ方**: ブラウザやライブラリが出す英語のエラー(「Load failed」「Encoding task did not complete」等)は
  画面にそのまま出さず、何が起きて何をすればいいかの言葉に言い換える(`src/lib/friendlyError.ts`の
  `toFriendlyErrorMessage`。通信切れ・時間切れ・メモリ不足などよくあるものは個別に言い換え、それ以外は操作ごとに
  用意した文にする)。サーバーで作った日本語のメッセージはそのまま見せる。Geminiのエラーも、英語の生のエラーや
  返事の形の検証結果の詳細は出さない(`geminiErrors.ts`の`toFriendlyGeminiError`)。元のエラーはconsoleに残す。

- **待ち時間の目安**: アップロード・変換・スタイル抽出・自動編集・AIへの修正依頼・字幕の一括生成・ナレーション生成・
  書き出し・効果音/BGM/画像のアップロードなど、待ち時間のある操作の横には「⏱ 目安約2分・0:45経過」を出す
  (`src/components/WaitTime.tsx`)。目安は動画の長さ・枚数・ファイルの大きさからの初期値で出し、実際にかかった時間を
  この端末(localStorage)に記録して、次からはその実績で補正する(`src/lib/waitEstimate.ts`。直近8回の「実績÷初期値」の
  中央値を掛ける)。進み具合(%)が分かる処理(アップロード・変換・書き出し・ナレーションの一括生成)は、ある程度
  進んだら実際の進み方から残り時間を出す。目安を大きく過ぎた時は「混み合っているかもしれません」と出し、
  止まったのか待てばよいのかを判断できるようにする。処理中にタブを切り替えても経過時間は0に戻らない。
- **文字の改行**: 日本語は幅が足りないとどの文字の間でも折り返すため、「リベン/ジ」のように言葉の途中で改行されて
  いた。テロップ・強調テキスト・見出し・締めの一言は、文節の切れ目で折り返し(`word-break: auto-phrase`、対応
  ブラウザのみ)、行の長さをそろえて1〜2文字だけの行を作らない(`text-wrap: balance`)ようにしている
  (`remotion/shared/textWrap.ts`)。強調テキストは指定の大きさだと1行が画面に収まらない時、収まる大きさまで自動で縮める。
  字幕・画面に出す文字の改行位置は`breakIntoLines`(`textWrap.ts`)で決め、1行ずつ折り返し無しで描く。

## ディレクトリ構成

### Next.js側 (`src/`)

- `src/app/create/` — アップロードのUI(`UploadGenerator.tsx`)
  - `prepareVideoFile.ts` — H.264以外の動画をアップロード前にブラウザ内でH.264のMP4へ変換
  - `uploadVideoFile.ts` — 動画アップロードの進捗付きfetch
  - `useTranscribeJob.ts` — 文字起こしジョブの開始とポーリング
  - `useExtractStyleJob.ts` — スタイル抽出ジョブ(画像/動画どちらも)の開始とポーリング
  - `cut/` — ラフカットのUI(`CutEditor.tsx` を配置)
  - `style/` — 参考画像・動画/字幕生成のUI(`StyleAndTranscribe.tsx` を配置)
  - `auto-edit/` — 「AIで自動編集」のUI(`AutoEditScreen.tsx`。工程1〜14を自動で流す・続きから進める)
  - `steps/` — 「工程ごとに編集」のUI(`StepsScreen.tsx`。1工程=1ページ。工程14のチェック項目・言い換え)
- `src/app/edit/` — クリップ編集のUI(`ClipEditor.tsx` を配置)
- `src/app/edit/export/` — 書き出しのUI(`ExportScreen.tsx` を配置)
- `src/components/editor/` — 編集画面のコンポーネント・ロジック
  - `ClipEditor.tsx` — プレビュー・クリップ編集・スタイル・音声タブをまとめる本体(`/edit`)
  - `PreviewDragLayer.tsx` — プレビュー上で強調テキスト・画像をドラッグで動かすための透明な層
  - `AiRevisePanel.tsx` — 「AIに頼む(演出を足す・直す)」欄
  - `ExportScreen.tsx` — 書き出し専用画面の本体(`/edit/export`)
  - `CutEditor.tsx` — ラフカット専用の簡易版(`/create/cut`、キャプション/SE/BGM無し)
  - `RenderPanel.tsx` — 書き出しボタンと進捗表示(不確定プログレス・残り時間の目安)
  - `useWebRender.ts` — ブラウザ内での書き出し(画面から使っているのはこちら)
  - `useRenderJob.ts` — サーバーでの書き出しジョブの開始とポーリング(画面からは未使用)
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
- `src/lib/styleReferenceLimits.ts` — 参考を渡せる数の上限(画面とAPIの両方で使うため分けている)
- `src/lib/editSteps/` — 工程1〜14の中身(`steps.ts`=工程の一覧、`logic.ts`=決まった計算、`ai.ts`=AIへの指示文、
  `checklist.ts`=工程14のチェック項目、`client.ts`=画面から工程を流す処理、`screenBoxes.ts`=顔・字幕が画面のどこを占めるかの見積もり)
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
  - `edit-step/` — 工程1〜14を1つずつ実行する(工程の状態を受け取り、次の状態と結果を返す)
  - `media/[...path]/` — `public/videos` `public/audio` `public/renders` を都度ファイル
    システムから配信するRoute Handler。通常のpublic配信はビルド時点のスナップショット
    しか返さず、起動後にアップロード/生成されたファイルは本番ビルドで404になるため必要。
    HTTP Rangeリクエストにも対応(iOS/iPadOSの「ビデオを保存」やシーク操作に必要)。
    ファイルはブラウザが読みに来た分だけ読み出し、途中で受信を打ち切られても閉じた出口に
    データを送らない(`Controller is already closed`でサーバーごと落ちるのを防ぐ)
- `src/lib/gemini/` — Gemini API呼び出しのラッパー
  - `transcribeCaptions.ts` / `transcribeJobs.ts` — 動画をFile APIにアップロードし、発話区切り
    ごとの `{startFromSeconds, durationInSeconds, caption}` 配列を取得する。ジョブはインメモリ管理
    (単一プロセス前提)
  - `extractStyle.ts` / `extractStyleJobs.ts` — 参考画像/動画から配色・フォント・位置・背景・
    演出を抽出する(画像はinlineData、動画はFile API経由)。`styleExamplesStore.ts` に
    登録済みの正解データがあれば、リクエストのたびにfew-shot例として先頭に差し込む
  - `styleExamplesStore.ts` / `styleTypes.ts` — スタイル抽出のfew-shot例(正解データ)の
    読み込み(`data/style-examples/`)
  - `autoEditTypes.ts` — 手本の書き起こし(`editExampleBreakdown.ts`。アプリの外で手で動かす)の形
  - `editExampleSelection.ts` — 工程8・10で見せる手本を、手本16本から近い順に選ぶ
  - `editExamplesStore.ts` — 自動編集のfew-shot例(学習動画・正解動画)の読み込み(`data/edit-examples/`)
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
  - `schema.ts` — 入力プロパティのzodスキーマ(クリップ配列は1〜120個、SE+AIナレーションは最大400個、
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
  - `MediaBackground.tsx` — クリップの動画/画像背景描画と寄り(`zoom`: punch=一気に寄る / slow=じわじわ寄る)。
    動画・音声は `@remotion/media` の `Video`/`Audio` を使う(`OffthreadVideo`はブラウザ内書き出しに非対応のため)。
    ただし**編集画面のプレビュー(Player)だけはブラウザ標準の`<video>`(`Html5Video`)で再生する**。`@remotion/media`の
    `Video`は1コマずつ解読してcanvasに描くため重く、iPhone/iPadでは読み込み待ちのたびにプレビュー全体が止まっていた
    (標準の`<video>`は端末のハードウェアで再生され、遅れても全体は止めない)。手元の計測(12クリップ)では
    30秒で17〜18秒分しか進まなかったのが、25秒ほどで23秒分進むようになった。
    あわせて、編集画面が再生中に毎コマ(1秒30回)画面全体を描き直していたのを1秒に7回ほどに間引き
    (`ClipEditor.tsx`の`PLAYING_FRAME_UPDATE_INTERVAL_MS`)、次のクリップは切り替わる2秒前から準備しておく
    (`StandardVideo.tsx`の`premountFor`)
  - `ShapeOverlays.tsx` — 画面に重ねる図形(ランキングの角の丸い枠など)。画像の上・文字の下に重ねる
  - `TextOverlays.tsx` — 字幕とは別に重ねる強調テキスト(位置・色・大きさ等は指定値で描く。ただし画面からはみ出す
    大きさは収まるまで縮め、中心が画面端に近くて文字が切れる時は内側へ寄せる。縁取りも帯も無い明るい文字には
    黒い縁取りを付ける(白い画像の上でも読めるように)。編集画面のドラッグ枠も同じ位置計算`resolveOverlayLayout`を使う)
  - `textStylePresets.ts` / `StyledText.tsx` — 文字のスタイル(170種類)とその描き方。スタイルは Premiere Pro の
    テキストスタイル(`.prtextstyle`)を `node scripts/import-prtextstyle.mjs <ファイル>` で読み取って作る(手で直さない)。
    `.prtextstyle`はXMLの中に、スタイルごとの文字の設定がFlatBuffers(型の定義が非公開)で入っているため、
    170種類を見比べて各数値の意味(文字色・縁取り・グラデーション・影/光・背景の箱)を割り出し、Premiereの画面の
    スクリーンショットと並べて合わせた(対応はスクリプトの先頭に書いてある)。省かれた値は初期値で、色は255(色ごと無ければ白)、
    グラデーションの角度は90(上→下)、影は濃さ75%・角度135°・距離7・ぼかし40。縁取りの太さと影の広がりは輪郭をまたぐ幅なので、
    文字の外に見えるのはその半分。影・光は何個も重ねられ、影ごとに「外側の縁取りと同じ形をずらしてぼかした層」で描く
    (ぼかしはPremiereの値の約8分の1をCSSのblurに渡すと見た目が合った)。
    書体は同じ書体の Noto Sans JP / Noto Serif JP(極太900を追加)に置き換える。
    縁取りは、文字をずらした影を輪のように並べて描く(`-webkit-text-stroke`は角が尖り、太い縁取りで角がトゲのように飛び出したため)。
    この描き方はブラウザ内の書き出し(`@remotion/web-renderer`)でも同じ見た目になることを確かめてある。
    長さはすべて文字の大きさに対する割合で持つので、どの大きさでも同じ見た目になる
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

## 学習データ(`data/style-examples/`・`data/edit-examples/`)

スタイル抽出と自動編集の手本(正解データ)は、リポジトリの`data/`にファイルとして入れてあり、アプリはそれを読むだけ。
登録・削除用の開発者ページ(`/dev/style-examples`・`/dev/edit-examples`)と、本番から手元へ取り込むスクリプトは
使わなくなったので廃止した。手本を変える時は`data/`のファイルを直接編集してgitコミットする。

## 環境変数

- `GEMINI_API_KEY` — 必須。Gemini APIキー(`.env.local`)
- `GEMINI_MODEL` — 任意。文字起こしに使うモデル。既定値は `gemini-flash-latest`
- `GEMINI_STYLE_MODEL` — 任意。参考画像/動画からのスタイル抽出に使うモデル。既定値は `gemini-pro-latest`
- `GEMINI_AUTO_EDIT_MODEL` — 任意。自動編集のプラン生成に使うモデル。既定値は `gemini-pro-latest`
- `GEMINI_TTS_MODEL` — 任意。AIナレーション生成に使うモデル。既定値は `gemini-3.8-flash-tts`
- `GEMINI_IMAGE_MODEL` — 任意。自動編集で足りない画像を作るモデル。既定値は `gemini-3.1-flash-image`
- `GEMINI_MIN_INTERVAL_MS` — 任意。テキスト系Gemini APIリクエスト間の最小間隔(既定1000ms。
  課金していないキーで動かす場合は6500程度に上げる)
- `GEMINI_TTS_MIN_INTERVAL_MS` — 任意。AIナレーション(TTS)リクエスト間の最小間隔(既定6500ms)
- `GOOGLE_MAPS_API_KEY` — 任意。`/insights`で使うGoogle Maps Platform(Places API)のAPIキー
- `NEXT_PUBLIC_REMOTION_LICENSE_KEY` — 任意。ブラウザ内書き出しに渡すRemotionのライセンスキー。
  Remotionの無料ライセンス(個人・少人数の会社)の対象なら `free-license`。未設定でも書き出せるが、
  ブラウザのコンソールに警告が出る

### Gemini APIの課金について

Gemini APIはプリペイド(上限800円)の有料プラン(Tier 1)で運用している。課金はAPIキー
(Google AI Studioのプロジェクト)単位なので、Render側で切り替える設定は無い(同じキーを
`GEMINI_API_KEY` に入れていれば有料枠が効く)。モデルの使い分けは以下の通り。

| 用途 | 既定モデル | 環境変数 |
| --- | --- | --- |
| 工程3・8・9(短くする)・10・12・14 | `gemini-pro-latest` | `GEMINI_STEP_MODEL` |
| 工程6(顔の位置)・手本選び | `gemini-flash-latest` | `GEMINI_MODEL` |
| スタイル抽出(スクショ・参考動画) | `gemini-pro-latest` | `GEMINI_STYLE_MODEL` |
| 文字起こし | `gemini-flash-latest` | `GEMINI_MODEL` |
| AIナレーション | `gemini-3.8-flash-tts` | `GEMINI_TTS_MODEL` |

残高を使い切ると画面に
「AI Studioでチャージしてください」と表示される。

## デプロイ(Render.com)

`Dockerfile` と `render.yaml` を用意済みで、Render.comの Blueprint機能でデプロイできる。

1. Renderダッシュボードで **New +** → **Blueprint** から、このGitHubリポジトリを接続
2. `render.yaml` が自動検出され、Freeプランの Web Service(Dockerビルド)が構成される
3. 環境変数(`GEMINI_API_KEY`など、上記の「環境変数」参照)を入力してデプロイ

`next.config.ts` を見ると分かる通り `output: "standalone"` は使わず、`node_modules`
全体を含めるシンプルな構成にしている(`@remotion/bundler`/`@remotion/renderer`が
プラットフォーム別ネイティブバイナリを動的requireで解決しており、standaloneのファイル
トレースだと正しく検出できずランタイムでENOENTになる恐れがあるため)。

`Dockerfile` は組み立て用と実行用の2段に分けている。以前は1段で、開発用の道具・ビルドキャッシュ・
サーバー書き出し用のChromium(約700MB)・ヘッドレスChrome・Remotionバンドルまで本番に入っており、
イメージが約4.8GBあった。これにアップロード動画が加わってRenderの無料枠(5GB)を使い切り、
サービスが止められたため、実行用には `npm prune --omit=dev` 後の `node_modules`・`.next`(キャッシュ除く)・
`public`・`data` だけを入れるようにした(約2.4GB、手元の `docker images` 表示)。書き出しはブラウザ内で
行うので、本番ではサーバー書き出し(`/api/render`)は使えない(ローカルの `npm run dev` では使える)。
起動は `npx` を通さず `node node_modules/next/dist/bin/next start` で行い、npm自体のプロセス分
(約75MB)のメモリを節約している(起動直後で約140MB)。

Freeプランはメモリが少なく(512MB)、ヘッドレスChromeでの動画レンダリングが重い。
38秒・12クリップ(寄り・強調テキスト入り)の書き出しを本番と同じ構成で手元実行したところ、
子プロセス込みの実メモリ(PSS)は最大約1.5GB、所要時間は約400秒だった(2026-09-24計測)。
動画キャッシュを128MBに抑える等の対策はしているが、512MBには収まらない見込みが高く、
書き出し中にサーバーが落ちると画面には「サーバーから正しい応答がありませんでした」と出る
(Safariでは以前 "The string did not match the expected pattern." と出ていたもの)。
プランは上げない方針のため、画面からの書き出しはブラウザ内で行う(手順6参照)。また無操作が続くとスリープし、次のアクセス時に
再起動で数十秒かかる。

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).
