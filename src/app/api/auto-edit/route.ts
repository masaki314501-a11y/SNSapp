import { randomUUID } from "node:crypto";
import { NextResponse, after } from "next/server";
import { z } from "zod";
import { CAPTION_ANIMATION_OPTIONS } from "@video/shared/schema";
import { MAX_SFX_CLIPS } from "@video/templates/standard/schema";
import { SFX_PRESETS } from "@/components/editor/audioPresets";
import type { ProjectSegment, ProjectSfxClip } from "@/lib/videoProject";
import { DEFAULT_VOICE_NAME } from "@/lib/gemini/voiceOptions";
import { generateAutoEditPlan } from "@/lib/gemini/autoEditPlan";
import { getOrGenerateVoiceover } from "@/lib/gemini/voiceoverCache";
import { createAutoEditJob, updateAutoEditJob } from "@/lib/gemini/autoEditJobs";
import { VIDEO_PATH_PATTERN, resolveUploadedVideo } from "@/lib/uploadedVideo";
import { isStyleReferencePath, resolveStyleReference } from "@/lib/styleReference";

export const runtime = "nodejs";

// videoProject.tsは"use client"付きのモジュールなので、定数(DEFAULT_CLIP_VOLUME等)を
// このサーバー専用ルートに値としてimportすると、RSCバンドル上ではクライアント参照に
// 差し替えられてundefinedになってしまう(型としてのimportは影響を受けない)。
// そのためここでは同じ値をそのまま定義する。
const DEFAULT_CLIP_VOLUME = 1;
const DEFAULT_CAPTION_ANIMATION = CAPTION_ANIMATION_OPTIONS[0].value;

const requestSchema = z.object({
  videoPath: z.string().regex(VIDEO_PATH_PATTERN),
  videoDurationInSeconds: z.number().positive(),
  keepRanges: z
    .array(z.object({ startFromSeconds: z.number().min(0), durationInSeconds: z.number().positive() }))
    .min(1),
  styleReferencePath: z.string().refine(isStyleReferencePath).nullable().optional(),
});

/**
 * カット後・手動編集(/edit)に入る前の「自動編集(バズる動画)」機能。本人の動画・参考スクショ・
 * 編集例をGeminiに見せ、切り方・寄り・強調テキスト・効果音・ナレーション・フック・CTAまで
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
  // ファイルを永続化しない)。無くても自動編集自体は進められるので、手本無しとして続行する。
  const styleReference = parsed.data.styleReferencePath
    ? await resolveStyleReference(parsed.data.styleReferencePath)
    : null;

  const jobId = createAutoEditJob();

  after(async () => {
    try {
      const plan = await generateAutoEditPlan({
        video: { ...video, durationInSeconds: parsed.data.videoDurationInSeconds },
        keepRanges: parsed.data.keepRanges,
        styleReference,
      });

      // 効果音・ナレーションの配置は、書き出し後の動画上での累積開始秒(クリップ尺の合計)を使う。
      const segments: ProjectSegment[] = [];
      const generatedClips: ProjectSfxClip[] = [];
      let cumulativeStart = 0;
      for (const clip of plan.clips) {
        const key = randomUUID();
        segments.push({
          key,
          // 字幕を付けるかどうかは編集画面で決める(「字幕を一括生成」でspeechTextを流し込む)。
          caption: "",
          speechText: clip.speechText,
          startFromSeconds: clip.startFromSeconds,
          durationInSeconds: clip.durationInSeconds,
          captionAnimation: clip.captionAnimation ?? DEFAULT_CAPTION_ANIMATION,
          volume: DEFAULT_CLIP_VOLUME,
          emphasisWords: clip.emphasisWords,
          emphasisColor: clip.emphasisColor,
          zoom: clip.zoom,
          overlays: clip.overlays,
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

        if (clip.narration && generatedClips.length < MAX_SFX_CLIPS) {
          // TTSは専用の列で直列実行される前提(rateLimiter.ts)のため、あえて逐次待つ。
          const { path } = await getOrGenerateVoiceover(clip.narration, DEFAULT_VOICE_NAME);
          generatedClips.push({
            key: randomUUID(),
            src: path,
            label: `🎙 ${clip.narration.slice(0, 12)}`,
            startFromSeconds: cumulativeStart,
            volume: DEFAULT_CLIP_VOLUME,
            narrationSegmentKey: key,
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
        },
        segments,
        generatedClips,
      });
    } catch (error) {
      console.error("[auto-edit] 自動編集の生成に失敗しました", error);
      updateAutoEditJob(jobId, {
        status: "error",
        message: error instanceof Error ? error.message : "自動編集の生成に失敗しました",
      });
    }
  });

  return NextResponse.json({ jobId, usedStyleReference: styleReference !== null });
}
