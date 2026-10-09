"use client";

import {
  CAPTION_ANIMATION_OPTIONS,
  type CaptionAnimation,
  type CaptionFontFamily,
  type CaptionFontSize,
  type CaptionPosition,
  type CaptionStyle,
  type ClipZoom,
  type ImageOverlay,
  type ShapeOverlay,
  type TextOverlay,
  type VideoFraming,
} from "@video/shared/schema";
import type { StandardVideoProps } from "@video/templates/standard/schema";

/**
 * 「動画をアップロード・字幕生成する画面(/create)」と
 * 「クリップを編集・書き出しする画面(/edit)」をまたいで動画の編集状態を受け渡すための
 * 共有ストア。アップロード済みファイルはpublic/videos/配下の静的パスとして残るため、
 * ファイル本体(File/blob URL)を持ち回らなくてもvideoPathだけで次の画面から再生できる。
 * 画面遷移だけでなく、リロード/再訪問時の自動保存・復元も同じ仕組みで兼ねる。
 */

export const DEFAULT_CAPTION_ANIMATION: CaptionAnimation = CAPTION_ANIMATION_OPTIONS[0].value;
export const DEFAULT_CAPTION_STYLE: CaptionStyle = "pill";
export const DEFAULT_CAPTION_FONT_FAMILY: CaptionFontFamily = "Noto Sans JP";
export const DEFAULT_CAPTION_POSITION: CaptionPosition = "bottom";
export const DEFAULT_CAPTION_FONT_SIZE: CaptionFontSize = "medium";
export const DEFAULT_FADE_IN_OUT = false;
export const DEFAULT_CLIP_VOLUME = 1;
export const DEFAULT_PRIMARY_COLOR = "#FF3366";

export type ProjectSegment = {
  key: string;
  caption: string;
  startFromSeconds: number;
  durationInSeconds: number;
  captionAnimation: CaptionAnimation;
  /** このクリップの元動画音量。0=ミュート、1=そのまま、2=倍量。 */
  volume: number;
  /**
   * 自動編集(Gemini)が書き起こした、このクリップで話している内容。字幕は編集画面で
   * 付けるかどうか決めるため、ここに下書きとして持っておき「字幕を一括生成」で使う
   * (あれば文字起こしAPIを呼ばずに済む)。
   */
  speechText?: string;
  /** 以下は自動編集(Gemini)が決める演出。手動で作ったクリップには無い。 */
  emphasisWords?: string[];
  emphasisColor?: string;
  /** このクリップだけテロップの差し色・書体・光を変える(自動編集が決める)。 */
  captionAccentColor?: string;
  captionFontFamily?: CaptionFontFamily;
  captionGlowColor?: string;
  zoom?: ClipZoom;
  overlays?: TextOverlay[];
  /** 利用者が差し込んだ画像(ロゴ・商品写真等)。 */
  images?: ImageOverlay[];
};

/** 自動編集が手本にする参考画像/動画。スタイル抽出画面でアップロードしたものを残しておく。 */
export type ProjectStyleReference = {
  /** public/配下の相対パス(画像は references/、動画は videos/)。 */
  path: string;
  mimeType: string;
};

export type ProjectSfxClip = {
  key: string;
  src: string;
  label: string;
  /** 書き出し後の動画上でこの効果音を鳴らし始める秒数。 */
  startFromSeconds: number;
  volume: number;
  /**
   * AIナレーションの場合、読み上げ元のクリップのkey。一括生成で「もう作ってある分」を
   * 飛ばす判定と、作り直しのときに古いナレーションを置き換える判定に使う。
   * 手動で追加したSEには無い。
   */
  narrationSegmentKey?: string;
  /**
   * AIナレーションを作った声と、読み上げた文。一括生成で「今選んでいる声と違うもの」を見つけて
   * 同じ声で作り直すのに使う(以前は作ってあるものを飛ばしていたため、先に作った分と後から別の声で
   * 作った分が混ざり、男性っぽい声と女性っぽい声が交互に出ることがあった)。
   * 読み上げた文は字幕と違うことがある(自動編集のナレーション)ので、作り直しで同じ内容を読めるよう残す。
   * どちらもこの仕組みより前に作ったナレーションには無い。
   */
  narrationVoice?: string;
  narrationText?: string;
};

