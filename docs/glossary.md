# 用語集(UI表示 ⇔ コード上の識別子)

修正依頼はUI上の言葉(「テロップ」「使う範囲」等)で来ることが多いが、コード上では
画面や層(編集用state / Remotion描画用スキーマ)ごとに**別の型・別の名前**が使われている
箇所がある。ここではその対応を一覧化する。

## クリップ・字幕まわり

| UI上の表現 | 意味 | コード上の名前 | 補足 |
|---|---|---|---|
| 使う範囲 | ラフカット(`/create/cut`)で残した、元動画のうち実際に使う部分 | `ProjectSegment[]`(採用前) → 最終的に `segments` | カットで捨てた範囲はスタイル抽出・字幕生成の対象外(README参照) |
| クリップ | `/edit` で編集する個々の区間(トリム・字幕・演出・音量を持つ) | `ProjectSegment`([videoProject.ts](../src/lib/videoProject.ts)) | 編集画面での内部表現。`key` で識別、配列順=再生順 |
| (レンダー時の)カット | Remotionが実際に描画する1区間 | `clip`(`StandardVideoProps.clips`、[schema.ts](../remotion/templates/standard/schema.ts)の`mediaItemBaseSchema`) | `ProjectSegment` とはほぼ1対1だが**別の型**。`buildStandardVideoProps()` が変換する(architecture.md参照) |
| テロップ | 画面に重ねる字幕文言 | `caption` | `ProjectSegment.caption` / `mediaItemBaseSchema.caption` 共通 |
| テロップの出現演出 | テロップが表示される際のアニメーション(9種) | `captionAnimation` / 型 `CaptionAnimation` | 定義は [remotion/shared/schema.ts](../remotion/shared/schema.ts)、実装は `remotion/shared/captionAnimations.ts` |
| テロップの見た目(カラー背景 / 縁取り文字) | 字幕のスタイル | `captionStyle` / 型 `CaptionStyle`(`"pill" \| "outline"`) | `pill`=カラー背景の角丸ボックス、`outline`=背景無し+縁取り文字 |
| テロップ位置 | 画面上下どこに出すか | `captionPosition`(`"top" \| "middle" \| "bottom"`) | |
| 文字サイズ | テロップの大きさ | `fontSize` / 型 `CaptionFontSize`(`"small" \| "medium" \| "large"`) | 実際の倍率は `CAPTION_FONT_SIZE_SCALE` |
| フォント(15書体) | テロップに使うフォント | `fontFamily` / 型 `CaptionFontFamily` | 一覧は `CAPTION_FONT_FAMILY_OPTIONS`。読み込みは `remotion/shared/font.ts`(ローカル同梱、Google Fonts CDN非依存) |
| クリップごとの音量 | そのクリップの元動画音声の音量(ミュート含む) | `volume`(0=ミュート, 1=等倍, 2=倍量) | `ProjectSegment.volume` / `mediaItemBaseSchema.volume` |
| 分割 / トリミング / イン点・アウト点 | ラフカット・クリップ編集の編集操作 | `timelineUtils.ts` の関数群 | `/edit`(`ClipEditor`)と `/create/cut`(`CutEditor`)で共有 |

## 音声(SE・BGM・ナレーション)

| UI上の表現 | 意味 | コード上の名前 |
|---|---|---|
| SE(効果音) | 個別に配置する効果音クリップ(最大30個) | `ProjectSfxClip` / `sfxClipSchema` |
| BGM | 全体に流すBGM(音量・フェード・ループ) | `ProjectBgm` / `bgmSchema` |
| AIナレーション | テロップをAI音声で読み上げたもの | `generateVoiceover`([src/lib/gemini/generateVoiceover.ts](../src/lib/gemini/generateVoiceover.ts))。生成結果はSEやBGMと同様に音声ファイルとして扱われる |

## 画面・機能単位

| UI上の表現 | 意味 | 対応するコード |
|---|---|---|
| アップロード画面 | `/create` | `src/app/create/UploadGenerator.tsx` |
| ラフカット画面 | `/create/cut` | `src/components/editor/CutEditor.tsx` |
| 参考画像・動画・字幕生成画面 | `/create/style` | `src/app/create/style/StyleAndTranscribe.tsx` |
| クリップ編集画面 | `/edit`(動画カット/字幕/SE/AI音声/BGM/スタイルの6タブ) | `src/components/editor/ClipEditor.tsx` |
| 書き出し画面 | `/edit/export` | `src/components/editor/ExportScreen.tsx` |
| お店のクチコミを見る | `/insights`(動画編集とは別機能) | `src/app/insights/InsightsExplorer.tsx` |
| ジョブ | Gemini呼び出し・レンダリングなど時間のかかる処理の進捗管理単位 | architecture.mdの「非同期ジョブ+ポーリングのパターン」参照 |

## 注意: 「クリップ」の二重性

「クリップ」という言葉は UI・会話上では `ProjectSegment`(編集中の状態)を指すことが多いが、
Remotion側のスキーマでは `clip`(`StandardVideoProps.clips` の要素)という別の型で存在する。
**修正依頼が「クリップの◯◯を直したい」という場合、それが編集画面の見た目/操作の話なら
`ProjectSegment` 側、書き出し結果(実際の動画)の話なら `StandardVideoProps.clips` 側を
まず疑う。** 両者は `buildStandardVideoProps()` でしか変換されないため、片方だけ直すと
プレビューと書き出し結果がずれる典型パターンになる。
