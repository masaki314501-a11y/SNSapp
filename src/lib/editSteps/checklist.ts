import type { CaptionFontFamily, CaptionFontSize, CaptionStyle, ClipZoom, ImageOverlay } from "@video/shared/schema";
import { estimateOverlayBox } from "@video/shared/textWrap";
import { findTextStylePreset } from "@video/shared/textStylePresets";
import type { ProjectSegment } from "@/lib/videoProject";
import { captionBox } from "@/lib/gemini/autoEditPlan";
import { captionRuns, MIN_CAPTION_SECONDS, READ_CHARS_PER_SECOND, type SpeechSpan, type StepState } from "./logic";

/**
 * 工程12「チェック」: 編集時チェック項目(と、原稿チェックのうち完成動画で確かめられる物)を確かめる。
 * - auto: 機械で確かめる。直せる物はここで直してから確かめる(結果のstateに直した物が入る)。
 * - review: 機械では判断できないので、人が目で確かめてチェックを付ける。
 * 撮影・音声のチェック項目(噛んでいないか・照明など)は、編集では確かめられないので扱わない。
 */
/**
 * 色の数のチェックで数えない、白・黒(と、それに近い色)か。
 * 白い文字・黒い縁取りのように、白と黒はどの動画でも使うので、3色の中には入れない(2026-11 先方確認)。
 * 色みがほとんどなく(明るさの差が小さい)、とても明るいか暗い色を白・黒とみなす。
 */
export const isWhiteOrBlack = (color: string): boolean => {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min <= 0x18 && (max <= 0x33 || min >= 0xe6);
};

export type CheckStatus = "ok" | "ng" | "review";
export type CheckItem = {
  id: string;
  group: "基本" | "クオリティ" | "原稿";
  label: string;
  status: CheckStatus;
  /** 確かめた結果・直した内容・見る所。 */
  detail: string;
};

/** セーフティゾーンの目安(画面に対する%)。上は検索欄、右はボタン、下は説明文で隠れる。広告は「広告」の表示やボタンが増えるので狭い。 */
export const SAFE_ZONES = {
  tiktok: { label: "TikTok投稿", left: 5, right: 87, top: 8, bottom: 78 },
  ad: { label: "広告", left: 7, right: 84, top: 10, bottom: 70 },
} as const;
export type SafeZoneKind = keyof typeof SAFE_ZONES;
/** 声が出ていると見なす、字幕1つあたりの話している時間(秒)。 */
const MIN_SPOKEN_SECONDS = 0.2;
/** 画像の棚(AIが作った画像・使ってよい画像を貯めた所)の画像の場所。 */
const LIBRARY_IMAGE_PREFIX = "images/library/";
/** 同じ画角を続けてよい長さ(秒)。 */
const MAX_SAME_ANGLE_SECONDS = 5;
/** 画角を変えるために足す、ゆるい寄り。 */
const ANGLE_CHANGE_ZOOM = 1.08;
/** カットの遅れとみなす、話し終えてから切れるまでの間(秒)。工程4で残す余白(0.12秒)は遅れに含めない。 */
const MAX_CUT_DELAY_SECONDS = 0.2 + 0.12;
/** 完成動画の長さの上限(秒)。お客様の指定があれば変えてよい。 */
const MAX_VIDEO_SECONDS = 30;
/** 指定した長さを、これだけ超えていても収まったとみなす(秒)。場面ごとにしか外せないため。 */
const LENGTH_TOLERANCE_SECONDS = 0.5;

/** 広告として問題になりやすい表現(薬機法・景品表示法・比較広告)。見つかったら人が確かめる。 */
const AD_RISK_PATTERNS: { pattern: RegExp; law: string }[] = [
  { pattern: /効果あり|効果がある|若返|治る|完治/, law: "薬機法" },
  { pattern: /最[高強安大新上]|業界初|日本初|世界初|地域初|No\.?\s?1|NO\.?\s?1|ナンバーワン|大人気|一番人気/i, law: "景品表示法" },
  { pattern: /\d+(\.\d+)?\s?倍|\d+(\.\d+)?\s?[%％]|\d+\s?分の\s?\d+/, law: "比較広告" },
];

