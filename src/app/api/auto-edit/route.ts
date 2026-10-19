import { randomUUID } from "node:crypto";
import { NextResponse, after } from "next/server";
import { z } from "zod";
import { CAPTION_ANIMATION_OPTIONS } from "@video/shared/schema";
import { MAX_SFX_CLIPS } from "@video/templates/standard/schema";
import { SFX_PRESETS } from "@/components/editor/audioPresets";
import type { ProjectSegment, ProjectSfxClip } from "@/lib/videoProject";
import { generateAutoEditPlan } from "@/lib/gemini/autoEditPlan";
import { analyzeSpeechActivity, snapToQuiet } from "@/lib/audio/speechActivity";
import { rawAutoEditPlanSchema } from "@/lib/gemini/autoEditTypes";
import { createAutoEditJob, updateAutoEditJob, updateAutoEditProgress } from "@/lib/gemini/autoEditJobs";
import { VIDEO_PATH_PATTERN, resolveUploadedVideo } from "@/lib/uploadedVideo";
import { isStyleReferencePath, resolveStyleReference } from "@/lib/styleReference";
import { MAX_STYLE_REFERENCES } from "@/lib/styleReferenceLimits";
import { findEditTemplate } from "@/lib/editTemplates";
import { MATERIAL_IMAGE_PATH_PATTERN, MAX_MATERIAL_IMAGES, resolveMaterialImage } from "@/lib/materialImage";
import { toFriendlyErrorMessage } from "@/lib/friendlyError";

export const runtime = "nodejs";

// videoProject.tsは"use client"付きのモジュールなので、定数(DEFAULT_CLIP_VOLUME等)を
// このサーバー専用ルートに値としてimportすると、RSCバンドル上ではクライアント参照に
// 差し替えられてundefinedになってしまう(型としてのimportは影響を受けない)。
// そのためここでは同じ値をそのまま定義する。
const DEFAULT_CLIP_VOLUME = 1;
const DEFAULT_CAPTION_ANIMATION = CAPTION_ANIMATION_OPTIONS[0].value;

/** 要望・手直しの指示の長さの上限。画面(AutoEditScreen.tsx)と合わせる。 */
const MAX_USER_TEXT_LENGTH = 1000;
/** タイトルの長さの上限。画面と合わせる。 */
const MAX_TITLE_LENGTH = 40;
/** 1回で新しく作ってよい画像の数の上限。autoEditPlan.tsのMAX_GENERATED_IMAGESと合わせる。 */
const MAX_GENERATED_IMAGES = 8;

const requestSchema = z.object({
  videoPath: z.string().regex(VIDEO_PATH_PATTERN),
  videoDurationInSeconds: z.number().positive(),
  keepRanges: z
    .array(z.object({ startFromSeconds: z.number().min(0), durationInSeconds: z.number().positive() }))
    .min(1),
  styleReferencePaths: z.array(z.string().refine(isStyleReferencePath)).max(MAX_STYLE_REFERENCES).default([]),
  templateId: z.string().nullable().optional(),
  materialImages: z
    .array(z.object({ path: z.string().regex(MATERIAL_IMAGE_PATH_PATTERN), name: z.string().max(100) }))
    .max(MAX_MATERIAL_IMAGES)
    .default([]),
  generateMissingImages: z.boolean().default(false),
  /** 新しく作ってよい画像の数(1枚約10円)。0なら貯めた画像だけを使う。古い画面からは届かないので、その時は今までと同じ上限。 */
  maxGeneratedImages: z.number().int().min(0).max(MAX_GENERATED_IMAGES).default(MAX_GENERATED_IMAGES),
  /** 左上に出すタイトル(空ならAIが決める)。 */
  title: z.string().max(MAX_TITLE_LENGTH).default(""),
  /** 完成動画の長さの目安(秒)。nullなら長さはAIにまかせる。 */
  targetDurationSeconds: z.number().min(5).max(600).nullable().default(null),
  /** AIへの要望(なくてもよい)。 */
  userRequest: z.string().max(MAX_USER_TEXT_LENGTH).default(""),
  /** 手直し。前回の案(Geminiの生の答え)と、直してほしいこと。 */
  revision: z
    .object({ previousPlan: rawAutoEditPlanSchema, instruction: z.string().trim().min(1).max(MAX_USER_TEXT_LENGTH) })
    .nullable()
    .optional(),
});

/**
 * カット後・手動編集(/edit)に入る前の「自動編集(バズる動画)」機能。本人の動画・参考スクショ・
 * 編集例をGeminiに見せ、切り方・寄り・強調テキスト・効果音・フック・CTAまで
 * 編集の判断をすべて任せる(autoEditPlan.ts参照)。結果はそのままプロジェクトに書き込める
 * クリップ列(segments)と音声クリップ(generatedClips)に組み立てて返す。
 * 生成には数分かかりうるため、他のGemini系エンドポイントと同じくジョブ化してポーリングする。
 */
