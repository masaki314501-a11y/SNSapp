/**
 * 工程ごとに編集の工程の一覧。画面(StepsScreen.tsx・"use client")と、工程のページ(サーバーで描く)の両方から読むので、
 * 画面のファイルとは分けて置く("use client"のファイルの値は、サーバー側からは読めないため)。
 */
/** 編集マニュアルの工程(番号・名前・中身)。AIを使う工程には印を付ける(料金と待ち時間がかかる)。 */
export const EDIT_STEPS: { step: number; title: string; detail: string; usesAi: boolean }[] = [
  { step: 1, title: "メイン映像を配置する", detail: "使う範囲を選ぶ画面で残した部分を、順に並べます", usesAi: false },
  { step: 2, title: "話し始める前の不要な部分を削除する", detail: "音声から話し始めを見つけて、その前を切ります", usesAi: false },
  { step: 3, title: "言い間違いや言葉に詰まった部分をカットする", detail: "言い直す前の言葉や「えーと」をAIが見つけて切ります", usesAi: true },
  { step: 4, title: "説明の間にある長い無音部分を削除する", detail: "0.5秒以上の無音を、前後に少し余白を残して切ります", usesAi: false },
  { step: 5, title: "話の流れが自然になるように前後の映像をつなぐ", detail: "切れ目を言葉の途切れに合わせ、ちらつく短い切れ端を外します", usesAi: false },
  { step: 6, title: "映像を拡大し、人物の位置を整える", detail: "AIが顔の位置を調べ、顔が中央より少し高めに来るよう拡大します", usesAi: true },
  { step: 7, title: "テロップの位置を決める", detail: "演者の顎より少し下に、演者と被らないよう固定します", usesAi: false },
  { step: 8, title: "必要なオブジェクトを作成する", detail: "左上のタイトルと、ランキングの動画なら枠をAIが決めて作ります(手本も見せます)", usesAi: true },
  { step: 9, title: "テロップを入力する", detail: "話している言葉をAIが書き起こして入れます(位置は工程7で固定)", usesAi: true },
  { step: 10, title: "強調したい言葉を違うテロップに変換する", detail: "AIが強調したい言葉を選び、強調テロップにします(手本も見せます)", usesAi: true },
  { step: 11, title: "強調テロップに効果音をつけ、少し人物を拡大する", detail: "強調テロップに効果音と、少しの寄りを付けます", usesAi: false },
  { step: 12, title: "決めた長さに収める(長い時だけ)", detail: "長さの上限を入れた時だけ、超えた分をAIが前置きや繰り返しの場面から外します(空なら動画の長さのまま)", usesAi: true },
  { step: 13, title: "BGMを入れる(なくてもよい)", detail: "選んだ曲を、話し声より小さな音量で頭から入れ、最後に音量を下げて終わらせます", usesAi: false },
  { step: 14, title: "チェック項目を確かめる", detail: "編集時チェック項目を確かめます。光の補正は明るさを測って自動で行い、誤字・脱字はAIが音声と見比べます", usesAi: true },
];
