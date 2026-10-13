import type { ClipZoom, FaceBox } from "@video/shared/schema";

/**
 * カメラワーク(クリップごとの寄り)のルール。動画の形式ごとに、どこで・どのくらい寄るかを決まった手順で付ける。
 * 寄りをAIに任せていた頃は、同じ形式の動画でも回によって寄りの量がばらつき、ランキングで寄りすぎて落ち着かないことがあった。
 * AIには「山場(順位の発表・結論など)はどこか」だけを判断させ(cameraHighlight)、寄り方はここで決める。
 * 寄る中心は顔(faceBox)にして、寄っても顔が切れないようにする。
 * 自動編集(サーバー)と編集画面の「付け直す」(ブラウザ)の両方から使うので、"use client"を付けない素の関数にしている。
 */
export type CameraRuleId = "ranking" | "two-choice" | "calm" | "lively" | "ai";

export const CAMERA_RULES: { id: CameraRuleId; label: string; description: string }[] = [
  { id: "ranking", label: "ランキング向け(控えめ)", description: "順位の発表など山場だけ少し寄る。ほかは動かさない" },
  { id: "two-choice", label: "2択・比較向け(適度)", description: "山場で寄り、話の間にもゆっくり寄る・横に流す動きを時々入れる" },
  { id: "calm", label: "落ち着いた動画向け", description: "山場だけ、じわじわ寄る" },
  { id: "lively", label: "にぎやかな動画向け", description: "山場で強めに寄り、話の間にも時々寄る" },
  { id: "ai", label: "AIが決めた寄りのまま", description: "自動編集のAIが付けた寄りをそのまま使う" },
];

/** テンプレート(editTemplates.ts)ごとの、既定のカメラワークのルール。 */
export const DEFAULT_CAMERA_RULE_BY_TEMPLATE: Record<string, CameraRuleId> = {
  ranking: "ranking",
  "two-choice": "two-choice",
  explainer: "calm",
  vlog: "calm",
  story: "calm",
  kirinuki: "lively",
  "high-tension": "lively",
};

export const findCameraRule = (id: string | null | undefined): CameraRuleId | null =>
  CAMERA_RULES.find((rule) => rule.id === id)?.id ?? null;

/** テンプレートから既定のルールを決める。おまかせ(テンプレート無し)はAIの寄りのまま。 */
export const cameraRuleForTemplate = (templateId: string | null | undefined): CameraRuleId =>
  (templateId ? DEFAULT_CAMERA_RULE_BY_TEMPLATE[templateId] : undefined) ?? "ai";

export type CameraRuleClip = {
  durationInSeconds: number;
  zoom?: ClipZoom;
  faceBox?: FaceBox;
  cameraHighlight?: boolean;
};

/** 寄りを入れない短いクリップ(秒)。短いカットで寄ると、画面がガタついて見える。 */
const MIN_ZOOM_CLIP_SECONDS = 1;
/** 山場ではないクリップに入れる動きの間隔(この秒数ごとに1回まで)。 */
const AMBIENT_INTERVAL_SECONDS: Partial<Record<CameraRuleId, number>> = { "two-choice": 6, lively: 5 };

const focusOf = (clip: CameraRuleClip): { focusXPercent: number; focusYPercent: number } =>
  clip.faceBox
    ? { focusXPercent: clip.faceBox.xPercent, focusYPercent: clip.faceBox.yPercent }
    : { focusXPercent: clip.zoom?.focusXPercent ?? 50, focusYPercent: clip.zoom?.focusYPercent ?? 40 };

/**
 * ルールに沿って、クリップごとの寄りを決め直す(クリップと同じ順の配列で返す。寄らないクリップはundefined)。
 * 同じ入力なら毎回同じ結果になる(AIを使わない)。
 */
export const applyCameraRule = (ruleId: CameraRuleId, clips: CameraRuleClip[]): (ClipZoom | undefined)[] => {
  if (ruleId === "ai") return clips.map((clip) => clip.zoom);
  const interval = AMBIENT_INTERVAL_SECONDS[ruleId];
  let elapsed = 0;
  // 冒頭も間隔の分は動かさない(山場ではない動きを、最初のクリップからいきなり入れない)
  let lastMoveEnd = 0;
  let ambientCount = 0;
  return clips.map((clip, index) => {
    const start = elapsed;
    elapsed += clip.durationInSeconds;
    const previousMoved = index > 0 && lastMoveEnd === start;
    if (clip.durationInSeconds < MIN_ZOOM_CLIP_SECONDS) return undefined;
    const focus = focusOf(clip);
    let zoom: ClipZoom | undefined;
    if (clip.cameraHighlight) {
      zoom =
        ruleId === "ranking"
          ? { scale: 1.15, style: "punch", ...focus }
          : ruleId === "calm"
            ? { scale: 1.12, style: "slow", ...focus }
            : ruleId === "lively"
              ? { scale: 1.25, style: "punch", ...focus }
              : { scale: 1.2, style: "punch", ...focus };
    } else if (interval !== undefined && !previousMoved && start - lastMoveEnd >= interval && clip.durationInSeconds >= 1.5) {
      // 山場ではない所の動き。続けて動かさず、間隔を空けて入れる。2択は「ゆっくり寄る」と「横に流す」を交互にする
      zoom =
        ruleId === "two-choice" && ambientCount % 2 === 1
          ? { scale: 1.1, style: "pan", ...focus }
          : { scale: 1.1, style: "slow", ...focus };
      ambientCount++;
    }
    if (zoom) lastMoveEnd = elapsed;
    return zoom;
  });
};
