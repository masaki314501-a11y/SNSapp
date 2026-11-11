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
  placeMainFootage,
  removeLongSilences,
  removeRanges,
  smoothJoins,
  splitByCaptions,
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
import { figureArea, figureImageColors, figureViewBoxHeight, placeFigure, type FigureDraft, type FigureLayer } from "@/lib/editSteps/figure";
import { faceOnScreen } from "@/lib/editSteps/screenBoxes";
import { decideObjects, detectFace, findMistakes, pickEmphasis, pickRemovals, proofreadTexts, shortenCaptions, type PlacedObjects } from "@/lib/editSteps/ai";
import { measureLightAdjust } from "@/lib/audio/videoLight";
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
  }),
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
  const captionLook = { style: look.captionStyle as CaptionStyle, fontSize: look.fontSize as CaptionFontSize };
  // 見た目の手本(工程8・10で使う)。見つからない物は外す
  const resolveReferences = async () =>
    (
      await Promise.all(
        (parsed.data.styleReferences ?? []).filter(isStyleReferencePath).map((referencePath) => resolveStyleReference(referencePath))
      )
    ).filter((file): file is NonNullable<typeof file> => file !== null);

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
          const face = await detectFace({ absolutePath: video.absolutePath, mimeType: video.mimeType });
          if (!face) return { state: { ...state, framing: null }, note: "顔が見つからなかったため、拡大しませんでした" };
          const framing = framingForFace(face);
          return {
            state: { ...state, framing, segments: segments.map((segment) => ({ ...segment, faceBox: face })) },
            note: framing
              ? `顔の中心(縦${Math.round(face.yPercent)}%)が中央より少し上に来るよう、${framing.scale}倍に拡大しました`
              : `顔の中心が縦${Math.round(face.yPercent)}%で、すでに中央より少し上にあるため、拡大しませんでした`,
          };
        }
        case 7: {
          const face = segments.find((segment) => segment.faceBox)?.faceBox;
          const y = face ? chinCaptionY(face, state.framing, captionLook) : null;
          return {
            state: { ...state, captionYPercent: y, segments: segments.map((segment) => ({ ...segment, clipCaptionPosition: undefined })) },
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
          const objects = await decideObjects({
            absolutePath: video.absolutePath,
            mimeType: video.mimeType,
            references: await resolveReferences(),
            figureViewBoxHeight: area ? figureViewBoxHeight(area) : null,
          });
          // タイトルの指定があれば、文言はそれを使う(見た目と枠の数はAIの案のまま)
          const fixedTitle = parsed.data.title?.trim();
          if (fixedTitle) objects.title = fixedTitle;
          const built = buildObjects({
            title: objects.title,
            layout: objects.layout,
            frameCount: objects.frameCount,
            captionTopPercent,
            captionBottomPercent,
            accentColor: look.primaryColor,
            style: objects.look,
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
          const replacements = new Map(tooLong.flatMap((run, index) => (shortened[index] !== run.text ? [[run.text, shortened[index]] as const] : [])));
          const captioned = replaceCaptions(split, replacements);
          return {
            state: { ...state, segments: captioned },
            note: `字幕を${captioned.filter((segment) => segment.caption.trim()).length}個入れました(位置は工程7で固定)${replacements.size > 0 ? `。話すのが速い所の${replacements.size}個は、読める長さに短くしました` : ""}`,
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
          const rects = state.globalShapes.filter((shape) => shape.kind === "rect");
          const objects: PlacedObjects = state.figure
            ? { kind: "figure", idea: state.figure.idea, viewBoxHeight: state.figure.viewBoxHeight, base: state.figure.base }
            : rects.length >= 2
              ? {
                  kind: "frames",
                  layout: rects.length === 2 && rects[0].yPercent === rects[1].yPercent ? "compare" : "ranking",
                  frameCount: rects.length,
                }
              : { kind: "none" };
          const { picks, look: chosen, lookReason, frameItems, figureItems } = await pickEmphasis({
            absolutePath: video.absolutePath,
            mimeType: video.mimeType,
            captions: withCaption.map((segment) => segment.caption),
            objectColors,
            objects,
            references: await resolveReferences(),
          });
          // 同じ字幕が続くクリップ(カットの切れ目の後)も、そろえて強調する
          const keys = withContinuedKeys(segments, new Set(picks.map((pick) => withCaption[pick.index].key)));
          // ランキング・「〇選」の枠に、項目名を入れる(言い始めた時から最後まで出す)
          const frameFills: FrameFill[] = frameItems.map((item) => ({
            frame: item.frame,
            key: withCaption[item.index].key,
            sourceSeconds: withCaption[item.index].startFromSeconds,
            label: item.label,
          }));
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
              placeFrameFills({
                ...state,
                segments: applyEmphasis(segments, keys, chosen.emphasis),
                captionLook: { fontFamily: chosen.base.fontFamily, captionStyle: chosen.base.style, primaryColor: chosen.base.accentColor },
                frameFills,
                figure,
              })
            ),
            note: `${picks.length}個の字幕を強調しました${frameFills.length > 0 ? `。枠${frameFills.length}個に項目名を入れました` : ""}${figure && figure.parts.length > 0 ? `。図に、話に合わせて${figure.parts.length}個の部品を足しました` : ""}`,
            details: [
              ...(figure && figure.parts.length > 0
                ? [`図に足した部品: ${figure.parts.map((part) => `「${part.label}」`).join("・")}`]
                : []),
              ...(frameFills.length > 0
                ? [`枠に入れた項目: ${[...frameFills].sort((a, b) => a.frame - b.frame).map((fill) => `${fill.frame}「${fill.label}」`).join("・")}`]
                : []),
              `ふつうの字幕の見た目: 書体「${fontLabel(chosen.base.fontFamily)}」・${chosen.base.style === "outline" ? "縁取り" : "帯"}${chosen.base.accentColor}`,
              `強調した字幕の見た目: 書体「${fontLabel(chosen.emphasis.fontFamily)}」・文字${chosen.emphasis.textColor}・帯${chosen.emphasis.bandColor ?? "なし"}`,
              lookReason,
              ...picks.map((pick) => `「${withCaption[pick.index].caption.replace(/\n/g, "")}」 ${pick.reason}`),
            ],
          };
        }
        case 11: {
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
            state: placeFigure(placeFrameFills({ ...state, segments: markContinuedCaptions(kept) })),
            note: `${removals.length}個の場面を外し、${fmt(total)}を${fmt(totalSeconds(kept))}にしました${totalSeconds(kept) > target ? `(まだ${target}秒を超えています。「やり直す」を押すか、編集画面で短くしてください)` : ""}`,
            details: removals.map((removal) => `「${captioned[removal.index].caption.replace(/\n/g, "")}」 ${removal.reason}`),
          };
        }
        case 13: {
          const chosen = parsed.data.bgm;
          if (!chosen) return { state: { ...state, bgm: null }, note: "BGMは入れませんでした(入れる時は、曲を選んでから「やり直す」を押してください)" };
          return {
            state: {
              ...state,
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
          const texts = [
            ...state.globalOverlays
              .map((overlay) => String(overlay.text))
              .filter((text) => !/^\d+$/.test(text))
              .map((text) => ({ kind: "タイトル・枠の文字" as const, text })),
            ...(state.figureTexts ?? []).map((overlay) => ({ kind: "タイトル・枠の文字" as const, text: String(overlay.text) })),
            ...segments.map((segment) => segment.caption).filter((caption) => caption.trim()).map((text) => ({ kind: "字幕" as const, text })),
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
          const adjusted: StepState = placeFigure({
            ...state,
            figure: state.figure ? { ...state.figure, base: fixLayer(state.figure.base), parts: state.figure.parts.map(fixLayer) } : state.figure,
            segments: fixedSegments,
            globalOverlays: fixedOverlays,
            frameFills: state.frameFills?.map((fill) => ({ ...fill, label: fix(fill.label) })),
            videoAdjust: light.adjust,
          });
          const result = runChecklist({
            state: adjusted,
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
