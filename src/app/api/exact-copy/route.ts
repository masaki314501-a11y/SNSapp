/**
 * 完全模倣(EC)の1段を実行するAPI。今までの工程のAPI(src/app/api/edit-step/route.ts、1123の時の物)の写しから始め、
 * 完全模倣の直しはこちらだけに入れる。中の段の順番は、編集マニュアルの手順(工程1〜13)のとおり。チェック項目(工程14)は行わない。
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_CLIPS, MIN_CLIPS } from "@video/templates/standard/schema";
import type { CaptionFontSize, CaptionStyle } from "@video/shared/schema";
import { VIDEO_PATH_PATTERN, resolveUploadedVideo } from "@/lib/uploadedVideo";
import { isStyleReferencePath, resolveStyleReference } from "@/lib/styleReference";
import { analyzeSpeechActivity, snapToQuiet } from "@/lib/audio/speechActivity";
import { transcribeCaptions } from "@/lib/gemini/transcribeCaptions";
import { toFriendlyErrorMessage } from "@/lib/friendlyError";
import type { ProjectSegment } from "@/lib/videoProject";
import {
  applyEmphasis,
  buildObjects,
  chinCaptionY,
  emphasisEffects,
  framingForFace,
  referenceCaptionY,
  placeMainFootage,
  removeLongSilences,
  removeRanges,
  smoothJoins,
  splitByCaptions,
  captionRuns,
  markContinuedCaptions,
  placeFrameFills,
  replaceCaptions,
  tooLongCaptions,
  trimBeforeSpeech,
  withContinuedKeys,
  type FrameFill,
  type StepState,
} from "@/lib/editSteps/logic";
import { captionBandHeight } from "@/lib/editSteps/logic";
import { buildTemplateObjects, effectiveKind, placeTemplateFills, templateCaption, TOPIC_FRAME, type ReferenceTemplate } from "@/lib/editSteps/template";
import { extractReferenceTemplate as findReferenceTemplate, measureFace } from "@/lib/exactCopy/extract";
import { figureArea, figureImageColors, figureViewBoxHeight, placeFigure, type FigureDraft, type FigureLayer } from "@/lib/editSteps/figure";
import { faceOnScreen } from "@/lib/editSteps/screenBoxes";
import {
  decideObjects,
  detectFace,
  findMistakes,
  pickEmphasis,
  pickLibraryImages,
  pickRemovals,
  proofreadTexts,
  readReferenceLayout,
  shortenCaptions,
  type PlacedObjects,
} from "@/lib/exactCopy/ai";
import { measureLightAdjust } from "@/lib/audio/videoLight";
import { SFX_PRESETS } from "@/components/editor/audioPresets";
import { measureMarkerStroke, readReferenceEvents } from "@/lib/exactCopy/events";
import { referenceIdOf } from "@/lib/exactCopy/extract";
import { clearUnderCta, framingExact, holdPopups, placeCtaStages, withBandOpacity } from "@/lib/exactCopy/objects";
import { applyExactEffects, captionLimitOf, planImitation, type ExactEffects } from "@/lib/exactCopy/imitate";
import { libraryImageSrc, loadImageLibrary } from "@/lib/imageLibrary";
import { isSmallTypoFix, isWhiteOrBlack, runChecklist, type CheckItem } from "@/lib/editSteps/checklist";
import { CAPTION_FONT_FAMILY_OPTIONS, type CaptionFontFamily } from "@video/shared/schema";

export const runtime = "nodejs";
// AIに頼む工程は、動画のアップロードと答えを待つので数十秒かかる
export const maxDuration = 300;

const requestSchema = z.object({
  step: z.number().int().min(1).max(14),
  videoPath: z.string().regex(VIDEO_PATH_PATTERN),
  videoDurationInSeconds: z.number().positive(),
  keepRanges: z.array(z.object({ startFromSeconds: z.number(), durationInSeconds: z.number() })),
  state: z.object({
    segments: z.array(z.any()),
    framing: z.any().nullable(),
    captionYPercent: z.number().nullable(),
    captionFontSize: z.enum(["small", "medium", "large", "xlarge"]).nullable().optional(),
    globalShapes: z.array(z.any()),
    globalOverlays: z.array(z.any()),
    videoAdjust: z.any().nullable().optional(),
    bgm: z.any().nullable().optional(),
    captionLook: z.any().nullable().optional(),
    // 以前はここに無く、受け取る時に捨てていた(工程12で枠の項目名の時刻を合わせ直せていなかった)
    frameFills: z.array(z.any()).optional(),
    figure: z.any().nullable().optional(),
    figureImages: z.array(z.any()).optional(),
    figureTexts: z.array(z.any()).optional(),
    // 型の字幕の置き方(工程7)と、型で作ったタイトル(工程8→10で枠を並べ直す時に使う)。
    // ここに無いと受け取る時に捨てられ、工程8以降で字幕が真ん中・下端固定なしに戻っていた
    captionLayout: z.any().nullable().optional(),
    templateTitle: z.string().optional(),
    // 以下に無い項目も捨てずに受け取る(項目を足した時に、ここへ書き忘れて工程の間で消える事が続いたため)
  }).passthrough(),
  /** 完成動画の長さの上限(秒)。お客様の指定が無ければ30秒。 */
  targetSeconds: z.number().positive().optional(),
  /** 工程13で入れるBGM(工程ごとの編集の画面で選んだ物)。 */
  bgm: z.object({ src: z.string(), label: z.string() }).nullable().optional(),
  /** どこに出す動画か(チェックのセーフティゾーン)。 */
  zone: z.enum(["tiktok", "ad"]).optional(),
  /** 左上のタイトル(工程8)。指定があればAIの案の代わりにそのまま使う。 */
  title: z.string().max(40).optional(),
  /** 見た目の手本(ステップ3で選んだスクショ・動画の場所)。工程8・10で、一番優先する手本として見せる。 */
  styleReferences: z.array(z.string()).max(10).optional(),
  /** 動画全体に出す画像(編集画面で足した物。チェックの画像の出どころに使う)。 */
  globalImages: z.array(z.any()).optional(),
  look: z.object({
    captionStyle: z.string(),
    fontSize: z.string(),
    primaryColor: z.string(),
    fontFamily: z.string().optional(),
    captionTextStyleId: z.string().optional(),
    hasBgm: z.boolean().optional(),
  }),
});