export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "リクエスト内容が不正です", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const video = await resolveUploadedVideo(parsed.data.videoPath);
  if (!video) {
    return NextResponse.json({ error: "動画が見つかりません。アップロードからやり直してください" }, { status: 400 });
  }
  // 参考スクショはサーバー再起動等で消えていることがある(本番の無料プランは実行時に保存した
  // ファイルを永続化しない)。無くても自動編集自体は進められるので、見つかった分だけを手本にして続行する。
  const styleReferences = (
    await Promise.all(parsed.data.styleReferencePaths.map((referencePath) => resolveStyleReference(referencePath)))
  ).filter((reference) => reference !== null);
  // 知らないid(古い画面から送られた等)はテンプレート無しとして扱う。
  const template = findEditTemplate(parsed.data.templateId);
  // 使える画像も参考スクショと同じく、消えていた分は除いて続行する。
  const materialImages = (await Promise.all(parsed.data.materialImages.map(resolveMaterialImage))).filter(
    (image) => image !== null
  );

  const jobId = createAutoEditJob();

  after(async () => {
    try {
      // 音から話している所と間を調べる(カットの位置を間に寄せ、字幕を話に合わせて見せるため)。
      // 調べられなくても自動編集は続ける(寄せない・字幕は全文のまま)。
      const speech = await analyzeSpeechActivity(video.absolutePath).catch((error) => {
        console.warn("[auto-edit] 音を調べられなかったため、カットの位置の補正と字幕の話への合わせは行いません", error);
        return null;
      });
      const plan = await generateAutoEditPlan({
        video: { ...video, durationInSeconds: parsed.data.videoDurationInSeconds },
        keepRanges: parsed.data.keepRanges,
        styleReferences,
        template,
        materialImages,
        generateMissingImages: parsed.data.generateMissingImages,
        maxGeneratedImages: parsed.data.maxGeneratedImages,
        title: parsed.data.title,
        targetDurationSeconds: parsed.data.targetDurationSeconds,
        onProgress: (progress) => updateAutoEditProgress(jobId, progress),
        snapCut: speech ? (seconds) => snapToQuiet(speech, seconds) : undefined,
        userRequest: parsed.data.userRequest,
        revision: parsed.data.revision ?? undefined,
      });

      // 効果音の配置は、書き出し後の動画上での累積開始秒(クリップ尺の合計)を使う。
      const segments: ProjectSegment[] = [];
      const generatedClips: ProjectSfxClip[] = [];
      let cumulativeStart = 0;
      for (const clip of plan.clips) {
        const key = randomUUID();
        segments.push({
          key,
          // 話している言葉は、基本の字幕として必ず出す(強調は付けず、書体は全体で1つ)。強調は編集画面で本人が選ぶ。
          caption: clip.speechText,
          speechText: clip.speechText,
          startFromSeconds: clip.startFromSeconds,
          durationInSeconds: clip.durationInSeconds,
          captionAnimation: clip.captionAnimation ?? DEFAULT_CAPTION_ANIMATION,
          volume: DEFAULT_CLIP_VOLUME,
          zoom: clip.zoom,
          overlays: clip.overlays,
          images: clip.images,
          faceBox: clip.faceBox,
          clipCaptionPosition: clip.clipCaptionPosition,
          cameraHighlight: clip.cameraHighlight,
        });

        for (const sfx of clip.sfx) {
          if (generatedClips.length >= MAX_SFX_CLIPS) break;
          const preset = SFX_PRESETS.find((p) => p.id === sfx.presetId);
          if (!preset) continue;
          generatedClips.push({
            key: randomUUID(),
            src: preset.src,
            label: preset.label,
            startFromSeconds: cumulativeStart + sfx.offsetSeconds,
            volume: DEFAULT_CLIP_VOLUME,
          });
        }

        cumulativeStart += clip.durationInSeconds;
      }

      updateAutoEditJob(jobId, {
        status: "done",
        plan: {
          summary: plan.summary,
          referenceNotes: plan.referenceNotes,
          theme: plan.theme,
          hook: plan.hook,
          cta: plan.cta,
          globalOverlays: plan.globalOverlays,
          globalImages: plan.globalImages,
          globalShapes: plan.globalShapes,
          framing: plan.framing,
          generatedImageCount: plan.generatedImageCount,
          imageSources: plan.imageSources,
        },
        rawPlan: plan.rawPlan,
        speechSpans: speech?.spans ?? null,
        segments,
        generatedClips,
      });
    } catch (error) {
      console.error("[auto-edit] 自動編集の生成に失敗しました", error);
      updateAutoEditJob(jobId, {
        status: "error",
        message: toFriendlyErrorMessage(error, "自動編集の生成に失敗しました"),
      });
    }
  });

  return NextResponse.json({
    jobId,
    usedStyleReferenceCount: styleReferences.length,
    usedMaterialImageCount: materialImages.length,
  });
}