export type ProjectBgm = {
  src: string;
  label: string;
  volume: number;
  /** 先頭でBGM音量を0から立ち上げる秒数。 */
  fadeInSeconds: number;
  /** 末尾でBGM音量を0まで下げる秒数。 */
  fadeOutSeconds: number;
};

export type VideoProject = {
  videoPath: string;
  videoFileName: string | null;
  videoDurationInSeconds: number;
  primaryColor: string;
  captionStyle: CaptionStyle;
  fontFamily: CaptionFontFamily;
  captionPosition: CaptionPosition;
  fontSize: CaptionFontSize;
  fadeInOut: boolean;
  segments: ProjectSegment[];
  sfx: ProjectSfxClip[];
  bgm: ProjectBgm | null;
  /** 参考画像/動画からスタイル抽出が成功したか。自動編集(/create/auto-edit)が
   *  配色・フォント等を自分で決めてよいか(=参考が無かった場合のみ)を判断するのに使う。 */
  styleReferenceApplied?: boolean;
  /**
   * 自動編集が手本にする参考スクショ/動画(複数枚)。1枚だけだとその1枚の偶然の配置まで真似るため、
   * 複数枚渡して共通する編集の癖を読ませる。
   */
  styleReferences?: ProjectStyleReference[];
  /** @deprecated 参考が1枚だけだった頃の保存形式。読み込み時にstyleReferencesへ移す。 */
  styleReference?: ProjectStyleReference | null;
  /** 自動編集で選んだテンプレート(editTemplates.tsのid)。nullならおまかせ。 */
  editTemplateId?: string | null;
  /**
   * 自動編集で使ってよい画像(症例写真・商品写真など)。nameは何の画像か(空ならAIが画像を見て判断する)。
   * やり直すたびに選び直さなくて済むよう保存しておく。
   */
  materialImages?: { path: string; name: string }[];
  /** 使える画像が足りない所に、自動編集でAIに画像を作らせるか(1枚数円〜十円かかる)。 */
  generateMissingImages?: boolean;
  /** 自動編集でAIに伝える要望。やり直すたびに書き直さなくて済むよう保存しておく。 */
  autoEditRequest?: string;
  /**
   * カット画面で残した範囲(再生順)。自動編集はこの中から切り出す。自動編集の後はsegmentsが
   * Geminiの切ったクリップに置き換わるため、やり直すたびに範囲が縮んでいかないよう別に持つ。
   */
  cutKeepRanges?: { startFromSeconds: number; durationInSeconds: number }[] | null;
  /** 冒頭0-3秒に重ねる見出し(自動編集が決める)。 */
  hook?: { headline: string; subline?: string } | null;
  /** 最後の数秒に重ねる一言(自動編集が決める)。 */
  cta?: { text: string } | null;
  /** 動画全体に重ね続ける文字(上部のタイトル等、自動編集が決める)。 */
  globalOverlays?: TextOverlay[] | null;
  /** 動画全体に重ね続ける画像(ロゴ等)。 */
  globalImages?: ImageOverlay[] | null;
  /** 動画全体に重ねる図形(ランキングの枠等、自動編集が決める)。 */
  globalShapes?: ShapeOverlay[] | null;
  /** 動画全体の画角(人物を片側に寄せる等、自動編集が決める)。 */
  framing?: VideoFraming | null;
  /** AIナレーションに使う声。画面を開き直しても選んだ声に揃えられるよう保存しておく。 */
  narrationVoice?: string;
  /** ONなら、AIナレーションを入れたクリップの元の音(話し声など)を消す。ナレーションと声が重ならないように。 */
  muteOriginalUnderNarration?: boolean;
};

const PROJECT_STORAGE_KEY = "sns-app:video-project:v1";