const segmentEnd = (segment: ProjectSegment) => segment.startFromSeconds + segment.durationInSeconds;
const fmt = (seconds: number) => `${(Math.round(seconds * 10) / 10).toFixed(1)}秒`;
const sameZoom = (a: ClipZoom | undefined, b: ClipZoom | undefined) => (a?.scale ?? 1) === (b?.scale ?? 1);

/** 同じ画角が5秒を超えて続く所に、ゆるい寄りを足して画角を変える(直した数を返す)。 */
export const breakLongSameAngle = (segments: ProjectSegment[]): { segments: ProjectSegment[]; fixed: number } => {
  const result = segments.map((segment) => ({ ...segment }));
  let fixed = 0;
  let runStart = 0;
  let elapsed = 0;
  for (let i = 0; i < result.length; i++) {
    const segment = result[i];
    if (i > 0 && !sameZoom(segment.zoom, result[i - 1].zoom)) runStart = elapsed;
    // このクリップの途中で5秒を超えるなら、このクリップ(長さが足りなければ次)の画角を変える
    if (elapsed + segment.durationInSeconds - runStart > MAX_SAME_ANGLE_SECONDS && elapsed > runStart && segment.durationInSeconds >= 0.5) {
      const focusX = segment.faceBox?.xPercent ?? 50;
      const focusY = segment.faceBox?.yPercent ?? 40;
      result[i] = segment.zoom
        ? { ...segment, zoom: undefined }
        : { ...segment, zoom: { scale: ANGLE_CHANGE_ZOOM, style: "punch", focusXPercent: focusX, focusYPercent: focusY } };
      fixed++;
      runStart = elapsed;
    }
    elapsed += segment.durationInSeconds;
  }
  return { segments: result, fixed };
};

/** 同じ画角が続く一番長い時間(秒)。 */
const longestSameAngle = (segments: ProjectSegment[]): number => {
  let longest = 0;
  let run = 0;
  segments.forEach((segment, index) => {
    run = index > 0 && sameZoom(segment.zoom, segments[index - 1].zoom) ? run + segment.durationInSeconds : segment.durationInSeconds;
    longest = Math.max(longest, run);
  });
  return longest;
};

export type ChecklistInput = {
  state: StepState;
  spans: SpeechSpan[];
  look: { captionStyle: CaptionStyle; fontSize: CaptionFontSize; fontFamily: CaptionFontFamily; primaryColor: string };
  captionTextStyleId?: string;
  hasBgm: boolean;
  /** BGMの音量が上がり切るまで・下がり切るまでの秒数(BGMがある時)。 */
  bgmFade?: { fadeInSeconds: number; fadeOutSeconds: number };
  /** AIが見つけた誤字・脱字の候補(nullは確かめていない)。 */
  typos?: { text: string; wrong: string; correct: string; reason: string }[] | null;
  /** 自動で直した誤字・脱字(結果に出す)。 */
  fixedTypos?: { text: string; wrong: string; correct: string; reason: string }[];
  /** どこに出す動画か(セーフティゾーンが変わる)。 */
  zone?: SafeZoneKind;
  /** 工程12で決めた長さの上限(秒)。指定が無い時は null(その時は30秒を目安に、超えたら目で確かめてもらう)。 */
  targetSeconds?: number | null;
  /** 動画全体に出す画像(編集画面で足した物)。 */
  globalImages?: ImageOverlay[];
  /** 光の補正をしたか(工程12で明るさを測って整えた)。 */
  lightAdjusted?: { brightness: number; contrast: number; saturation: number } | null;
};

