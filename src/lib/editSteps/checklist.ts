import type { CaptionFontFamily, CaptionFontSize, CaptionStyle, ClipZoom, ImageOverlay } from "@video/shared/schema";
import { estimateOverlayBox } from "@video/shared/textWrap";
import { findTextStylePreset } from "@video/shared/textStylePresets";
import type { ProjectSegment } from "@/lib/videoProject";
import { captionBox } from "./screenBoxes";
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

/**
 * AIが見つけた誤字・脱字を、自動で直してよいか。直すのは、数文字だけを直す小さな物だけ
 * (「できるの」→「できるので」・「ほが」→「方が」など)。
 * 文字のほとんどを書き換える物は、言い換え(利用者が直したタイトル等)を戻してしまうことがあるので、
 * 自動では直さず、候補として人に見せる。
 */
export const isSmallTypoFix = (typo: { text: string; wrong: string; correct: string }): boolean => {
  if (!typo.wrong || !typo.text.includes(typo.wrong)) return false;
  const a = [...typo.wrong];
  const b = [...typo.correct];
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const changed = Math.max(a.length - prefix - suffix, b.length - prefix - suffix);
  return changed <= Math.max(3, Math.floor([...typo.text.replace(/\s/g, "")].length / 3));
};

export type CheckStatus = "ok" | "ng" | "review";
export type CheckItem = {
  id: string;
  group: "基本" | "クオリティ" | "原稿";
  label: string;
  status: CheckStatus;
  /** 確かめた結果・直した内容・見る所。 */
  detail: string;
  /** 広告の表現で引っかかった文字(画面で、その場で言い換えられるようにする)。 */
  findings?: AdRiskFinding[];
};

