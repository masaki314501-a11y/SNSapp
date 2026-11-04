import type {
  CaptionAnimation,
  CaptionEmphasis,
  CaptionFontFamily,
  CaptionFontSize,
  CaptionStyle,
  ClipZoom,
  FaceBox,
  ShapeOverlay,
  TextOverlay,
  VideoAdjust,
  VideoFraming,
} from "@video/shared/schema";
import type { ProjectBgm, ProjectSegment } from "@/lib/videoProject";
import { captionBox, faceOnScreen } from "@/lib/gemini/autoEditPlan";
import type { CheckItem } from "./checklist";

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
  /** 映像の明るさ・コントラスト・彩度(工程14のチェックで、光の補正として決める)。 */
  videoAdjust?: VideoAdjust | null;
  /** BGM(工程13で入れる。無ければnull)。 */
  bgm?: ProjectBgm | null;
  /** 基本テロップの見た目(工程10でAIが手本とクセ帳を見て決める)。無ければプロジェクトの設定のまま。 */
  captionLook?: { fontFamily: CaptionFontFamily; captionStyle: CaptionStyle; primaryColor: string } | null;
};

/** 工程の結果(先方の確認用の説明)。工程12(チェック)は、チェック項目ごとの結果も持つ。 */
export type StepResult = { note: string; details?: string[]; checks?: CheckItem[]; at: string };
/**
 * 工程ごとの結果と、その工程を終えた時点の状態(やり直す時は、1つ前の工程の状態から始める)。
 * reviewedは、目で確かめるチェック項目に人が付けたチェック。
 */
export type EditStepsRecord = {
  results: Record<number, StepResult>;
  snapshots: Record<number, StepState>;
  reviewed?: Record<string, boolean>;
};

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

/** 話し終えてから切るまでに残す間の上限(秒)。 */
const MAX_TAIL_AFTER_SPEECH_SECONDS = 0.15;
/** これより短いクリップは、つないだ時に一瞬のちらつきになるので外す(秒)。 */
const MIN_JOINED_SECONDS = 0.3;

/**
 * 5. 話の流れが自然になるように前後の映像をつなぐ: 切れ目を近くの一番静かな所へ寄せ(言葉の途中で切らない)、
 * ちらつきになる短すぎるクリップを外し、元の動画で続いているクリップはひとつにまとめる。
 */