/** チェックを行う。直せる物(同じ画角が続く所)は直し、直した後の状態で確かめる。 */
export const runChecklist = (input: ChecklistInput): { state: StepState; items: CheckItem[] } => {
  const angleFix = breakLongSameAngle(input.state.segments);
  const state: StepState = { ...input.state, segments: angleFix.segments };
  const segments = state.segments;
  const captioned = segments.filter((segment) => segment.caption.trim());
  const totalSeconds = segments.reduce((sum, segment) => sum + segment.durationInSeconds, 0);
  const items: CheckItem[] = [];
  const add = (item: CheckItem) => items.push(item);

  // ---- 基本項目 ----
  // 字幕が出ている間に、実際に声が出ているか(音声から確かめる)。字幕が書き起こしのかたまりごとに入っているので、声の無い所に字幕が出ていなければ合っている
  // 同じ字幕が続くクリップ(カットの切れ目が言葉の途中にある所)は、1つの字幕として数える
  const runs = captionRuns(segments);
  const spokenIn = (segment: ProjectSegment) =>
    input.spans.reduce(
      (sum, [start, end]) => sum + Math.max(0, Math.min(end, segmentEnd(segment)) - Math.max(start, segment.startFromSeconds)),
      0
    );
  const silentCaptions = runs
    .filter((run) => run.segments.reduce((sum, segment) => sum + spokenIn(segment), 0) < Math.min(MIN_SPOKEN_SECONDS, run.durationInSeconds / 2))
    .map((run) => ({ caption: run.text }));
  add({
    id: "sync",
    group: "基本",
    label: "話す言葉とタイミングが合っているか",
    status: silentCaptions.length === 0 ? "ok" : "ng",
    detail:
      silentCaptions.length === 0
        ? `全${runs.length}個の字幕が、声が出ている間に出ています`
        : `声が出ていない所に出ている字幕: ${silentCaptions.map((s) => `「${s.caption.replace(/\n/g, "")}」`).join(" / ")}。工程9をやり直してください`,
  });

  const shortCaptions = runs
    .filter((run) => run.durationInSeconds < Math.max(MIN_CAPTION_SECONDS, run.text.replace(/\s/g, "").length / READ_CHARS_PER_SECOND))
    .map((run) => ({ caption: run.text, durationInSeconds: run.durationInSeconds }));
  add({
    id: "caption-time",
    group: "基本",
    label: "テロップの表示時間は適切か(きちんと読めるか)",
    status: shortCaptions.length === 0 ? "ok" : "ng",
    detail:
      shortCaptions.length === 0
        ? `全${runs.length}個とも、読める長さ(1秒に${READ_CHARS_PER_SECOND}文字まで・${MIN_CAPTION_SECONDS}秒以上)出ています`
        : `表示時間が短いテロップ: ${shortCaptions.map((s) => `「${s.caption.replace(/\n/g, "")}」${fmt(s.durationInSeconds)}`).join(" / ")}。文字を減らすか、クリップを長くしてください`,
  });

  const typos = input.typos;
  add({
    id: "typo",
    group: "基本",
    label: "誤字・脱字はないか",
    status: typos === undefined || typos === null ? "review" : typos.length === 0 ? "ok" : "ng",
    detail:
      typos === undefined || typos === null
        ? "テロップ・タイトル・枠の文字を読んで確かめてください"
        : typos.length === 0
          ? input.fixedTypos?.length
            ? `AIが音声と見比べ、誤字・脱字を${input.fixedTypos.length}か所直しました: ${input.fixedTypos.map((t) => `「${t.wrong}」→「${t.correct}」`).join(" / ")}`
            : "AIが音声と見比べ、誤字・脱字は見つかりませんでした"
          : `誤字・脱字の候補: ${typos.map((t) => `「${t.text.replace(/\n/g, "")}」の「${t.wrong}」→「${t.correct}」(${t.reason})`).join(" / ")}。編集画面で直してから、もう一度チェックしてください`,
  });

  // セーフティゾーン: 字幕・文字・枠が画面の端(アプリのボタンや説明文で隠れる所)に出ていないか
  const outside: string[] = [];
  const zone = SAFE_ZONES[input.zone ?? "tiktok"];
  const inZone = (box: { left: number; right: number; top: number; bottom: number }) =>
    box.left >= zone.left && box.right <= zone.right && box.top >= zone.top && box.bottom <= zone.bottom;
  for (const segment of captioned) {
    const band = captionBox(segment.caption, segment.clipCaptionPosition ?? "bottom", input.look.captionStyle, input.look.fontSize);
    const box =
      state.captionYPercent !== null && !segment.clipCaptionPosition
        ? { ...band, top: state.captionYPercent, bottom: state.captionYPercent + (band.bottom - band.top) }
        : band;
    if (!inZone(box)) {
      outside.push(`テロップ「${segment.caption.replace(/\n/g, "").slice(0, 12)}」`);
      break;
    }
  }
  for (const overlay of [...state.globalOverlays, ...segments.flatMap((segment) => segment.overlays ?? [])]) {
    if (!inZone(estimateOverlayBox(overlay))) outside.push(`文字「${overlay.text.replace(/\n/g, "")}」`);
  }
  for (const shape of state.globalShapes) {
    const box = {
      left: shape.xPercent - shape.widthPercent / 2,
      right: shape.xPercent + shape.widthPercent / 2,
      top: shape.yPercent - shape.heightPercent / 2,
      bottom: shape.yPercent + shape.heightPercent / 2,
    };
    if (!inZone(box)) {
      outside.push("枠");
      break;
    }
  }
  add({
    id: "safe-zone",
    group: "基本",
    label: `セーフティゾーンからはみ出していないか(${zone.label})`,
    status: outside.length === 0 ? "ok" : "ng",
    detail:
      outside.length === 0
        ? `字幕・文字・枠は、すべて画面の上${zone.top}%・下${100 - zone.bottom}%・左${zone.left}%・右${100 - zone.right}%を避けています`
        : `はみ出している物: ${outside.join(" / ")}。編集画面で位置を内側へ動かしてください`,
  });

  // 画像の出どころ: 画像の棚の物(AIが作った・使ってよいと確かめて貯めた物)は○。お客様から受け取って入れた画像は、使ってよい物か人が確かめる
  const images = [...(input.globalImages ?? []), ...segments.flatMap((segment) => segment.images ?? [])];
  const ownImages = [...new Set(images.map((image) => image.src).filter((src) => !src.startsWith(LIBRARY_IMAGE_PREFIX)))];
  const libraryImages = new Set(images.map((image) => image.src).filter((src) => src.startsWith(LIBRARY_IMAGE_PREFIX)));
  add({
    id: "copyright",
    group: "基本",
    label: "著作権に違反する画像や動画の使用はないか",
    status: ownImages.length === 0 ? "ok" : "review",
    detail:
      images.length === 0
        ? "画像は使っていません(映像はお客様が撮影した動画です)"
        : ownImages.length === 0
          ? `使っている画像${libraryImages.size}枚は、すべて画像の棚の物(AIが作った画像)です`
          : `お客様から受け取って入れた画像が${ownImages.length}枚あります(${ownImages.map((src) => src.split("/").pop()).join("・")})。使ってよい物か確かめてください`,
  });

  // ---- クオリティ項目 ----
  const first = segments[0];
  const firstSpeech = first ? input.spans.find(([start, end]) => end > first.startFromSeconds && start < segmentEnd(first)) : undefined;
  const leadingGap = first && firstSpeech ? Math.max(0, firstSpeech[0] - first.startFromSeconds) : 0;
  add({
    id: "no-blank-start",
    group: "クオリティ",
    label: "冒頭空白がないか",
    status: leadingGap <= 0.3 ? "ok" : "ng",
    detail: leadingGap <= 0.3 ? `話し始めるまで${fmt(leadingGap)}です` : `話し始めるまで${fmt(leadingGap)}空いています。工程2をやり直してください`,
  });

  let elapsed = 0;
  let cutsInFirst5 = 0;
  for (const segment of segments) {
    if (elapsed > 0 && elapsed < 5) cutsInFirst5++;
    elapsed += segment.durationInSeconds;
  }
  const changesInFirst5 = cutsInFirst5 + (state.globalOverlays.length > 0 ? 1 : 0);
  add({
    id: "first-5s",
    group: "クオリティ",
    label: "冒頭5秒内の変化はつけているか(3カット以上)",
    status: cutsInFirst5 + 1 >= 3 ? "ok" : "ng",
    detail:
      cutsInFirst5 + 1 >= 3
        ? `冒頭5秒に${cutsInFirst5 + 1}カット入っています`
        : `冒頭5秒が${cutsInFirst5 + 1}カット(変化${changesInFirst5}回)しかありません。冒頭の話を区切るか、寄りを足してください`,
  });

  const longest = longestSameAngle(segments);
  add({
    id: "same-angle",
    group: "クオリティ",
    label: "同じ画角が5秒以内か",
    status: longest <= MAX_SAME_ANGLE_SECONDS + 0.05 ? "ok" : "ng",
    detail: [
      angleFix.fixed > 0 ? `5秒を超えて同じ画角が続く所に、ゆるい寄りを${angleFix.fixed}か所足しました。` : "",
      longest <= MAX_SAME_ANGLE_SECONDS + 0.05 ? `同じ画角は長くて${fmt(longest)}です` : `同じ画角が${fmt(longest)}続く所があります(1つのクリップが長すぎます)`,
    ].join(""),
  });

  // 切れ目(次のクリップが元の動画で続いていない所)だけを見る。続いている所は切っていないので遅れにならない
  const lateCuts = segments.filter((segment, index) => {
    const next = segments[index + 1];
    if (next && Math.abs(next.startFromSeconds - segmentEnd(segment)) < 0.05) return false;
    const inside = input.spans.filter(([start, end]) => end > segment.startFromSeconds && start < segmentEnd(segment));
    const lastEnd = inside.at(-1)?.[1];
    return lastEnd !== undefined && segmentEnd(segment) - Math.min(lastEnd, segmentEnd(segment)) > MAX_CUT_DELAY_SECONDS;
  });
  add({
    id: "cut-delay",
    group: "クオリティ",
    label: "0.2秒以上カットが遅れていないか",
    status: lateCuts.length === 0 ? "ok" : "ng",
    detail: lateCuts.length === 0 ? "話し終えてから0.2秒以内に切れています" : `話し終えてから0.2秒より後に切れているクリップが${lateCuts.length}個あります。工程4・5をやり直してください`,
  });

  add({
    id: "bgm",
    group: "クオリティ",
    label: "BGMのタイミングが0.2秒以上ズレていないか",
    // BGMは動画の頭から鳴り、終わりに合わせて下げる。入り・終わりの音量の変化が0.2秒以上あれば、映像とずれて聞こえない
    status: !input.hasBgm || (input.bgmFade && input.bgmFade.fadeOutSeconds >= 0.2) ? "ok" : "ng",
    detail: !input.hasBgm
      ? "BGMは入っていません"
      : input.bgmFade && input.bgmFade.fadeOutSeconds >= 0.2
        ? `BGMは動画の頭から鳴り、最後の${fmt(input.bgmFade.fadeOutSeconds)}で音量を下げて、動画の終わりと一緒に終わります`
        : "BGMが動画の終わりで急に切れます。編集画面のBGMで、終わりのフェードアウトを付けてください",
  });

  const colors = new Set<string>();
  const addColor = (color: string | undefined) => {
    if (color && !isWhiteOrBlack(color)) colors.add(color.toUpperCase());
  };
  const captionPreset = findTextStylePreset(input.captionTextStyleId);
  if (!captionPreset) {
    addColor("#FFFFFF");
    addColor(input.look.primaryColor);
  }
  for (const overlay of [...state.globalOverlays, ...segments.flatMap((segment) => segment.overlays ?? [])]) {
    addColor(overlay.color);
    addColor(overlay.strokeColor);
    addColor(overlay.backgroundColor);
  }
  for (const shape of state.globalShapes) {
    addColor(shape.borderColor);
    addColor(shape.fillColor);
  }
  for (const segment of segments) {
    addColor(segment.captionEmphasis?.bandColor);
    addColor(segment.captionEmphasis?.textColor);
  }
  add({
    id: "colors",
    group: "クオリティ",
    label: "4色以上色が混在していないか",
    status: colors.size <= 3 ? "ok" : "ng",
    detail: `白・黒のほかに使っている色は${colors.size}色です${colors.size ? `(${[...colors].join("・")})` : ""}${colors.size <= 3 ? "" : "。色をそろえてください"}${captionPreset ? "。文字スタイルの色は数えていないので、目でも確かめてください" : ""}`,
  });

  const fonts = new Set<string>([input.look.fontFamily]);
  if (captionPreset) fonts.add(captionPreset.fontFamily);
  for (const segment of segments) {
    if (segment.captionFontFamily) fonts.add(segment.captionFontFamily);
    if (segment.captionEmphasis?.fontFamily) fonts.add(segment.captionEmphasis.fontFamily);
    const clipPreset = findTextStylePreset(segment.clipTextStyleId);
    if (clipPreset) fonts.add(clipPreset.fontFamily);
    for (const overlay of segment.overlays ?? []) if (overlay.fontFamily) fonts.add(overlay.fontFamily);
  }
  for (const overlay of state.globalOverlays) if (overlay.fontFamily) fonts.add(overlay.fontFamily);
  add({
    id: "fonts",
    group: "クオリティ",
    label: "フォントは3つ以上混在していないか",
    status: fonts.size <= 2 ? "ok" : "ng",
    detail: `使っているフォントは${fonts.size}つです(${[...fonts].join("・")})${fonts.size <= 2 ? "" : "。フォントをそろえてください"}`,
  });

  const light = input.lightAdjusted;
  add({
    id: "light",
    group: "クオリティ",
    label: "人間が美しく見えるよう光が補正されているか",
    status: light ? "ok" : "review",
    detail: light
      ? `映像の明るさを測って補正しました(明るさ${Math.round(light.brightness * 100)}%・コントラスト${Math.round(light.contrast * 100)}%・彩度${Math.round(light.saturation * 100)}%)。編集画面の「演出」→「動画全体」で手でも直せます`
      : "元の動画の明るさを確かめてください",
  });

  const emphasized = segments.filter((segment) => segment.captionEmphasis);
  // 同じ字幕の続き(カットの切れ目の後)は、前のクリップで鳴らしているので数えない
  const noSfx = emphasized.filter((segment) => !segment.emphasisSfxPresetId && segment.captionAnimation !== "none");
  add({
    id: "sfx",
    group: "クオリティ",
    label: "シーンごとにSE・効果音が入っているか",
    status: emphasized.length > 0 && noSfx.length === 0 ? "ok" : "ng",
    detail:
      emphasized.length === 0
        ? "効果音が入っていません。工程10・11をやり直してください"
        : noSfx.length === 0
          ? `強調テロップ${emphasized.length}か所すべてに効果音が入っています`
          : `効果音の無い強調テロップが${noSfx.length}か所あります。工程11をやり直してください`,
  });

  // ---- 原稿チェック項目のうち、完成動画で確かめられる物 ----
  add({
    id: "length",
    group: "原稿",
    label: "30秒以内の動画になっているか(お客様の指定があれば変更OK)",
    // 長さを指定した時は、その長さに収まっているか。指定が無い時は30秒を目安にし、超えたら目で確かめてもらう
    status: input.targetSeconds
      ? totalSeconds <= input.targetSeconds + LENGTH_TOLERANCE_SECONDS
        ? "ok"
        : "ng"
      : totalSeconds <= MAX_VIDEO_SECONDS
        ? "ok"
        : "review",
    detail: input.targetSeconds
      ? totalSeconds <= input.targetSeconds + LENGTH_TOLERANCE_SECONDS
        ? `完成の長さは${fmt(totalSeconds)}で、指定した${input.targetSeconds}秒以内です`
        : `完成の長さが${fmt(totalSeconds)}で、指定した${input.targetSeconds}秒を超えています。工程12をやり直してください`
      : totalSeconds <= MAX_VIDEO_SECONDS
        ? `完成の長さは${fmt(totalSeconds)}です`
        : `完成の長さが${fmt(totalSeconds)}あります(長さは指定していません)。このままでよければチェックしてください。短くする時は、工程12で長さの上限を入れてやり直してください`,
  });

  const texts = [
    ...state.globalOverlays.map((overlay) => overlay.text),
    ...segments.flatMap((segment) => (segment.overlays ?? []).map((overlay) => overlay.text)),
    ...captioned.map((segment) => segment.caption),
  ].map((text) => text.replace(/\n/g, ""));
  const risky = AD_RISK_PATTERNS.flatMap(({ pattern, law }) =>
    texts.filter((text) => pattern.test(text)).map((text) => `${law}:「${text}」`)
  );
  add({
    id: "ad-law",
    group: "原稿",
    label: "薬機法・景品表示法・比較広告に触れる表現はないか",
    status: risky.length === 0 ? "ok" : "review",
    detail:
      risky.length === 0
        ? "「効果あり」「最〇」「No.1」「〇倍」「〇%」などの表現は見つかりませんでした"
        : `確かめてほしい表現: ${[...new Set(risky)].join(" / ")}`,
  });

  add({ id: "brand", group: "原稿", label: "企業イメージを損ねる内容ではないか", status: "review", detail: "完成動画を見て確かめてください" });

  return { state, items };
};
