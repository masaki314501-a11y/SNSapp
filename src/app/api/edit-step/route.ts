import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_CLIPS, MIN_CLIPS } from "@video/templates/standard/schema";
import type { CaptionFontSize, CaptionStyle } from "@video/shared/schema";
import { VIDEO_PATH_PATTERN, resolveUploadedVideo } from "@/lib/uploadedVideo";
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
  trimBeforeSpeech,
  type StepState,
} from "@/lib/editSteps/logic";
import { decideObjects, detectFace, findMistakes, pickEmphasis, pickRemovals, proofreadTexts } from "@/lib/editSteps/ai";
import { measureLightAdjust } from "@/lib/audio/videoLight";
import { runChecklist, type CheckItem } from "@/lib/editSteps/checklist";
import type { CaptionFontFamily } from "@video/shared/schema";

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
  }),
  /** 完成動画の長さの上限(秒)。お客様の指定が無ければ30秒。 */
  targetSeconds: z.number().positive().optional(),
  /** 工程13で入れるBGM(工程ごとの編集の画面で選んだ物)。 */
  bgm: z.object({ src: z.string(), label: z.string() }).nullable().optional(),
  /** どこに出す動画か(チェックのセーフティゾーン)。 */
  zone: z.enum(["tiktok", "ad"]).optional(),
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
/** 完成動画の長さの上限の初期値(秒。チェック項目: 30秒以内の動画になっているか)。 */
const DEFAULT_TARGET_SECONDS = 30;
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
            note: y !== null ? `テロップを演者の顎の少し下(画面の上から${y}%)に固定しました` : "顎の下にテロップが収まらないため、画面の下に固定しました",
          };
        }
        case 8: {
          const objects = await decideObjects({ absolutePath: video.absolutePath, mimeType: video.mimeType });
          const built = buildObjects({
            title: objects.title,
            frameCount: objects.frameCount,
            captionTopPercent: state.captionYPercent ?? BOTTOM_CAPTION_TOP_PERCENT,
            accentColor: look.primaryColor,
          });
          return {
            state: { ...state, globalOverlays: built.globalOverlays, globalShapes: built.globalShapes },
            note: `左上のタイトル「${objects.title.replace(/\n/g, "")}」を作りました${objects.frameCount >= 2 ? `。ランキングの枠を${objects.frameCount}個並べました` : "(ランキングの枠は無し)"}`,
            details: [objects.reason],
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
          const split = splitByCaptions(segments, phrases, newKey);
          return {
            state: { ...state, segments: split },
            note: `テロップを${split.filter((segment) => segment.caption.trim()).length}個入れました(位置は工程7で固定)`,
          };
        }
        case 10: {
          const withCaption = segments.filter((segment) => segment.caption.trim());
          const picks = await pickEmphasis(withCaption.map((segment) => segment.caption));
          const keys = new Set(picks.map((pick) => withCaption[pick.index].key));
          return {
            state: { ...state, segments: applyEmphasis(segments, keys) },
            note: `${picks.length}個のテロップを強調テロップにしました`,
            details: picks.map((pick) => `「${withCaption[pick.index].caption.replace(/\n/g, "")}」 ${pick.reason}`),
          };
        }
        case 11: {
          const result = emphasisEffects(segments);
          return {
            state: { ...state, segments: result.segments },
            note: `強調テロップ${result.count}個に効果音を付け、少し人物を拡大しました`,
          };
        }
        case 12: {
          const target = parsed.data.targetSeconds ?? DEFAULT_TARGET_SECONDS;
          const total = totalSeconds(segments);
          if (total <= target) {
            return { state, note: `完成の長さが${fmt(total)}で、${target}秒以内に収まっているので、何も外しませんでした` };
          }
          const captioned = segments.filter((segment) => segment.caption.trim());
          const removals = await pickRemovals(
            captioned.map((segment) => ({ text: segment.caption, seconds: segment.durationInSeconds })),
            total,
            target
          );
          const removeKeys = new Set(removals.map((removal) => captioned[removal.index].key));
          const kept = segments.filter((segment) => !removeKeys.has(segment.key));
          return {
            state: { ...state, segments: kept },
            note: `${removals.length}個の場面を外し、${fmt(total)}を${fmt(totalSeconds(kept))}にしました${totalSeconds(kept) > target ? `(まだ${target}秒を超えています。お客様の指定が無ければ、編集画面で短くしてください)` : ""}`,
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
            ...segments.map((segment) => segment.caption).filter((caption) => caption.trim()).map((text) => ({ kind: "字幕" as const, text })),
          ];
          const typos = await proofreadTexts({ absolutePath: video.absolutePath, mimeType: video.mimeType, texts });
          const adjusted: StepState = { ...state, videoAdjust: light.adjust };
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
            zone: parsed.data.zone,
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
