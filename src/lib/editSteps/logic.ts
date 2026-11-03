import type {
  CaptionFontSize,
  CaptionStyle,
  ClipZoom,
  FaceBox,
  ShapeOverlay,
  TextOverlay,
  VideoFraming,
} from "@video/shared/schema";
import type { ProjectSegment } from "@/lib/videoProject";
import { captionBox, faceOnScreen } from "@/lib/gemini/autoEditPlan";

/**
 * 工程ごとの編集(編集マニュアルの1〜11)のうち、AIを使わず決まりで行う処理。
 * AIにまとめて任せると工程ごとの誤差が大きかったため、機械的にできる所は音声の解析と計算だけで決める。
 * 秒数はすべて元の動画の秒数(segment.startFromSeconds〜)で扱う。
 */

/** 工程ごとに受け渡す編集の状態(プロジェクトのうち、工程で変わる所だけ)。 */
export type StepState = {
  segments: ProjectSegment[];
  framing: VideoFraming | null;
  captionYPercent: number | null;
  globalShapes: ShapeOverlay[];
  globalOverlays: TextOverlay[];
};

/** 工程の結果(先方の確認用の説明)。 */
export type StepResult = { note: string; details?: string[]; at: string };
/** 工程ごとの結果と、その工程を終えた時点の状態(やり直す時は、1つ前の工程の状態から始める)。 */
export type EditStepsRecord = { results: Record<number, StepResult>; snapshots: Record<number, StepState> };

/** 話している区間(元の動画の秒数)。 */
export type SpeechSpan = [number, number];

const round2 = (value: number) => Math.round(value * 100) / 100;
const segmentEnd = (segment: ProjectSegment) => segment.startFromSeconds + segment.durationInSeconds;

/** 新しいクリップを作る(字幕・演出は空)。keyは呼び出し側で決める(サーバーとテストで作り方が違うため)。 */
const makeSegment = (key: string, start: number, end: number, base?: ProjectSegment): ProjectSegment => ({
  ...(base ?? { caption: "", captionAnimation: "pop", volume: 1 }),
  key,
  startFromSeconds: round2(start),
  durationInSeconds: round2(end - start),
});

/** 1. メイン映像を配置する: カット画面で残した範囲を、そのまま順に並べる。 */
export const placeMainFootage = (
  keepRanges: { startFromSeconds: number; durationInSeconds: number }[],
  newKey: () => string
): ProjectSegment[] =>
  keepRanges
    .filter((range) => range.durationInSeconds > 0)
    .map((range) => makeSegment(newKey(), range.startFromSeconds, range.startFromSeconds + range.durationInSeconds));

/** 話し始めの少し前から残す余白(秒)。ぴったり切ると、最初の音が欠けて聞こえる。 */
const LEAD_IN_SECONDS = 0.15;

/**
 * 2. 話し始める前の不要な部分を削除する: 最初に話し始める所より前を切る。
 * 話し声の無いクリップが先頭に続く時は、そのクリップごと外す。
 */
export const trimBeforeSpeech = (segments: ProjectSegment[], spans: SpeechSpan[]): { segments: ProjectSegment[]; removedSeconds: number } => {
  const result = [...segments];
  let removedSeconds = 0;
  while (result.length > 0) {
    const first = result[0];
    const speech = spans.find(([start, end]) => end > first.startFromSeconds && start < segmentEnd(first));
    if (!speech) {
      removedSeconds += first.durationInSeconds;
      result.shift();
      continue;
    }
    const newStart = Math.max(first.startFromSeconds, speech[0] - LEAD_IN_SECONDS);
    removedSeconds += newStart - first.startFromSeconds;
    result[0] = { ...first, startFromSeconds: round2(newStart), durationInSeconds: round2(segmentEnd(first) - newStart) };
    break;
  }
  return { segments: result, removedSeconds: round2(removedSeconds) };
};

/** クリップ列から、元の動画の秒数の範囲を取り除く(範囲にかかるクリップは前後に分ける)。 */
export const removeRanges = (
  segments: ProjectSegment[],
  ranges: { start: number; end: number }[],
  newKey: () => string,
  minSeconds = 0.2
): ProjectSegment[] => {
  const sorted = [...ranges].filter((range) => range.end > range.start).sort((a, b) => a.start - b.start);
  return segments.flatMap((segment) => {
    let pieces: [number, number][] = [[segment.startFromSeconds, segmentEnd(segment)]];
    for (const range of sorted) {
      pieces = pieces.flatMap(([start, end]): [number, number][] => {
        if (range.end <= start || range.start >= end) return [[start, end]];
        return [
          ...(range.start > start ? [[start, range.start] as [number, number]] : []),
          ...(range.end < end ? [[range.end, end] as [number, number]] : []),
        ];
      });
    }
    return pieces
      .filter(([start, end]) => end - start >= minSeconds)
      .map(([start, end], index) => (index === 0 && start === segment.startFromSeconds && end === segmentEnd(segment)
        ? segment
        : makeSegment(index === 0 ? segment.key : newKey(), start, end, segment)));
  });
};