export type AdRiskFinding = {
  /** 引っかかった字幕・文字(改行は除く)。 */
  text: string;
  /** 引っかかった言葉。 */
  word: string;
  law: string;
  /** なぜ確かめてほしいか(はじめての人向けの説明)。 */
  why: string;
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
/** 指定した長さを、これだけ超えていても収まったとみなす(秒)。場面ごとにしか外せないため。 */
const LENGTH_TOLERANCE_SECONDS = 0.5;

/** 広告として問題になりやすい表現(薬機法・景品表示法・比較広告)。見つかったら人が確かめる。 */
const AD_RISK_PATTERNS: { pattern: RegExp; law: string; why: string }[] = [
  {
    pattern: /効果あり|効果がある|若返|治る|完治/,
    law: "薬機法",
    why: "効き目を言い切る言葉は、薬機法で使えないことがあります。「〜が期待できます」「〜の人もいます」のように言い換えると安全です",
  },
  {
    pattern: /最[高強安大新上]|業界初|日本初|世界初|地域初|No\.?\s?1|NO\.?\s?1|ナンバーワン|大人気|一番人気/i,
    law: "景品表示法",
    why: "「一番」「初」のような言葉は、はっきりした根拠が無いと景品表示法で使えないことがあります",
  },
  {
    pattern: /\d+(\.\d+)?\s?倍|\d+(\.\d+)?\s?[%％]|\d+\s?分の\s?\d+/,
    law: "比較広告",
    why: "「〇倍」「〇%」のような数字は、何と比べたか・どこから出た数字かの根拠が要ります。根拠があれば、そのままで大丈夫です",
  },
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
  /** 工程12で決めた長さの上限(秒)。指定が無い時は null(その時は長さを確かめない)。 */
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
        : `声が出ていない所に出ている字幕: ${silentCaptions.map((s) => `「${s.caption.replace(/\n/g, "")}」`).join(" / ")}。下の「工程9からやり直す」を押すと、字幕を入れ直します`,
  });

  const shortCaptions = runs
    .filter((run) => run.durationInSeconds < Math.max(MIN_CAPTION_SECONDS, run.text.replace(/\s/g, "").length / READ_CHARS_PER_SECOND))
    .map((run) => ({ caption: run.text, durationInSeconds: run.durationInSeconds }));
  add({
    id: "caption-time",
    group: "基本",
    label: "字幕が読める長さ出ているか",
    status: shortCaptions.length === 0 ? "ok" : "ng",
    detail:
      shortCaptions.length === 0
        ? `全${runs.length}個とも、読める長さ(1秒に${READ_CHARS_PER_SECOND}文字まで・${MIN_CAPTION_SECONDS}秒以上)出ています`
        : `出ている時間が短くて読み切れない字幕: ${shortCaptions.map((s) => `「${s.caption.replace(/\n/g, "")}」${fmt(s.durationInSeconds)}`).join(" / ")}。下の「工程9からやり直す」を押すと、AIが字幕を短くします`,
  });

  const typos = input.typos;
  add({
    id: "typo",
    group: "基本",
    label: "誤字・脱字はないか",
    status: typos === undefined || typos === null ? "review" : typos.length === 0 ? "ok" : "ng",
    detail:
      typos === undefined || typos === null
        ? "字幕・タイトル・枠の文字を読んで確かめてください"
        : typos.length === 0
          ? input.fixedTypos?.length
            ? `AIが音声と見比べ、誤字・脱字を${input.fixedTypos.length}か所直しました: ${input.fixedTypos.map((t) => `「${t.wrong}」→「${t.correct}」`).join(" / ")}`
            : "AIが音声と見比べ、誤字・脱字は見つかりませんでした"
          : `誤字・脱字の候補: ${typos.map((t) => `「${t.text.replace(/\n/g, "")}」の「${t.wrong}」→「${t.correct}」(${t.reason})`).join(" / ")}。字幕の誤りは、下の「工程9からやり直す」を押すか、編集画面の「字幕・音声」で直してください。タイトル・枠の文字の誤りは、編集画面の「演出」で直してください`,
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
      outside.push(`字幕「${segment.caption.replace(/\n/g, "").slice(0, 12)}」`);
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
    label: `文字が、アプリのボタンや説明で隠れる所に出ていないか(${zone.label})`,
    status: outside.length === 0 ? "ok" : "ng",
    detail:
      outside.length === 0
        ? `字幕・文字・枠は、すべて画面の上${zone.top}%・下${100 - zone.bottom}%・左${zone.left}%・右${100 - zone.right}%を避けています`
        : `隠れる所に出ている物: ${outside.join(" / ")}。下の「工程8からやり直す」を押すか、編集画面で位置を内側へ動かしてください`,
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
    label: "最初に間が空いていないか",
    status: leadingGap <= 0.3 ? "ok" : "ng",
    detail: leadingGap <= 0.3 ? `話し始めるまで${fmt(leadingGap)}です` : `話し始めるまで${fmt(leadingGap)}空いています。このままでも出せますが、最初に間があると見る人が離れやすくなります。詰める時は、編集画面の「カット」で、最初の場面の頭を後ろへずらしてください`,
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
    label: "最初の5秒に、3回以上の切り替わりがあるか",
    status: cutsInFirst5 + 1 >= 3 ? "ok" : "ng",
    detail:
      cutsInFirst5 + 1 >= 3
        ? `冒頭5秒に${cutsInFirst5 + 1}カット入っています`
        : `最初の5秒が${cutsInFirst5 + 1}カット(変化${changesInFirst5}回)しかありません。このままでも出せますが、最初に変化が少ないと見る人が離れやすくなります。足す時は、編集画面の「演出」で、最初の場面に「寄り(ズーム)」を入れてください`,
  });

  const longest = longestSameAngle(segments);
  add({
    id: "same-angle",
    group: "クオリティ",
    label: "同じ映り方が、5秒より長く続いていないか",
    status: longest <= MAX_SAME_ANGLE_SECONDS + 0.05 ? "ok" : "ng",
    detail: [
      angleFix.fixed > 0 ? `5秒を超えて同じ映り方が続く所に、ゆるい寄りを${angleFix.fixed}か所足しました。` : "",
      longest <= MAX_SAME_ANGLE_SECONDS + 0.05 ? `同じ映り方は長くて${fmt(longest)}です` : `同じ映り方が${fmt(longest)}続く所があります(1つの場面が長いため)。このままでも出せます。変える時は、編集画面の「カット」でその場面を2つに分け、「演出」で片方に「寄り(ズーム)」を入れてください`,
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
    label: "話し終えてから、0.2秒以内に切れているか",
    status: lateCuts.length === 0 ? "ok" : "ng",
    detail: lateCuts.length === 0 ? "話し終えてから0.2秒以内に切れています" : `話し終えてから切れるまでに、少し間がある場面が${lateCuts.length}個あります。このままでも出せます。詰める時は、編集画面の「カット」で、その場面の終わりを前へずらしてください`,
  });

  add({
    id: "bgm",
    group: "クオリティ",
    label: "BGMの終わりが、動画の終わりと合っているか",
    // BGMは動画の頭から鳴り、終わりに合わせて下げる。入り・終わりの音量の変化が0.2秒以上あれば、映像とずれて聞こえない
    status: !input.hasBgm || (input.bgmFade && input.bgmFade.fadeOutSeconds >= 0.2) ? "ok" : "ng",
    detail: !input.hasBgm
      ? "BGMは入っていません"
      : input.bgmFade && input.bgmFade.fadeOutSeconds >= 0.2
        ? `BGMは動画の頭から鳴り、最後の${fmt(input.bgmFade.fadeOutSeconds)}で音量を下げて、動画の終わりと一緒に終わります`
        : "BGMが動画の終わりで急に切れます。編集画面の「BGM」で、終わりで音をだんだん小さくする設定(フェードアウト)を付けてください",
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
    label: "色が多すぎないか(白・黒のほかに3色まで)",
    status: colors.size <= 3 ? "ok" : "ng",
    detail: `白・黒のほかに使っている色は${colors.size}色です${colors.size ? `(${[...colors].join("・")})` : ""}${colors.size <= 3 ? "" : "。下の「工程8からやり直す」を押すと、AIが色を選び直します"}${captionPreset ? "。文字スタイルの色は数えていないので、目でも確かめてください" : ""}`,
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
    label: "書体(フォント)が多すぎないか(2つまで)",
    status: fonts.size <= 2 ? "ok" : "ng",
    detail: `使っている書体は${fonts.size}つです(${[...fonts].join("・")})${fonts.size <= 2 ? "" : "。下の「工程8からやり直す」を押すと、AIが書体を選び直します"}`,
  });

  const light = input.lightAdjusted;
  add({
    id: "light",
    group: "クオリティ",
    label: "人がきれいに見える明るさになっているか",
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
    label: "強調した字幕に、効果音が入っているか",
    status: emphasized.length > 0 && noSfx.length === 0 ? "ok" : "ng",
    detail:
      emphasized.length === 0
        ? "強調した字幕が無いので、効果音が入っていません。下の「工程10からやり直す」を押してください"
        : noSfx.length === 0
          ? `強調した字幕${emphasized.length}か所すべてに効果音が入っています`
          : `効果音の無い強調した字幕が${noSfx.length}か所あります。下の「工程10からやり直す」を押してください`,
  });

  // ---- 原稿チェック項目のうち、完成動画で確かめられる物 ----
  // 長さは、工程12で上限を入れた時だけ確かめる(入れていない時は、動画の長さのままでよい)
  const target = input.targetSeconds;
  add({
    id: "length",
    group: "原稿",
    label: "決めた長さに収まっているか",
    status: !target || totalSeconds <= target + LENGTH_TOLERANCE_SECONDS ? "ok" : "ng",
    detail: !target
      ? `長さの上限は決めていません(完成の長さは${fmt(totalSeconds)})`
      : totalSeconds <= target + LENGTH_TOLERANCE_SECONDS
        ? `完成の長さは${fmt(totalSeconds)}で、決めた${target}秒以内です`
        : `完成の長さが${fmt(totalSeconds)}で、決めた${target}秒を超えています。下の「工程12からやり直す」を押してください`,
  });

  const texts = [
    ...state.globalOverlays.map((overlay) => overlay.text),
    ...segments.flatMap((segment) => (segment.overlays ?? []).map((overlay) => overlay.text)),
    ...captioned.map((segment) => segment.caption),
  ].map((text) => text.replace(/\n/g, ""));
  const findings: AdRiskFinding[] = [];
  for (const { pattern, law, why } of AD_RISK_PATTERNS) {
    for (const text of new Set(texts)) {
      const word = pattern.exec(text)?.[0];
      if (word) findings.push({ text, word, law, why });
    }
  }
  add({
    id: "ad-law",
    group: "原稿",
    label: "広告で使えない言葉がないか(薬機法・景品表示法・比較広告)",
    status: findings.length === 0 ? "ok" : "review",
    detail:
      findings.length === 0
        ? "「治る」「最〇」「No.1」「〇倍」「〇%」のような言葉は見つかりませんでした"
        : "次の言葉が、広告では使えないことがあります。言い換えるか、根拠があって問題なければ「このままでよい」にチェックしてください",
    ...(findings.length > 0 ? { findings } : {}),
  });

  add({
    id: "brand",
    group: "原稿",
    label: "会社やお店のイメージを悪くする所がないか",
    status: "review",
    detail:
      "上の動画を最後まで見て、次のような所が無いか確かめてください: 人やほかの会社を悪く言っている・ふざけすぎている・写ってはいけない物(ほかの人の顔・書類・パソコンの画面など)が写っている",
  });

  return { state, items };
};
