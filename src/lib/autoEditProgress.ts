/**
 * 自動編集の進み具合(今どの段階か)。サーバー(autoEditPlan.ts)が段階を進め、画面(AutoEditScreen.tsx)が一覧で見せる。
 * 数分かかる処理で「目安と経過時間」だけだと、詳しくない人は固まったと思いやすかったため、実際の段階を見せる。
 * 画面とサーバーの両方から読むので、"use client"を付けない素のデータにしている。
 */
export type AutoEditStage = "reading" | "examples" | "planning" | "images" | "finishing";

export type AutoEditProgress = {
  stage: AutoEditStage;
  /** 画像を用意している時の、用意できた数と全体の数。 */
  done?: number;
  total?: number;
};

export const AUTO_EDIT_STAGES: { stage: AutoEditStage; label: string }[] = [
  { stage: "reading", label: "動画を読み込んでいます" },
  { stage: "examples", label: "お手本を選んでいます" },
  { stage: "planning", label: "編集を考えています(いちばん時間がかかります)" },
  { stage: "images", label: "画像を用意しています" },
  { stage: "finishing", label: "仕上げています" },
];

/** 手直しでは、お手本を選び直さない。 */
export const stagesFor = (isRevision: boolean) =>
  isRevision ? AUTO_EDIT_STAGES.filter((entry) => entry.stage !== "examples") : AUTO_EDIT_STAGES;
