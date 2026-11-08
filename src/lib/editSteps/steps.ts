/**
 * 工程ごとに編集の工程の一覧。画面(StepsScreen.tsx・"use client")と、工程のページ(サーバーで描く)の両方から読むので、
 * 画面のファイルとは分けて置く("use client"のファイルの値は、サーバー側からは読めないため)。
 */
/** 編集マニュアルの工程(番号・名前・中身)。AIを使う工程には印を付ける(料金と待ち時間がかかる)。 */
export const EDIT_STEPS: { step: number; title: string; detail: string; usesAi: boolean }[] = [
  { step: 1, title: "使う範囲を並べる", detail: "使う範囲を選ぶ画面で残した部分を、順に並べます", usesAi: false },
  { step: 2, title: "話し始める前のいらない所を切る", detail: "音声から話し始めを見つけて、その前を切ります", usesAi: false },
  { step: 3, title: "言い間違いや、言葉に詰まった所を切る", detail: "言い直す前の言葉や「えーと」をAIが見つけて切ります", usesAi: true },
  { step: 4, title: "話の間の長い無音を切る", detail: "0.5秒以上の無音を、前後に少し余白を残して切ります", usesAi: false },
  { step: 5, title: "切れ目を自然につなぐ", detail: "切れ目を言葉の途切れに合わせ、ちらつく短い切れ端を外します", usesAi: false },
  { step: 6, title: "映像を拡大して、人の位置を整える", detail: "AIが顔の位置を調べ、顔が中央より少し高めに来るよう拡大します", usesAi: true },
  { step: 7, title: "字幕の位置を決める", detail: "話す人の顎より少し下に、顔と重ならないよう固定します", usesAi: false },
  { step: 8, title: "左上のタイトルと、ランキングの枠を作る", detail: "左上のタイトルと、ランキングの動画なら枠をAIが決めて作ります(手本も見せます)", usesAi: true },
  { step: 9, title: "字幕を入れる", detail: "話している言葉をAIが書き起こして入れます(位置は工程7で固定)", usesAi: true },
  { step: 10, title: "大事な言葉を、目立つ字幕に変える", detail: "AIが強調したい言葉を選び、強調した字幕にします(手本も見せます)", usesAi: true },
  { step: 11, title: "目立つ字幕に、効果音と少しの寄りを付ける", detail: "強調した字幕に効果音と、少しの寄りを付けます", usesAi: false },
  { step: 12, title: "決めた長さに収める(長い時だけ)", detail: "長さの上限を入れた時だけ、超えた分をAIが前置きや繰り返しの場面から外します(空なら動画の長さのまま)", usesAi: true },
  { step: 13, title: "BGMを入れる(なくてもよい)", detail: "選んだ曲を、話し声より小さな音量で頭から入れ、最後に音量を下げて終わらせます", usesAi: false },
  { step: 14, title: "チェック項目を確かめる", detail: "出す前に確かめる項目(チェック項目)を確かめます。光の補正は明るさを測って自動で行い、誤字・脱字はAIが音声と見比べます", usesAi: true },
];
