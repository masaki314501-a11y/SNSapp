# システム説明(Clipcraft システム地図)

SNSapp(画面上の名前: Clipcraft)の全体像をまとめたページです。

**リンク: https://claude.ai/artifact/CtYm69wQucZFgERFfSHRsx**

> 非公開のページです。見られるのは所有者と、所有者が共有した人だけです。ほかの人に見せる場合は、ページの共有メニューから共有してください。

## 載っている内容

- ページ一覧と画面の移り変わり
- 各画面の機能と、操作できる部品(ボタン・タブ・タイムライン・キーボードショートカット)
- データの流れ(入力元 → 処理 → 保存先・出力先)と、データが消えるタイミング
- 外部サービス(Gemini、Google Places、Remotion、Render.com)と、無料枠・料金・ライセンス
- 生成AIの呼び出し箇所(ファイル・関数・APIルート・モデル・目的)
- 開発者向けツール(`/dev/*`)
- 調査で見つかった注意点(ドキュメントとの食い違い、無料枠の制約とぶつかる点など)

各節は「非エンジニア向けの概要」と「開発者向け詳細(折りたたみ)」の二段構成です。

## 説明している時点

- 対象: `origin/main` のコミット `7170a48`(2026-09-25 時点)
- 未マージのブランチ(例: `feature/gemini-additional-token-savings` の Groq への移行)の内容は含みません

## 元にした資料

- 調査計画: [system-overview/plan.md](system-overview/plan.md)
- 外部サービスの無料枠・ライセンスの確認: [research/system-overview-external-services.md](research/system-overview-external-services.md)

## 更新するときは

コードが変わったらページも古くなります。更新するときは、`plan.md` の調査タスクA〜Dを最新の main でやり直し、同じURLのページを上書き公開してください(Claude Code で、このURLを指定して更新を依頼する)。