export const smoothJoins = (
  segments: ProjectSegment[],
  snap: (seconds: number) => number,
  spans: SpeechSpan[] = []
): { segments: ProjectSegment[]; snapped: number; dropped: number; merged: number } => {
  let snapped = 0;
  const moved = segments.map((segment, index) => {
    // 先頭の入りは工程2で決めたので動かさない
    const start = index === 0 ? segment.startFromSeconds : snap(segment.startFromSeconds);
    // 終わりは、話し終えてから切れるまでが0.2秒を超えないようにする(チェック項目: 0.2秒以上カットが遅れていないか)
    const lastSpeechEnd = spans
      .filter(([s, e]) => e > segment.startFromSeconds && s < segmentEnd(segment))
      .reduce((latest, [, e]) => Math.max(latest, Math.min(e, segmentEnd(segment))), -Infinity);
    const end = Math.min(snap(segmentEnd(segment)), lastSpeechEnd > -Infinity ? lastSpeechEnd + MAX_TAIL_AFTER_SPEECH_SECONDS : Infinity);
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

/** テロップの帯の高さ(%)。2行のテロップが入る高さで見積もる。 */
export const captionBandHeight = (style: CaptionStyle, fontSize: CaptionFontSize): number => {
  const band = captionBox("テロップの高さの見本\n2行目", "top", style, fontSize);
  return band.bottom - band.top;
};

/** 左上のタイトルの位置・大きさ(%・px)。 */
const TITLE_STYLE = { xPercent: 7, yPercent: 12, fontSizePx: 64 } as const;
/** タイトルの右端・上端の限界(%)。TikTokの右側のボタン・上の検索欄にかからない所まで。 */
const TITLE_RIGHT_LIMIT_PERCENT = 86;
const TITLE_TOP_LIMIT_PERCENT = 9;
/** ランキングの枠の並べ方: 画面の左側に縦に並べる(%)。 */
const FRAME_X_PERCENT = 20;
const FRAME_WIDTH_PERCENT = 30;
const FRAME_GAP_PERCENT = 1.5;
/** 枠を並べてよい一番下(%)。TikTokの説明文で隠れる所(下22%)の手前まで。 */
const FRAME_LOWEST_PERCENT = 77;
/** 枠1つの高さの上限(%)。枠が少ない時に大きくなりすぎないように。 */
const FRAME_MAX_HEIGHT_PERCENT = 11;
/** タイトルの縁取りの見える太さ(文字の大きさに対する割合)。 */
const TITLE_STROKE_RATIO = 0.06;

/**
 * 8. 必要なオブジェクトを作る: 左上のタイトルテロップと、ランキングの枠(N個を左に縦に並べ、番号を付ける)。
 * 枠は、タイトルの下からテロップの帯の上まで(テロップと被らないように)に収める。
 */
/**
 * タイトル・枠の見た目(工程8でAIが手本とクセ帳を見て決める)。省略した時は、白い文字に黒の縁取りのタイトルと、
 * 差し色の線の白い枠にする。
 */
export type ObjectStyle = {
  title?: { fontFamily?: CaptionFontFamily; textColor: string; strokeColor: string | null; bandColor: string | null; animation: CaptionAnimation };
  frame?: { borderColor: string; borderWidthPx: number; fillColor: string | null; cornerRadiusPx: number; numberColor: string; animation: CaptionAnimation };
};

export const buildObjects = (params: {
  title: string;
  frameCount: number;
  captionTopPercent: number;
  /** テロップの帯の下端(%)。顎の下に固定した時は、枠をテロップの上と下に分けて並べる(帯には置かない)。 */
  captionBottomPercent?: number;
  accentColor: string;
  style?: ObjectStyle;
}): { globalOverlays: TextOverlay[]; globalShapes: ShapeOverlay[] } => {
  const titleStyle = params.style?.title;
  const frameStyle = params.style?.frame;
  // タイトルは、左の余白から画面の右86%(TikTokの右側のボタンの手前)までに収める。長ければ文字を小さくする
  // (自動で2行にすると「看護/師」のように言葉の途中で切れたため、改行はAIが意味の切れ目に入れた時だけ)
  const maxWidthPx = ((TITLE_RIGHT_LIMIT_PERCENT - TITLE_STYLE.xPercent) / 100) * 1080;
  const titleText = params.title;
  const longestLine = Math.max(...titleText.split("\n").map((line) => line.length));
  const fontSizePx = Math.max(36, Math.min(TITLE_STYLE.fontSizePx, Math.floor(maxWidthPx / longestLine)));
  // 上の端が、TikTokの検索欄で隠れる所(画面の上8%)より下に来るように置く
  const titleHalfHeight = (titleText.split("\n").length * fontSizePx * 1.2 + fontSizePx * 0.2) * 100 / 1920 / 2;
  const title: TextOverlay = {
    text: titleText,
    startOffsetSeconds: 0,
    xPercent: TITLE_STYLE.xPercent,
    yPercent: round2(Math.max(TITLE_STYLE.yPercent, TITLE_TOP_LIMIT_PERCENT + titleHalfHeight)),
    textAlign: "left",
    fontSizePx,
    color: titleStyle?.textColor ?? "#FFFFFF",
    strokeColor: titleStyle ? (titleStyle.strokeColor ?? undefined) : "#000000",
    // 縁取りは細めにする(太い書体に太い縁取りが重なると、文字がつぶれて読めなかった)
    strokeWidthPx: Math.max(3, Math.round(fontSizePx * TITLE_STROKE_RATIO)),
    backgroundColor: titleStyle?.bandColor ?? undefined,
    fontFamily: titleStyle?.fontFamily,
    rotationDeg: 0,
    animation: titleStyle?.animation ?? "fade",
  };
  // 左寄せの文字は、xPercentを文字の中心として扱う描画に合わせ、文字幅の半分だけ右へずらす
  const titleWidthPercent = (longestLine * fontSizePx * 100) / 1080;
  title.xPercent = round2(TITLE_STYLE.xPercent + titleWidthPercent / 2);
  if (params.frameCount < 2) return { globalOverlays: [title], globalShapes: [] };

  const titleLines = titleText.split("\n").length;
  const top = title.yPercent + (titleLines * fontSizePx * 1.3 * 100) / 1920 / 2 + 3;
  // 枠を並べられる所: タイトルの下からテロップの帯の上まで。テロップが画面の途中(顎の下)にある時は、帯の下から
  // 画面の下の見える所(セーフティゾーンの下端)までも使う。以前は帯の上だけに詰めていて、枠がとても細くなっていた
  const areas: [number, number][] = [[top, params.captionTopPercent - 2]];
  if (params.captionBottomPercent !== undefined && params.captionBottomPercent + 2 < FRAME_LOWEST_PERCENT) {
    areas.push([params.captionBottomPercent + 2, FRAME_LOWEST_PERCENT]);
  }
  const usable = areas.filter(([from, to]) => to - from > 3);
  // 全部の枠が入る、一番大きい高さを探す(場所が分かれていると、余りの分だけ入る数が減るため)
  const fits = (height: number) =>
    usable.reduce((sum, [from, to]) => sum + Math.floor((to - from + FRAME_GAP_PERCENT + 0.01) / (height + FRAME_GAP_PERCENT)), 0) >=
    params.frameCount;
  let frameHeight = FRAME_MAX_HEIGHT_PERCENT;
  while (frameHeight > 2 && !fits(frameHeight)) frameHeight -= 0.1;
  // 上から順に、入る所へ枠を置いていく(入りきらない所は次の場所へ)
  const centers: number[] = [];
  for (const [from, to] of usable) {
    let y = from + frameHeight / 2;
    while (centers.length < params.frameCount && y + frameHeight / 2 <= to + 0.01) {
      centers.push(y);
      y += frameHeight + FRAME_GAP_PERCENT;
    }
  }
  const shapes: ShapeOverlay[] = [];
  const labels: TextOverlay[] = [];
  for (let i = 0; i < centers.length; i++) {
    const y = round2(centers[i]);
    shapes.push({
      kind: "rect",
      startOffsetSeconds: 0,
      xPercent: FRAME_X_PERCENT,
      yPercent: y,
      widthPercent: FRAME_WIDTH_PERCENT,
      heightPercent: round2(frameHeight),
      borderColor: frameStyle?.borderColor ?? params.accentColor,
      borderWidthPx: frameStyle?.borderWidthPx ?? 6,
      fillColor: frameStyle ? (frameStyle.fillColor ?? undefined) : "#FFFFFF",
      fillOpacity: 0.85,
      cornerRadiusPx: frameStyle?.cornerRadiusPx ?? 16,
      animation: frameStyle?.animation ?? "fade",
    });
    labels.push({
      text: String(i + 1),
      startOffsetSeconds: 0,
      xPercent: FRAME_X_PERCENT - FRAME_WIDTH_PERCENT / 2 + 3,
      yPercent: y,
      fontSizePx: Math.max(32, Math.min(56, Math.round((frameHeight / 100) * 1920 * 0.45))),
      color: frameStyle?.numberColor ?? params.accentColor,
      fontFamily: titleStyle?.fontFamily,
      rotationDeg: 0,
      animation: frameStyle?.animation ?? "fade",
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
    // 言葉は、その大半が入っているクリップにだけ入れる(前のクリップにほとんど入っている言葉の切れ端を、
    // 0.01秒のクリップや「慢性腎臓病CV」のような二重の字幕にしないため)
    const inside = phrases
      .filter((phrase) => {
        const overlap = Math.min(phrase.end, end) - Math.max(phrase.start, start);
        return phrase.text.trim() && (overlap >= 0.3 || overlap >= (phrase.end - phrase.start) * 0.6);
      })
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
// 文字の黒は、タイトルの縁取りと同じ#000000にそろえる(チェック項目: 4色以上色が混在していないか)
export const STEP_EMPHASIS = { band: true, bandColor: "#FFFFFF", textColor: "#000000" } as const;
export const STEP_EMPHASIS_SFX = "pop";
/** 強調テロップで人物に寄る倍率(少しだけ)。 */
export const STEP_EMPHASIS_ZOOM = 1.1;

/** 10. 強調したい言葉(のクリップ)を、強調テロップにする。見た目は工程10でAIが手本とクセ帳を見て決めた物(無ければ白い帯に黒い文字)。 */
export const applyEmphasis = (
  segments: ProjectSegment[],
  keys: Set<string>,
  look?: { fontFamily?: CaptionFontFamily; textColor: string; bandColor: string | null }
): ProjectSegment[] => {
  const emphasis: CaptionEmphasis = look
    ? { band: look.bandColor !== null, bandColor: look.bandColor ?? undefined, textColor: look.textColor, fontFamily: look.fontFamily }
    : { ...STEP_EMPHASIS };
  return segments.map((segment) =>
    keys.has(segment.key)
      ? { ...segment, captionEmphasis: emphasis }
      : { ...segment, captionEmphasis: undefined, emphasisSfxPresetId: undefined }
  );
};

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