/** 長い無音とみなす長さ(秒)と、無音を切る時に言葉の前後へ残す余白(秒)。 */
const LONG_SILENCE_SECONDS = 0.5;
const SILENCE_PAD_SECONDS = 0.12;

/** 4. 説明の間にある長い無音部分を削除する: 話している区間の間が0.5秒以上空いている所を、前後に少し余白を残して切る。 */
export const removeLongSilences = (
  segments: ProjectSegment[],
  spans: SpeechSpan[],
  newKey: () => string
): { segments: ProjectSegment[]; count: number; removedSeconds: number } => {
  const gaps: { start: number; end: number }[] = [];
  for (const segment of segments) {
    const inside = spans
      .filter(([start, end]) => end > segment.startFromSeconds && start < segmentEnd(segment))
      .map(([start, end]): SpeechSpan => [Math.max(start, segment.startFromSeconds), Math.min(end, segmentEnd(segment))]);
    for (let i = 0; i + 1 < inside.length; i++) {
      const gapStart = inside[i][1] + SILENCE_PAD_SECONDS;
      const gapEnd = inside[i + 1][0] - SILENCE_PAD_SECONDS;
      if (inside[i + 1][0] - inside[i][1] >= LONG_SILENCE_SECONDS && gapEnd > gapStart) gaps.push({ start: gapStart, end: gapEnd });
    }
    // 最後に話し終えてからクリップの終わりまでの無音も切る
    const last = inside.at(-1);
    if (last && segmentEnd(segment) - last[1] >= LONG_SILENCE_SECONDS) {
      gaps.push({ start: last[1] + SILENCE_PAD_SECONDS, end: segmentEnd(segment) });
    }
  }
  return {
    segments: removeRanges(segments, gaps, newKey),
    count: gaps.length,
    removedSeconds: round2(gaps.reduce((sum, gap) => sum + gap.end - gap.start, 0)),
  };
};

/** これより短いクリップは、つないだ時に一瞬のちらつきになるので外す(秒)。 */
const MIN_JOINED_SECONDS = 0.3;

/**
 * 5. 話の流れが自然になるように前後の映像をつなぐ: 切れ目を近くの一番静かな所へ寄せ(言葉の途中で切らない)、
 * ちらつきになる短すぎるクリップを外し、元の動画で続いているクリップはひとつにまとめる。
 */
export const smoothJoins = (
  segments: ProjectSegment[],
  snap: (seconds: number) => number
): { segments: ProjectSegment[]; snapped: number; dropped: number; merged: number } => {
  let snapped = 0;
  const moved = segments.map((segment, index) => {
    // 先頭の入りは工程2で決めたので動かさない
    const start = index === 0 ? segment.startFromSeconds : snap(segment.startFromSeconds);
    const end = snap(segmentEnd(segment));
    if (start !== segment.startFromSeconds) snapped++;
    if (end !== segmentEnd(segment)) snapped++;
    return { ...segment, startFromSeconds: round2(start), durationInSeconds: round2(end - start) };
  });
  const kept = moved.filter((segment) => segment.durationInSeconds >= MIN_JOINED_SECONDS);
  const result: ProjectSegment[] = [];
  let merged = 0;
  for (const segment of kept) {
    const previous = result.at(-1);
    if (previous && Math.abs(segment.startFromSeconds - segmentEnd(previous)) < 0.05) {
      result[result.length - 1] = { ...previous, durationInSeconds: round2(segmentEnd(segment) - previous.startFromSeconds) };
      merged++;
    } else {
      result.push(segment);
    }
  }
  return { segments: result, snapped, dropped: moved.length - kept.length, merged };
};

/** 顔の中心を置く高さ(画面の上からの%)。編集マニュアル: 人物の顔は中央より少し高めに。 */
export const FACE_TARGET_Y_PERCENT = 40;
/** これより顔が低ければ寄せる(%)。 */
const FACE_LOW_Y_PERCENT = 45;
const MAX_FRAMING_SCALE = 1.4;