const isVideoProjectLike = (value: unknown): value is Partial<VideoProject> => {
  if (typeof value !== "object" || value === null) return false;
  const project = value as Partial<VideoProject>;
  return (
    typeof project.videoPath === "string" &&
    project.videoPath.length > 0 &&
    typeof project.videoDurationInSeconds === "number" &&
    Array.isArray(project.segments)
  );
};

/**
 * 保存データを最新の形へ補完する。fontSize/fadeInOut/sfx/bgm/segment.volumeなどは
 * 後から追加したフィールドのため、古い保存データには無いことがある。
 */
const normalizeProject = (raw: Partial<VideoProject>): VideoProject => ({
  videoPath: raw.videoPath ?? "",
  videoFileName: raw.videoFileName ?? null,
  videoDurationInSeconds: raw.videoDurationInSeconds ?? 0,
  primaryColor: raw.primaryColor ?? DEFAULT_PRIMARY_COLOR,
  captionStyle: raw.captionStyle ?? DEFAULT_CAPTION_STYLE,
  fontFamily: raw.fontFamily ?? DEFAULT_CAPTION_FONT_FAMILY,
  captionPosition: raw.captionPosition ?? DEFAULT_CAPTION_POSITION,
  fontSize: raw.fontSize ?? DEFAULT_CAPTION_FONT_SIZE,
  fadeInOut: raw.fadeInOut ?? DEFAULT_FADE_IN_OUT,
  segments: (raw.segments ?? []).map((segment) => ({
    ...segment,
    volume: segment.volume ?? DEFAULT_CLIP_VOLUME,
  })),
  sfx: raw.sfx ?? [],
  bgm: raw.bgm
    ? {
        ...raw.bgm,
        fadeInSeconds: raw.bgm.fadeInSeconds ?? 0,
        fadeOutSeconds: raw.bgm.fadeOutSeconds ?? 0,
      }
    : null,
  styleReferenceApplied: raw.styleReferenceApplied ?? false,
  styleReferences: raw.styleReferences ?? (raw.styleReference ? [raw.styleReference] : []),
  styleReference: undefined,
  editTemplateId: raw.editTemplateId ?? null,
  materialImages: raw.materialImages ?? [],
  generateMissingImages: raw.generateMissingImages ?? true,
  autoEditRequest: raw.autoEditRequest ?? "",
  cutKeepRanges: raw.cutKeepRanges ?? null,
  hook: raw.hook ?? null,
  cta: raw.cta ?? null,
  globalOverlays: raw.globalOverlays ?? null,
  globalImages: raw.globalImages ?? null,
  globalShapes: raw.globalShapes ?? null,
  framing: raw.framing ?? null,
  narrationVoice: raw.narrationVoice,
  muteOriginalUnderNarration: raw.muteOriginalUnderNarration ?? false,
});

/** 保存されているプロジェクトを読み込む。無ければnull(SSR/壊れたデータの場合もnull)。 */
export const loadProject = (): VideoProject | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROJECT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isVideoProjectLike(parsed) ? normalizeProject(parsed) : null;
  } catch {
    return null;
  }
};

/** JSON文字列からプロジェクトを復元する(エクスポート/インポート機能用)。無効なら null。 */
export const parseProjectJson = (json: string): VideoProject | null => {
  try {
    const parsed: unknown = JSON.parse(json);
    return isVideoProjectLike(parsed) ? normalizeProject(parsed) : null;
  } catch {
    return null;
  }
};

export const saveProject = (project: VideoProject): void => {
  try {
    window.localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(project));
  } catch {
    // 保存容量の超過等は自動保存が使えないだけなので無視する
  }
};

export const clearProject = (): void => {
  try {
    window.localStorage.removeItem(PROJECT_STORAGE_KEY);
  } catch {
    // 無視してよい
  }
};

/** アップロード済み動画をブラウザで直接再生するためのURL(public/配下の静的パス)。 */
export const projectVideoUrl = (videoPath: string): string => `/${videoPath}`;