/** 下の決まった位置の字幕の上端(%)。顎の下に置けない時の、枠を並べる下の限界に使う。 */
const BOTTOM_CAPTION_TOP_PERCENT = 82;
/** BGMの音量(話し声が聞き取れる小ささ)と、入り・終わりで音量を変える秒数。 */
const BGM_VOLUME = 0.15;
const BGM_FADE_IN_SECONDS = 0.3;
const BGM_FADE_OUT_SECONDS = 1.5;

const fmt = (seconds: number) => `${(Math.round(seconds * 10) / 10).toFixed(1)}秒`;
const totalSeconds = (segments: ProjectSegment[]) => segments.reduce((sum, segment) => sum + segment.durationInSeconds, 0);
const segmentRanges = (segments: ProjectSegment[]) =>
  segments.map((segment) => ({ start: segment.startFromSeconds, end: segment.startFromSeconds + segment.durationInSeconds }));

/**
 * 工程ごとの編集(編集マニュアルの1〜11)を1つ実行する。今の状態(state)を受け取り、その工程を済ませた状態と、
 * 何をしたかの説明(先方の確認用)を返す。前の工程の結果を土台にするので、工程は1から順に呼ぶ。
 */
export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "リクエスト内容が不正です", issues: parsed.error.issues }, { status: 400 });
  }
  const { step, videoPath, keepRanges, look } = parsed.data;
  const video = await resolveUploadedVideo(videoPath);
  if (!video) return NextResponse.json({ error: "動画が見つかりません。最初の画面から動画を選び直してください" }, { status: 404 });

  const state = parsed.data.state as StepState;
  const segments = state.segments as ProjectSegment[];
  const newKey = () => randomUUID();
  // 字幕の大きさは、工程7で見た目の手本に合わせた時はそれを使う
  const captionLook = { style: look.captionStyle as CaptionStyle, fontSize: (state.captionFontSize ?? look.fontSize) as CaptionFontSize };
  // 見た目の手本(工程8・10で使う)。見つからない物は外す
  const resolvePairs = async () =>
    (
      await Promise.all(
        (parsed.data.styleReferences ?? [])
          .filter(isStyleReferencePath)
          .map(async (referencePath) => ({ referencePath, file: await resolveStyleReference(referencePath) }))
      )
    ).flatMap((pair) => (pair.file ? [{ referencePath: pair.referencePath, file: pair.file }] : []));
  const resolveReferences = async () => (await resolvePairs()).map((pair) => pair.file);

  // 見た目の手本の型(手本から自動で読み取った見た目・並べ方・出し方)。あれば工程6〜10は型どおりにし、AIには中身だけを決めてもらう。
  // 読み取りには時間がかかるので、型を使う工程(6〜14)の時だけ読む(同じ手本なら2回目からは覚えた物)
  const template: ReferenceTemplate | null =
    step >= 6
      ? await resolvePairs().then((pairs) =>
          findReferenceTemplate(
            pairs.map((pair) => pair.file),
            pairs.map((pair) => pair.referencePath)
          )
        )
      : null;
  // 枠・カードに項目を入れる(型があれば型どおりに)
  // (型があっても、話の内容が手本の出し方と違って、話に合わせた枠を置いた時は、その枠は今までの入れ方。最後の一言だけ型どおり)
  const fillsFor = (next: StepState): StepState => {
    if (!template) return placeFrameFills(next);
    const own = effectiveKind(next, template) === "none" && next.globalShapes.some((shape) => shape.kind === "rect" && !shape.decorative);
    // EC-6: 項目の大きな写真を、手本と同じく次の項目が出るまで出したままにする
    return holdPopups(placeTemplateFills(own ? placeFrameFills(next) : next, template), template, totalSeconds(next.segments as ProjectSegment[]));
  };

  try {
    const run = async (): Promise<{ state: StepState; note: string; details?: string[]; checks?: CheckItem[] }> => {
      switch (step) {
        case 1: {
          const placed = placeMainFootage(keepRanges, newKey);
          return {
            state: { segments: placed, framing: null, captionYPercent: null, globalShapes: [], globalOverlays: [] },
            note: `使う範囲${placed.length}区間・合計${fmt(totalSeconds(placed))}を並べました`,
          };
        }
        case 2: {
          const { spans } = await analyzeSpeechActivity(video.absolutePath);
          const result = trimBeforeSpeech(segments, spans);
          return {
            state: { ...state, segments: result.segments },
            note: result.removedSeconds > 0 ? `話し始める前の${fmt(result.removedSeconds)}を削除しました` : "話し始める前の不要な部分はありませんでした",
          };
        }
        case 3: {
          const activity = await analyzeSpeechActivity(video.absolutePath);
          const cuts = await findMistakes({ absolutePath: video.absolutePath, mimeType: video.mimeType, ranges: segmentRanges(segments) });
          // 切れ目は、言葉の途中で切れないよう近くの静かな所へ寄せる
          const snapped = cuts.map((cut) => ({ start: snapToQuiet(activity, cut.start), end: snapToQuiet(activity, cut.end) }));
          return {
            state: { ...state, segments: removeRanges(segments, snapped, newKey) },
            note: cuts.length > 0 ? `言い間違い・詰まりを${cuts.length}か所カットしました` : "言い間違い・詰まりは見つかりませんでした",
            details: cuts.map((cut) => `${fmt(cut.start)}〜${fmt(cut.end)} ${cut.reason}「${cut.text}」`),
          };
        }
        case 4: {
          const { spans } = await analyzeSpeechActivity(video.absolutePath);
          const result = removeLongSilences(segments, spans, newKey);
          return {
            state: { ...state, segments: result.segments },
            note: result.count > 0 ? `長い無音を${result.count}か所・合計${fmt(result.removedSeconds)}削除しました` : "長い無音はありませんでした",
          };
        }
        case 5: {
          const activity = await analyzeSpeechActivity(video.absolutePath);
          const result = smoothJoins(segments, (seconds) => snapToQuiet(activity, seconds), activity.spans);
          return {
            state: { ...state, segments: result.segments },
            note: `つなぎ目を整えました(静かな所へ寄せた切れ目${result.snapped}か所・外した短い切れ端${result.dropped}個・つないだ所${result.merged}か所)。完成の長さ${fmt(totalSeconds(result.segments))}`,
          };
        }
        case 6: {
          // EC-7: 手本とカット動画の顔を、同じ測り方(目盛り付きの場面の絵5枚)で測ってそろえる
          const firstReference = (await resolvePairs())[0]?.file;
          const measuredReference = firstReference ? await measureFace(firstReference) : null;
          const measuredCut = measuredReference ? await measureFace({ absolutePath: video.absolutePath, mimeType: video.mimeType, kind: "video" }) : null;
          const face = measuredCut
            ? { ...measuredCut, widthPercent: measuredCut.heightPercent * (9 / 16) * 1.2 }
            : await detectFace({ absolutePath: video.absolutePath, mimeType: video.mimeType });
          if (!face) return { state: { ...state, framing: null }, note: "顔が見つからなかったため、拡大しませんでした" };
          // 見た目の手本があれば、手本の人物と同じ位置・大きさに映るように寄せる(型があれば、型に測っておいた位置)
          const target = measuredReference ?? (template ? template.face : (await readReferenceLayout(await resolveReferences()))?.face);
          if (target) {
            const matched = framingExact(face, target);
            return {
              state: { ...state, framing: matched, segments: segments.map((segment) => ({ ...segment, faceBox: face })) },
              note: matched
                ? `見た目の手本に合わせて、顔が横${Math.round(target.xPercent)}%・縦${Math.round(target.yPercent)}%の所に映るよう、${matched.scale}倍に拡大しました`
                : "顔の位置と大きさが、すでに見た目の手本とほぼ同じなので、拡大しませんでした",
            };
          }
          const framing = framingForFace(face);
          return {
            state: { ...state, framing, segments: segments.map((segment) => ({ ...segment, faceBox: face })) },
            note: framing
              ? `顔の中心(縦${Math.round(face.yPercent)}%)が中央より少し上に来るよう、${framing.scale}倍に拡大しました`
              : `顔の中心が縦${Math.round(face.yPercent)}%で、すでに中央より少し上にあるため、拡大しませんでした`,
          };
        }
        case 7: {
          if (template) {
            const placed = templateCaption(template);
            const sizeLabel = { small: "小", medium: "中", large: "大", xlarge: "特大" }[placed.fontSize];
            return {
              state: {
                ...state,
                captionYPercent: placed.yPercent,
                captionFontSize: placed.fontSize,
                captionLayout: placed.layout,
                segments: segments.map((segment) => ({ ...segment, clipCaptionPosition: undefined })),
              },
              note: `見た目の手本から読み取った型どおりに、字幕を画面の上から${placed.yPercent}%・横${placed.layout.xPercent}%の所に、大きさ「${sizeLabel}」で固定しました`,
            };
          }
          // 見た目の手本があれば、手本の字幕と同じ高さ・大きさにする
          const reference = (await readReferenceLayout(await resolveReferences()))?.caption;
          if (reference) {
            const fittedLook = { style: captionLook.style, fontSize: reference.fontSize };
            const y = referenceCaptionY(reference.topPercent, fittedLook);
            const sizeLabel = { small: "小", medium: "中", large: "大", xlarge: "特大" }[reference.fontSize];
            return {
              state: {
                ...state,
                captionYPercent: y,
                captionFontSize: reference.fontSize,
                captionLayout: null,
                segments: segments.map((segment) => ({ ...segment, clipCaptionPosition: undefined })),
              },
              note: `見た目の手本に合わせて、字幕を画面の上から${y}%の所に、大きさ「${sizeLabel}」で固定しました`,
            };
          }
          const face = segments.find((segment) => segment.faceBox)?.faceBox;
          const y = face ? chinCaptionY(face, state.framing, captionLook) : null;
          return {
            state: {
              ...state,
              captionYPercent: y,
              captionLayout: null,
              segments: segments.map((segment) => ({ ...segment, clipCaptionPosition: undefined })),
            },
            note: y !== null ? `字幕を演者の顎の少し下(画面の上から${y}%)に固定しました` : "顎の下に字幕が収まらないため、画面の下に固定しました",
          };
        }
        case 8: {
          const captionTopPercent = state.captionYPercent ?? BOTTOM_CAPTION_TOP_PERCENT;
          const captionBottomPercent =
            state.captionYPercent !== null ? state.captionYPercent + captionBandHeight(captionLook.style, captionLook.fontSize) : undefined;
          // AIが図を描く場所(人と字幕に重ならない、空いた所)。置ける所が無ければ、図は選ばせない
          const face = segments.find((segment) => segment.faceBox)?.faceBox;
          const area = figureArea({
            captionTopPercent,
            captionBottomPercent,
            faceBottomPercent: face ? faceOnScreen(face, state.framing, undefined).bottom : undefined,
          });
          const references = await resolveReferences();
          const referenceLayout = template ? null : await readReferenceLayout(references);
          const objects = await decideObjects({
            absolutePath: video.absolutePath,
            mimeType: video.mimeType,
            references,
            figureViewBoxHeight: area ? figureViewBoxHeight(area) : null,
            template: template
              ? { titleLines: template.title.lineCount, kind: template.kind, wording: template.title.wording, hasCta: Boolean(template.cta) }
              : undefined,
          });
          // タイトルの指定があれば、文言はそれを使う(見た目と枠の数はAIの案のまま)
          const fixedTitle = parsed.data.title?.trim();
          if (fixedTitle) objects.title = fixedTitle;
          if (template) {
            // 話の内容が手本の出し方と合う時は、手本の型どおりに枠・カードを置く。
            // 合わない時(手本はランキングなのに話は比べる内容など)は、話の内容を優先して、話に合う物を置く(タイトルと字幕の見た目は手本のまま)
            const matches = objects.layout === template.kind;
            const kind = matches ? template.kind : "none";
            const built = withBandOpacity(buildTemplateObjects({ template, title: objects.title, frameCount: objects.frameCount, kind }), template);
            const own = !matches && objects.layout !== "none"
              ? buildObjects({
                  title: objects.title,
                  layout: objects.layout,
                  frameCount: objects.frameCount,
                  captionTopPercent,
                  captionBottomPercent,
                  accentColor: look.primaryColor,
                  style: objects.look,
                })
              : null;
            const figure: FigureDraft | null =
              !matches && objects.figure && area
                ? { box: area, viewBoxHeight: figureViewBoxHeight(area), idea: objects.figure.idea, base: objects.figure.base, parts: [], fontFamily: objects.look.title.fontFamily }
                : null;
            const frameTotal = built.globalShapes.filter((shape) => !shape.decorative).length;
            const placedNote = matches
              ? kind === "ranking"
                ? `。ランキングの枠を${frameTotal}個並べました(数は話している項目の数に合わせました)`
                : kind === "compare"
                  ? `。比べるカードを${frameTotal}枚並べました(数は比べている物の数に合わせました)`
                  : ""
              : `。話の内容(${{ ranking: "ランキング", compare: "比べる", figure: "図で見せる", none: "枠なし" }[objects.layout]})が手本の出し方と違うため、話の内容に合わせて置きました`;
            return {
              state: placeFigure({
                ...state,
                // 話に合わせて置いた物のうち、タイトル(1つ目)は手本の型の物を使う
                globalOverlays: [...built.globalOverlays, ...(own ? own.globalOverlays.slice(1) : [])],
                globalShapes: [...built.globalShapes, ...(own?.globalShapes ?? [])],
                frameFills: [],
                figure,
                templateTitle: objects.title,
                templateKind: kind,
                templateCta: template.cta ? objects.cta : undefined,
                templateMarks: [],
                fillImageSrcs: {},
              }),
              note: `見た目の手本から読み取った型どおりに、タイトル「${objects.title.replace(/\n/g, "")}」を置きました${placedNote}`,
              details: [
                "書体・色・帯・位置・大きさ・出方は手本どおり。文言と数だけ、この動画の話に合わせました",
                ...(template.cta && objects.cta ? [`最後の一言: 「${objects.cta.replace(/\n/g, "")}」(手本と同じ見た目で、動画の最後に出します)`] : []),
                objects.reason,
              ],
            };
          }
          const built = buildObjects({
            title: objects.title,
            layout: objects.layout,
            frameCount: objects.frameCount,
            captionTopPercent,
            captionBottomPercent,
            accentColor: look.primaryColor,
            style: objects.look,
            placement: referenceLayout ?? undefined,
          });
          const figure: FigureDraft | null =
            objects.figure && area
              ? {
                  box: area,
                  viewBoxHeight: figureViewBoxHeight(area),
                  idea: objects.figure.idea,
                  base: objects.figure.base,
                  parts: [],
                  fontFamily: objects.look.title.fontFamily,
                }
              : null;
          const fontLabel = (value: string) => CAPTION_FONT_FAMILY_OPTIONS.find((option) => option.value === value)?.label ?? value;
          const placedNote =
            objects.layout === "compare"
              ? "。2つを比べる動画なので、下に比べるカードを2枚並べました"
              : objects.layout === "ranking"
                ? `。ランキングの枠を${objects.frameCount}個並べました`
                : figure
                  ? `。話の中身を見せる図の土台を描きました(${figure.idea})`
                  : "(枠や図は無し)";
          return {
            state: placeFigure({
              ...state,
              globalOverlays: built.globalOverlays,
              globalShapes: built.globalShapes,
              frameFills: [],
              figure,
            }),
            note: `左上のタイトル「${objects.title.replace(/\n/g, "")}」を作りました${placedNote}`,
            details: [
              `タイトルの見た目: 書体「${fontLabel(objects.look.title.fontFamily)}」・文字${objects.look.title.textColor}・縁取り${objects.look.title.strokeColor ?? "なし"}・帯${objects.look.title.bandColor ?? "なし"}`,
              ...(objects.layout === "ranking" || objects.layout === "compare"
                ? [`枠の見た目: 線${objects.look.frame.borderColor}(${objects.look.frame.borderWidthPx}px)・塗り${objects.look.frame.fillColor ?? "なし"}・角の丸み${objects.look.frame.cornerRadiusPx}px・番号${objects.look.frame.numberColor}`]
                : []),
              ...(referenceLayout?.title || referenceLayout?.frames
                ? [`位置: 見た目の手本に合わせて置きました(${[referenceLayout.title ? "タイトル" : "", referenceLayout.frames && objects.layout === "ranking" ? "枠" : ""].filter(Boolean).join("・") || "なし"})`]
                : []),
              objects.reason,
            ],
          };
        }
        case 9: {
          const transcribed = await transcribeCaptions({
            absoluteVideoPath: video.absolutePath,
            mimeType: video.mimeType,
            videoDurationInSeconds: parsed.data.videoDurationInSeconds,
            minClips: MIN_CLIPS,
            maxClips: MAX_CLIPS,
          });
          const phrases = transcribed.map((item) => ({
            start: item.startFromSeconds,
            end: item.startFromSeconds + item.durationInSeconds,
            text: item.caption,
          }));
          // カットの切れ目が言葉の途中にあると、同じ字幕が2つのクリップに続くので、2つ目は出し直しの動きをしない
          const split = markContinuedCaptions(splitByCaptions(segments, phrases, newKey));
          // 話すのが速くて読み切れない字幕は、意味を変えずに短くする(チェック項目: テロップの表示時間は適切か)
          const tooLong = tooLongCaptions(split);
          const shortened = await shortenCaptions(tooLong.map((run) => ({ text: run.text, maxChars: run.maxChars })));
          const replacements = new Map<string, string>(tooLong.flatMap((run, index) => (shortened[index] !== run.text ? [[run.text, shortened[index]] as const] : [])));
          const readable = replaceCaptions(split, replacements);
          // EC-3: 字幕の長さを手本に合わせる(手本の字幕の長さより長い字幕は、意味を変えずに手本の長さまで縮める)
          const firstPair = (await resolvePairs())[0];
          const events = firstPair && template ? await readReferenceEvents(firstPair.file, referenceIdOf(firstPair.referencePath)) : null;
          const limit = events ? captionLimitOf(events) : null;
          const longRuns = limit ? captionRuns(readable).filter((run) => [...run.text.replace(/\s/g, "")].length > limit) : [];
          const fitted = await shortenCaptions(longRuns.map((run) => ({ text: run.text, maxChars: limit ?? 99 })));
          for (const [index, run] of longRuns.entries()) if (fitted[index] && fitted[index] !== run.text) replacements.set(run.text, fitted[index]);
          const replaced = replaceCaptions(readable, replacements);
          // 型で、冒頭に真ん中へ大きくタイトルを出す時は、その間は字幕を出さない(手本と同じく、タイトルだけを見せる)
          const introSeconds = template?.title.intro?.seconds ?? 0;
          let elapsed = 0;
          let hidden = 0;
          const captioned = replaced.map((segment) => {
            const start = elapsed;
            elapsed += segment.durationInSeconds;
            if (start >= introSeconds || !segment.caption.trim()) return segment;
            hidden++;
            return { ...segment, caption: "" };
          });
          return {
            state: { ...state, segments: captioned },
            note: `字幕を${captioned.filter((segment) => segment.caption.trim()).length}個入れました(位置は工程7で固定)${replacements.size > 0 ? `。話すのが速い所の${replacements.size}個は、読める長さに短くしました` : ""}${hidden > 0 ? `。冒頭の${introSeconds}秒は、見た目の手本の型どおりタイトルだけを大きく出すので、その間の字幕${hidden}個は出しません` : ""}`,
            details: [...replacements].map(([before, after]) => `「${before.replace(/\n/g, "")}」→「${after.replace(/\n/g, "")}」`),
          };
        }
        case 10: {
          const withCaption = segments.filter((segment) => segment.caption.trim());
          // 工程8で使った色(タイトル・枠。白・黒は除く)。字幕の色と合わせて3色以内にするため、AIに伝える
          const objectColors = [
            ...new Set(
              [
                ...state.globalOverlays.flatMap((overlay) => [overlay.color, overlay.strokeColor, overlay.backgroundColor]),
                ...state.globalShapes.flatMap((shape) => [shape.borderColor, shape.fillColor]),
                ...(state.figureImages ?? []).flatMap((image) => figureImageColors(image.src)),
                ...(state.figureTexts ?? []).flatMap((text) => [text.color, text.strokeColor]),
              ]
                .filter((value): value is string => Boolean(value))
                .filter((value) => !isWhiteOrBlack(value))
                .map((value) => value.toUpperCase())
            ),
          ];
          const rects = state.globalShapes.filter((shape) => shape.kind === "rect" && !shape.decorative);
          // 型どおりに置いた出し方(話の内容が手本と違った時は none になっていて、話に合わせて置いた枠を今まで通りに扱う)
          const kind = template ? effectiveKind(state, template) : "none";
          const objects: PlacedObjects = template && kind === "compare" && template.compare
            ? {
                kind: "frames",
                layout: "compare",
                frameCount: rects.length,
                topicHeading: Boolean(template.compare.topic),
                cardContent: template.compare.content,
                marker: Boolean(template.compare.marker),
              }
            : template && kind === "ranking"
            ? { kind: "frames", layout: "ranking", frameCount: rects.length }
            : state.figure
            ? { kind: "figure", idea: state.figure.idea, viewBoxHeight: state.figure.viewBoxHeight, base: state.figure.base }
            : rects.length >= 2
              ? {
                  kind: "frames",
                  layout: rects.length === 2 && rects[0].yPercent === rects[1].yPercent ? "compare" : "ranking",
                  frameCount: rects.length,
                }
              : { kind: "none" };
          const { picks: aiPicks, look: aiLook, lookReason: aiLookReason, frameItems, figureItems, marks } = await pickEmphasis({
            absolutePath: video.absolutePath,
            mimeType: video.mimeType,
            captions: withCaption.map((segment) => segment.caption),
            objectColors,
            objects,
            references: await resolveReferences(),
            emphasisRoles: template?.emphasisStyles.map((style) => style.role),
          });
          // EC-3: 手本の出来事の一覧に沿って、字幕ごとの強調・出る時の動き・寄り・効果音を決め直す(手本の動画1本だけを見る)
          const firstPair = (await resolvePairs())[0];
          const events = firstPair && template ? await readReferenceEvents(firstPair.file, referenceIdOf(firstPair.referencePath)) : null;
          // EC-11: 手本の丸の線の太さを画面から測って、型の丸に使う
          const markerStroke =
            events && firstPair && template?.compare?.marker ? await measureMarkerStroke(firstPair.file, events, template.compare.marker.color).catch(() => null) : null;
          if (markerStroke && template?.compare?.marker) template.compare.marker = { ...template.compare.marker, strokeWidthPx: markerStroke };
          const plan =
            events && template
              ? await planImitation({
                  events,
                  // EC-10: 字幕ごとに、そこで起きる物(丸・項目の写真や名前・話題の見出し)も伝える(手本では、丸・強調・音が同時に出ていた)
                  rows: withCaption.map((segment, index) => ({
                    text: segment.caption,
                    seconds: segment.durationInSeconds,
                    objects: [
                      ...(marks.some((mark) => mark.index === index) ? ["選ばれた方のカードに丸が付く"] : []),
                      ...frameItems
                        .filter((item) => item.index === index)
                        .map((item) => (item.frame === TOPIC_FRAME ? `話題の見出し「${item.label}」が出る` : `項目「${item.label}」の絵・名前が出る`)),
                    ],
                  })),
                  totalSeconds: totalSeconds(segments),
                  emphasisStyles: template.emphasisStyles.map((style) => ({
                    role: style.role,
                    look: `書体${style.fontFamily}・字${style.textColor}・縁${style.strokeColor ?? "なし"}・帯${style.bandColor ?? "なし"}`,
                  })),
                  sounds: SFX_PRESETS.map((preset) => ({ id: preset.id, label: preset.label })),
                }).catch((error: unknown) => {
                  console.warn("[exact-copy] 手本の当てはめができませんでした", error);
                  return null;
                })
              : null;
          const picks = plan
            ? plan.flatMap((row) => (row.emphasis === null ? [] : [{ index: row.index, reason: "手本の出来事に合わせて強調", style: row.emphasis }]))
            : aiPicks;
          // 型がある時は、字幕の見た目は型どおり(AIが決めるのは、どの字幕を強調するか・どの種類の見た目にするかと、枠に入れる項目だけ)
          const emphasisLookOf = (style: number) => {
            const chosenStyle = template?.emphasisStyles[style] ?? template?.emphasisStyles[0];
            return chosenStyle
              ? {
                  fontFamily: chosenStyle.fontFamily,
                  textColor: chosenStyle.textColor,
                  bandColor: chosenStyle.bandColor,
                  ...(chosenStyle.strokeColor ? { strokeColor: chosenStyle.strokeColor } : {}),
                  ...(chosenStyle.outerStroke ? { outerStroke: chosenStyle.outerStroke } : {}),
                }
              : aiLook.emphasis;
          };
          const chosen = template
            ? {
                base: { fontFamily: template.caption.fontFamily, style: template.caption.style, accentColor: template.caption.accentColor },
                emphasis: emphasisLookOf(0),
              }
            : aiLook;
          const lookReason = template ? `字幕の見た目は、見た目の手本から読み取った型どおりにしました` : aiLookReason;
          // 同じ字幕が続くクリップ(カットの切れ目の後)も、そろえて強調する。見た目の種類ごとに付ける
          const keys = withContinuedKeys(segments, new Set(picks.map((pick) => withCaption[pick.index].key)));
          let emphasized = applyEmphasis(segments, keys, chosen.emphasis, chosen.base);
          if (template && template.emphasisStyles.length >= 2) {
            for (let style = 0; style < template.emphasisStyles.length; style++) {
              const styleKeys = withContinuedKeys(
                segments,
                new Set(picks.filter((pick) => pick.style === style).map((pick) => withCaption[pick.index].key))
              );
              if (styleKeys.size === 0) continue;
              const styled = applyEmphasis(segments, styleKeys, emphasisLookOf(style), chosen.base);
              const glow = template.emphasisStyles[style].glowColor;
              const scale = template.emphasisStyles[style].scale;
              // E44: 縁の外側のもう1本の線(applyEmphasis は今までの作り方と共有なので、ここで付け足す)
              const outerStroke = template.emphasisStyles[style].outerStroke;
              emphasized = emphasized.map((segment, i) =>
                styleKeys.has(segment.key)
                  ? {
                      ...segment,
                      captionEmphasis: styled[i].captionEmphasis
                        ? { ...styled[i].captionEmphasis, ...(scale ? { scale } : {}), ...(outerStroke ? { outerStroke } : {}) }
                        : undefined,
                      ...(glow ? { captionGlowColor: glow } : {}),
                    }
                  : segment
              );
            }
          } else if (template?.emphasisStyles[0]?.scale) {
            const scale = template.emphasisStyles[0].scale;
            const glow = template.emphasisStyles[0].glowColor;
            const outerStroke = template.emphasisStyles[0].outerStroke;
            emphasized = emphasized.map((segment) =>
              keys.has(segment.key) && segment.captionEmphasis
                ? { ...segment, captionEmphasis: { ...segment.captionEmphasis, scale, ...(outerStroke ? { outerStroke } : {}) }, ...(glow ? { captionGlowColor: glow } : {}) }
                : segment
            );
          } else if (template?.emphasisStyles[0]?.glowColor) {
            const glow = template.emphasisStyles[0].glowColor;
            emphasized = emphasized.map((segment) => (keys.has(segment.key) ? { ...segment, captionGlowColor: glow } : segment));
          }
          // EC-3: 字幕が出る時の動きを、手本のその役目の字幕と同じにする。寄りと効果音は工程11で付けるので覚えておく
          const exactEffects: ExactEffects = {};
          if (plan) {
            const rowOf = new Map(plan.map((row) => [withCaption[row.index].key, row]));
            emphasized = emphasized.map((segment) => {
              const row = rowOf.get(segment.key);
              if (!row) return segment;
              exactEffects[segment.key] = { zoom: row.zoom, sfx: row.sfx };
              // E44: 強調の色は、型を読み取る時に画面から測った「強調の見た目の種類ごとの色」を使う
              // (EC-8 の、AIが答えた色を強調1回ごとに写すやり方はやめた。AIの色は #0000FF のように実際と違ったため)
              const withLook = segment;
              return segment.captionAnimation === "none" ? withLook : { ...withLook, captionAnimation: row.animation };
            });
            // 同じ字幕の続き(カットの切れ目の後)は、前のクリップと同じ強調の見た目にする
            emphasized = emphasized.map((segment, i, all) =>
              segment.captionEmphasis && all[i - 1]?.captionEmphasis && all[i - 1].caption === segment.caption
                ? { ...segment, captionEmphasis: all[i - 1].captionEmphasis }
                : segment
            );
          }
          // ランキング・「〇選」の枠に、項目名を入れる(言い始めた時から最後まで出す)
          const frameFills: FrameFill[] = frameItems.map((item) => ({
            frame: item.frame,
            key: withCaption[item.index].key,
            sourceSeconds: withCaption[item.index].startFromSeconds,
            label: item.label,
          }));
          // 比べる動画で、選ばれた方に丸を付ける所(言い切った字幕のクリップで覚える)
          const templateMarks = marks.map((mark) => ({
            frame: mark.frame,
            key: withCaption[mark.index].key,
            sourceSeconds: withCaption[mark.index].startFromSeconds,
          }));
          // 型のランキングで、工程8で並べた枠が、話した項目より多い時は、項目の数に合わせて並べ直す(空の枠を残さない)
          const usedFrames = Math.max(0, ...frameFills.map((fill) => fill.frame));
          const regrown =
            template && kind === "ranking" && state.templateTitle && usedFrames >= 2 && usedFrames < rects.length
              ? withBandOpacity(buildTemplateObjects({ template, title: state.templateTitle, frameCount: usedFrames, kind }), template)
              : null;
          // 枠・カードの中身が絵の型では、項目ごとに画像の棚から合う絵を選ぶ(合う物が無ければ、項目名の文字にする)
          const wantsImages =
            (kind === "ranking" && template?.frames?.content === "image") || (kind === "compare" && template?.compare?.content === "image");
          const imageLabels = wantsImages
            ? [...new Set(frameFills.filter((fill) => kind === "ranking" || fill.frame !== TOPIC_FRAME).filter((fill, _, all) => kind === "ranking" || all.find((other) => other.frame === fill.frame) === fill).map((fill) => fill.label))]
            : [];
          const library = imageLabels.length > 0 ? await loadImageLibrary().catch(() => []) : [];
          const imagePicks = library.length > 0 ? await pickLibraryImages(imageLabels, library).catch(() => imageLabels.map(() => null)) : [];
          const fillImageSrcs = Object.fromEntries(
            imageLabels.flatMap((label, i) => {
              const pick = imagePicks[i];
              return pick !== null && pick !== undefined && library[pick] ? [[label, libraryImageSrc(library[pick])] as const] : [];
            })
          );
          // 図に、話に合わせて部品を足す(その中身を言う字幕の時から最後まで出す)
          const figure: FigureDraft | null = state.figure
            ? {
                ...state.figure,
                parts: figureItems.map((item) => ({
                  svg: item.svg,
                  texts: item.texts,
                  label: item.label,
                  key: withCaption[item.index].key,
                  sourceSeconds: withCaption[item.index].startFromSeconds,
                })),
              }
            : null;
          const fontLabel = (value: string) => CAPTION_FONT_FAMILY_OPTIONS.find((option) => option.value === value)?.label ?? value;
          return {
            state: placeFigure(
              fillsFor({
                ...state,
                ...(regrown ? { globalOverlays: regrown.globalOverlays, globalShapes: regrown.globalShapes } : {}),
                segments: emphasized,
                captionLook: { fontFamily: chosen.base.fontFamily, captionStyle: chosen.base.style, primaryColor: chosen.base.accentColor },
                frameFills,
                templateMarks,
                fillImageSrcs,
                figure,
                ...(plan ? { exactEffects } : {}),
              })
            ),
            note: `${regrown ? `話していた項目が${usedFrames}個だったので、ランキングの枠を${usedFrames}個に並べ直しました。` : ""}${picks.length}個の字幕を強調しました${frameFills.length > 0 ? `。枠${new Set(frameFills.map((fill) => fill.frame)).size}個に項目名を入れました${frameFills.length > new Set(frameFills.map((fill) => fill.frame)).size ? `(話題ごとの中身も入れて、合わせて${frameFills.length}回)` : ""}` : ""}${figure && figure.parts.length > 0 ? `。図に、話に合わせて${figure.parts.length}個の部品を足しました` : ""}`,
            details: [
              ...(figure && figure.parts.length > 0
                ? [`図に足した部品: ${figure.parts.map((part) => `「${part.label}」`).join("・")}`]
                : []),
              ...(frameFills.length > 0
                ? [`枠に入れた項目: ${[...frameFills].sort((a, b) => a.frame - b.frame).map((fill) => `${fill.frame}「${fill.label}」`).join("・")}`]
                : []),
              ...(imageLabels.length > 0
                ? [`枠・カードの絵: ${imageLabels.map((label) => `「${label}」${fillImageSrcs[label] ? "→画像の棚の絵" : "→合う絵が無いので文字"}`).join("・")}`]
                : []),
              ...(templateMarks.length > 0
                ? [`選ばれた方の丸: ${templateMarks.map((mark) => `カード${mark.frame}(「${segments.find((segment) => segment.key === mark.key)?.caption.replace(/\n/g, "") ?? ""}」の間)`).join("・")}`]
                : []),
              `ふつうの字幕の見た目: 書体「${fontLabel(chosen.base.fontFamily)}」・${chosen.base.style === "outline" ? "縁取り" : "帯"}${chosen.base.accentColor}`,
              `強調した字幕の見た目: 書体「${fontLabel(chosen.emphasis.fontFamily)}」・文字${chosen.emphasis.textColor}・帯${chosen.emphasis.bandColor ?? "なし"}`,
              lookReason,
              ...picks.map((pick) => `「${withCaption[pick.index].caption.replace(/\n/g, "")}」 ${pick.reason}`),
            ],
          };
        }
        case 11: {
          // EC-3: 工程10で手本の出来事に沿って決めた寄りと効果音を付ける(強調した字幕すべてには付けない)
          const exactEffects = (state as StepState & { exactEffects?: ExactEffects }).exactEffects;
          if (exactEffects) {
            const applied = applyExactEffects(segments, exactEffects);
            return {
              state: { ...state, segments: applied },
              note: `手本の出来事に沿って、${applied.filter((segment) => segment.zoom).length}か所で寄り、${applied.filter((segment) => segment.emphasisSfxPresetId).length}か所で効果音を鳴らしました`,
            };
          }
          const result = emphasisEffects(segments);
          return {
            state: { ...state, segments: result.segments },
            note: `強調した字幕${result.count}個に効果音を付け、少し人物を拡大しました`,
          };
        }
        case 12: {
          // 長さの上限は、短くしたい時だけ指定する(指定が無ければ、動画の長さのまま)
          const target = parsed.data.targetSeconds;
          const total = totalSeconds(segments);
          if (!target) {
            return { state, note: `長さの上限を指定していないので、何も外しませんでした(完成の長さは${fmt(total)})` };
          }
          if (total <= target) {
            return { state, note: `完成の長さが${fmt(total)}で、${target}秒以内に収まっているので、何も外しませんでした` };
          }
          const captioned = segments.filter((segment) => segment.caption.trim());
          const removals = await pickRemovals({
            absolutePath: video.absolutePath,
            mimeType: video.mimeType,
            captions: captioned.map((segment) => ({ text: segment.caption, seconds: segment.durationInSeconds })),
            totalSeconds: total,
            targetSeconds: target,
          });
          const removeKeys = new Set(removals.map((removal) => captioned[removal.index].key));
          const kept = segments.filter((segment) => !removeKeys.has(segment.key));
          return {
            // 場面を外すと後ろの時刻がずれるので、枠の項目名・図の部品が出る時刻を合わせ直す
            state: placeFigure(fillsFor({ ...state, segments: markContinuedCaptions(kept) })),
            note: `${removals.length}個の場面を外し、${fmt(total)}を${fmt(totalSeconds(kept))}にしました${totalSeconds(kept) > target ? `(まだ${target}秒を超えています。「やり直す」を押すか、編集画面で短くしてください)` : ""}`,
            details: removals.map((removal) => `「${captioned[removal.index].caption.replace(/\n/g, "")}」 ${removal.reason}`),
          };
        }
        case 13: {
          // A3・J91・J92・G60: 完全模倣は工程13で終わる(工程14は通らない)ので、締めの段と、締めの間の片付けはここで行う
          const total13 = totalSeconds(segments);
          const closed = template ? clearUnderCta(placeCtaStages(state, template, total13, state.templateCta), template, total13) : state;
          const chosen = parsed.data.bgm;
          if (!chosen) return { state: { ...closed, bgm: null }, note: "BGMは入れませんでした(入れる時は、曲を選んでから「やり直す」を押してください)" };
          return {
            state: {
              ...closed,
              bgm: { src: chosen.src, label: chosen.label, volume: BGM_VOLUME, fadeInSeconds: BGM_FADE_IN_SECONDS, fadeOutSeconds: BGM_FADE_OUT_SECONDS },
            },
            note: `BGM「${chosen.label}」を、動画の頭から話し声より小さな音量で入れ、最後の${fmt(BGM_FADE_OUT_SECONDS)}で下げて動画の終わりと一緒に終わるようにしました`,
          };
        }
        case 14: {
          const { spans } = await analyzeSpeechActivity(video.absolutePath);
          // 光の補正: 映像の明るさを測って整える。誤字・脱字: AIが音声と見比べて候補を出す
          const light = await measureLightAdjust(
            video.absolutePath,
            segmentRanges(segments),
            segments.find((segment) => segment.faceBox)?.faceBox
          );
          // 枠・カードの中身は、入れた言葉(frameFills)のまま確かめる(比べるカードは「名前\n中身」と2行にして出すので、
          // 画面の文字のまま渡すと、AIが「日本5年保証」のようにつながった1つの言葉として見てしまった)
          const fillLabels = [...new Set((state.frameFills ?? []).map((fill) => fill.label))];
          const isFillText = (text: string) => fillLabels.some((label) => text === label || text.endsWith(`\n${label}`));
          const texts = [
            ...state.globalOverlays
              .map((overlay) => String(overlay.text))
              .filter((text) => !/^\d+$/.test(text) && !isFillText(text))
              .map((text) => ({ kind: "タイトル・枠の文字" as const, text })),
            ...fillLabels.map((text) => ({ kind: "タイトル・枠の文字" as const, text })),
            ...(state.figureTexts ?? []).map((overlay) => ({ kind: "タイトル・枠の文字" as const, text: String(overlay.text) })),
            // 切れ目をまたいで同じ字幕が続く所は、見る人には1つの字幕なので、1つにまとめて渡す
            // (そのまま渡すと、AIが「直前の字幕と重複している」と誤って指摘していた)
            ...captionRuns(segments).map((run) => ({ kind: "字幕" as const, text: run.text })),
          ];
          const found = await proofreadTexts({ absolutePath: video.absolutePath, mimeType: video.mimeType, texts });
          // 誤字・脱字は、AIが出した正しい書き方に自動で直す(直した所はチェックの結果に出す)。
          // 直すのは一部だけの小さな物だけ。文字のほとんどを書き換える物や、文字の中に見つからない物は、候補として残す
          const fixedTypos = found.filter(isSmallTypoFix);
          const typos = found.filter((typo) => !isSmallTypoFix(typo));
          const fix = (text: string) =>
            fixedTypos.reduce((current, typo) => (current === typo.text ? current.replace(typo.wrong, typo.correct) : current), text);
          const fixedSegments = segments.map((segment) => (segment.caption.trim() ? { ...segment, caption: fix(segment.caption) } : segment));
          const fixedOverlays = state.globalOverlays.map((overlay) => ({ ...overlay, text: fix(String(overlay.text)) }));
          const fixLayer = <L extends FigureLayer>(layer: L): L => ({ ...layer, texts: layer.texts.map((text) => ({ ...text, text: fix(text.text) })) });
          // 枠・カードの中身を直したら、画面の文字も入れ直す(placeFrameFills)
          const adjusted: StepState = placeFigure(fillsFor({
            ...state,
            figure: state.figure ? { ...state.figure, base: fixLayer(state.figure.base), parts: state.figure.parts.map(fixLayer) } : state.figure,
            segments: fixedSegments,
            globalOverlays: fixedOverlays,
            frameFills: state.frameFills?.map((fill) => ({ ...fill, label: fix(fill.label) })),
            videoAdjust: light.adjust,
          }));
          // A3: 最後の一言が出ている間は、字幕・見出し・枠の物を出さない(手本の締め方)
          // (締めの段と片付けは工程13で行う。工程14は完全模倣では通らないが、通った時も同じになるようにここでも行う)
          const total14 = totalSeconds(adjusted.segments as ProjectSegment[]);
          const closed = template ? clearUnderCta(placeCtaStages(adjusted, template, total14, adjusted.templateCta), template, total14) : adjusted;
          const result = runChecklist({
            state: closed,
            spans,
            look: {
              captionStyle: captionLook.style,
              fontSize: captionLook.fontSize,
              fontFamily: (look.fontFamily ?? "Noto Sans JP") as CaptionFontFamily,
              primaryColor: look.primaryColor,
            },
            captionTextStyleId: look.captionTextStyleId,
            hasBgm: Boolean(state.bgm),
            bgmFade: state.bgm ? { fadeInSeconds: state.bgm.fadeInSeconds, fadeOutSeconds: state.bgm.fadeOutSeconds } : undefined,
            typos,
            fixedTypos,
            zone: parsed.data.zone,
            targetSeconds: parsed.data.targetSeconds ?? null,
            globalImages: parsed.data.globalImages,
            lightAdjusted: light.adjust,
          });
          const ng = result.items.filter((item) => item.status === "ng").length;
          const review = result.items.filter((item) => item.status === "review").length;
          return {
            state: result.state,
            note: ng === 0 ? `自動で確かめる項目はすべて満たしました(目で確かめる項目が${review}つあります)` : `満たしていない項目が${ng}つあります`,
            checks: result.items,
          };
        }
        default:
          throw new Error("工程の番号が不正です");
      }
    };
    return NextResponse.json(await run());
  } catch (error) {
    console.error(`[edit-step] 工程${step}に失敗しました`, error);
    return NextResponse.json({ error: toFriendlyErrorMessage(error, `工程${step}に失敗しました`) }, { status: 500 });
  }
}