/**
 * 6. 映像を拡大し、人物の位置を整える: 顔の中心が画面の中央より少し上(縦40%)に来るように寄せる。
 * 寄せは「ある点を中心に拡大する」形なので、顔が上へ動くような中心を、倍率を少しずつ上げながら探す。
 * 顔がもう十分高ければ寄せない(null)。
 */
export const framingForFace = (face: FaceBox): VideoFraming | null => {
  if (face.yPercent <= FACE_LOW_Y_PERCENT) return null;
  for (let scale = 1.15; scale <= MAX_FRAMING_SCALE + 1e-9; scale += 0.05) {
    // 拡大の中心focusYのとき、顔はfocusY + (face.y - focusY) * scale に動く。それが目標の高さになる中心を求める
    const focusY = (scale * face.yPercent - FACE_TARGET_Y_PERCENT) / (scale - 1);
    if (focusY >= 0 && focusY <= 100) {
      return { scale: round2(scale), focusXPercent: round2(face.xPercent), focusYPercent: round2(focusY) };
    }
  }
  return { scale: MAX_FRAMING_SCALE, focusXPercent: round2(face.xPercent), focusYPercent: 100 };
};

/** 字幕を顎からどれだけ下げるか(%)と、字幕の下端の限界(%。下の決まった位置と同じ)。 */
const CHIN_GAP_PERCENT = 1;
const CAPTION_LOWEST_BOTTOM_PERCENT = 100 - (160 / 1920) * 100;

/**
 * 7. テロップの位置を決める: 演者の顎より少し下に、動画全体で固定する(演者とテロップが被らない)。
 * 顎の下に字幕が収まらない時はnull(下の決まった位置を使う)。
 */
export const chinCaptionY = (
  face: FaceBox,
  framing: VideoFraming | null,
  look: { style: CaptionStyle; fontSize: CaptionFontSize },
  sampleText = "テロップの高さの見本\n2行目"
): number | null => {
  const chin = faceOnScreen(face, framing, undefined).bottom;
  const y = Math.round((chin + CHIN_GAP_PERCENT) * 10) / 10;
  const band = captionBox(sampleText, "top", look.style, look.fontSize);
  return y + (band.bottom - band.top) <= CAPTION_LOWEST_BOTTOM_PERCENT ? y : null;
};

/** 左上のタイトルの位置・大きさ(%・px)。 */
const TITLE_STYLE = { xPercent: 4, yPercent: 7, fontSizePx: 64 } as const;
/** ランキングの枠の並べ方: 画面の左側に縦に並べる(%)。 */
const FRAME_X_PERCENT = 20;
const FRAME_WIDTH_PERCENT = 30;
const FRAME_GAP_PERCENT = 1.5;

/**
 * 8. 必要なオブジェクトを作る: 左上のタイトルテロップと、ランキングの枠(N個を左に縦に並べ、番号を付ける)。
 * 枠は、タイトルの下からテロップの帯の上まで(テロップと被らないように)に収める。
 */
export const buildObjects = (params: {
  title: string;
  frameCount: number;
  captionTopPercent: number;
  accentColor: string;
}): { globalOverlays: TextOverlay[]; globalShapes: ShapeOverlay[] } => {
  const title: TextOverlay = {
    text: params.title,
    startOffsetSeconds: 0,
    xPercent: TITLE_STYLE.xPercent,
    yPercent: TITLE_STYLE.yPercent,
    textAlign: "left",
    fontSizePx: TITLE_STYLE.fontSizePx,
    color: "#FFFFFF",
    strokeColor: "#000000",
    rotationDeg: 0,
    animation: "fade",
  };
  // 左寄せの文字は、xPercentを文字の中心として扱う描画に合わせ、文字幅の半分だけ右へずらす
  const titleWidthPercent = (Math.max(...params.title.split("\n").map((line) => line.length)) * TITLE_STYLE.fontSizePx * 100) / 1080;
  title.xPercent = round2(TITLE_STYLE.xPercent + titleWidthPercent / 2);
  if (params.frameCount < 2) return { globalOverlays: [title], globalShapes: [] };

  const titleLines = params.title.split("\n").length;
  const top = TITLE_STYLE.yPercent + (titleLines * TITLE_STYLE.fontSizePx * 1.3 * 100) / 1920 / 2 + 3;
  const bottom = params.captionTopPercent - 2;
  const frameHeight = (bottom - top - FRAME_GAP_PERCENT * (params.frameCount - 1)) / params.frameCount;
  const shapes: ShapeOverlay[] = [];
  const labels: TextOverlay[] = [];
  for (let i = 0; i < params.frameCount; i++) {
    const y = round2(top + frameHeight / 2 + i * (frameHeight + FRAME_GAP_PERCENT));
    shapes.push({
      kind: "rect",
      startOffsetSeconds: 0,
      xPercent: FRAME_X_PERCENT,
      yPercent: y,
      widthPercent: FRAME_WIDTH_PERCENT,
      heightPercent: round2(frameHeight),
      borderColor: params.accentColor,
      borderWidthPx: 6,
      fillColor: "#FFFFFF",
      fillOpacity: 0.85,
      cornerRadiusPx: 16,
      animation: "fade",
    });
    labels.push({
      text: String(i + 1),
      startOffsetSeconds: 0,
      xPercent: FRAME_X_PERCENT - FRAME_WIDTH_PERCENT / 2 + 3,
      yPercent: y,
      fontSizePx: Math.max(32, Math.min(56, Math.round((frameHeight / 100) * 1920 * 0.45))),
      color: params.accentColor,
      rotationDeg: 0,
      animation: "fade",
    });
  }
  return { globalOverlays: [title, ...labels], globalShapes: shapes };
};