/**
 * 編集状態(クリップ・スタイル・SE/BGM)からレンダー用のStandardVideoPropsを組み立てる。
 * 編集画面(未保存の最新state)と書き出し画面(localStorageから読み込んだVideoProject)の
 * 両方から同じ形で呼べるよう、個別フィールドを受け取る形にしている。
 */
export const buildStandardVideoProps = (params: {
  videoPath: string;
  segments: ProjectSegment[];
  primaryColor: string;
  captionStyle: CaptionStyle;
  fontFamily: CaptionFontFamily;
  captionPosition: CaptionPosition;
  fontSize: CaptionFontSize;
  fadeInOut: boolean;
  sfxClips: ProjectSfxClip[];
  bgm: ProjectBgm | null;
  hook?: VideoProject["hook"];
  cta?: VideoProject["cta"];
  globalOverlays?: VideoProject["globalOverlays"];
  globalImages?: VideoProject["globalImages"];
  globalShapes?: VideoProject["globalShapes"];
  framing?: VideoProject["framing"];
  muteOriginalUnderNarration?: boolean;
}): StandardVideoProps => {
  // 元の音を消すスイッチがONのとき、AIナレーションが付いているクリップだけ元の音量を0にする。
  // クリップの音量設定そのものは書き換えない(スイッチをOFFに戻せば元の音量に戻るように)。
  const narratedSegmentKeys = params.muteOriginalUnderNarration
    ? new Set(params.sfxClips.flatMap((clip) => (clip.narrationSegmentKey ? [clip.narrationSegmentKey] : [])))
    : new Set<string>();
  return {
    globalImages: params.globalImages && params.globalImages.length > 0 ? params.globalImages : undefined,
    globalShapes: params.globalShapes && params.globalShapes.length > 0 ? params.globalShapes : undefined,
    framing: params.framing ?? undefined,
    globalOverlays: params.globalOverlays && params.globalOverlays.length > 0 ? params.globalOverlays : undefined,
    hook: params.hook ?? undefined,
    cta: params.cta ?? undefined,
    // segmentsの配列順=再生順(並べ替え機能でユーザーが変更できる)。
    // 元動画上の時刻順とは独立しているため、ここでは絶対にソートし直さない。
    clips: params.segments.map((segment) => ({
      src: params.videoPath,
      caption: segment.caption,
      // スキーマ側の下限(clip.durationInSeconds >= 0.3)を下回るクリップが
      // (文字起こし結果をkeepRangeで切り詰めた際の細切れ等で)保存されていると、
      // ここで弾かれないまま送信され書き出し時に検証エラーになるため、念のため底上げする。
      durationInSeconds: Math.max(segment.durationInSeconds, 0.3),
      startFromSeconds: segment.startFromSeconds,
      captionAnimation: segment.captionAnimation,
      volume: narratedSegmentKeys.has(segment.key) ? 0 : segment.volume,
      emphasisWords: segment.emphasisWords,
      emphasisColor: segment.emphasisColor,
      captionAccentColor: segment.captionAccentColor,
      captionFontFamily: segment.captionFontFamily,
      captionGlowColor: segment.captionGlowColor,
      zoom: segment.zoom,
      overlays: segment.overlays,
      images: segment.images,
    })),
    theme: {
      primaryColor: params.primaryColor,
      fontFamily: params.fontFamily,
      captionPosition: params.captionPosition,
      captionStyle: params.captionStyle,
      fontSize: params.fontSize,
      fadeInOut: params.fadeInOut,
    },
    sfx: params.sfxClips.map((clip) => ({
      src: clip.src,
      label: clip.label,
      startFromSeconds: clip.startFromSeconds,
      volume: clip.volume,
    })),
    bgm: params.bgm
      ? {
          src: params.bgm.src,
          volume: params.bgm.volume,
          fadeInSeconds: params.bgm.fadeInSeconds,
          fadeOutSeconds: params.bgm.fadeOutSeconds,
        }
      : undefined,
  };
};