/** 書き起こした字幕のかたまり(元の動画の秒数)。 */
export type CaptionPhrase = { start: number; end: number; text: string };

/**
 * 9. テロップを入力する: 書き起こした字幕のかたまりごとにクリップを分け、それぞれに字幕を入れる(位置は工程7で固定)。
 * 短すぎるかたまり(0.3秒未満)は、前のクリップにまとめる。
 */
export const splitByCaptions = (segments: ProjectSegment[], phrases: CaptionPhrase[], newKey: () => string): ProjectSegment[] =>
  segments.flatMap((segment) => {
    const start = segment.startFromSeconds;
    const end = segmentEnd(segment);
    const inside = phrases
      .filter((phrase) => phrase.end > start && phrase.start < end && phrase.text.trim())
      .map((phrase) => ({ start: Math.max(phrase.start, start), end: Math.min(phrase.end, end), text: phrase.text.trim() }));
    if (inside.length === 0) return [{ ...segment, caption: "" }];
    // クリップの頭と終わりまで隙間なく埋める(かたまりの間の短い間は前のかたまりに含める)
    const pieces: CaptionPhrase[] = [];
    for (const [index, phrase] of inside.entries()) {
      const pieceStart = index === 0 ? start : phrase.start;
      const pieceEnd = index === inside.length - 1 ? end : inside[index + 1].start;
      const previous = pieces.at(-1);
      if (previous && pieceEnd - pieceStart < MIN_JOINED_SECONDS) {
        previous.end = pieceEnd;
        previous.text = `${previous.text}${phrase.text}`;
      } else {
        pieces.push({ start: pieceStart, end: pieceEnd, text: phrase.text });
      }
    }
    return pieces.map((piece, index) => ({
      ...makeSegment(index === 0 ? segment.key : newKey(), piece.start, piece.end, segment),
      caption: piece.text,
      speechText: piece.text,
    }));
  });

/** 強調テロップの見た目の初期値(白い帯に黒い文字)と、鳴らす効果音。 */
export const STEP_EMPHASIS = { band: true, bandColor: "#FFFFFF", textColor: "#111111" } as const;
export const STEP_EMPHASIS_SFX = "pop";
/** 強調テロップで人物に寄る倍率(少しだけ)。 */
export const STEP_EMPHASIS_ZOOM = 1.1;

/** 10. 強調したい言葉(のクリップ)を、強調テロップにする。 */
export const applyEmphasis = (segments: ProjectSegment[], keys: Set<string>): ProjectSegment[] =>
  segments.map((segment) =>
    keys.has(segment.key)
      ? { ...segment, captionEmphasis: { ...STEP_EMPHASIS } }
      : { ...segment, captionEmphasis: undefined, emphasisSfxPresetId: undefined }
  );

/** 11. 強調テロップに効果音を付け、少し人物を拡大する。 */
export const emphasisEffects = (segments: ProjectSegment[]): { segments: ProjectSegment[]; count: number } => {
  let count = 0;
  const result = segments.map((segment) => {
    if (!segment.captionEmphasis) return segment;
    count++;
    const zoom: ClipZoom = {
      scale: STEP_EMPHASIS_ZOOM,
      style: "punch",
      focusXPercent: segment.faceBox?.xPercent ?? 50,
      focusYPercent: segment.faceBox?.yPercent ?? 40,
    };
    return { ...segment, emphasisSfxPresetId: STEP_EMPHASIS_SFX, zoom };
  });
  return { segments: result, count };
};
