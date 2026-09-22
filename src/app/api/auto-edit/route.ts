import { randomUUID } from "node:crypto";
import { NextResponse, after } from "next/server";
import { z } from "zod";
import {
  CAPTION_ANIMATION_OPTIONS,
  CAPTION_FONT_FAMILY_OPTIONS,
  CAPTION_POSITION_OPTIONS,
  CAPTION_STYLE_OPTIONS,
} from "@video/shared/schema";
import { MAX_SFX_CLIPS } from "@video/templates/standard/schema";
import { SFX_PRESETS } from "@/components/editor/audioPresets";
import type { ProjectSfxClip } from "@/lib/videoProject";
import { readGeminiApiKeyOverride } from "@/lib/gemini/apiKeyHeader";
import { DEFAULT_VOICE_NAME } from "@/lib/gemini/voiceOptions";
import { generateAutoEditPlan, MAX_AUTO_NARRATION_SEGMENTS, type AutoEditPlanInput } from "@/lib/gemini/autoEditPlan";
import { getOrGenerateVoiceover } from "@/lib/gemini/voiceoverCache";
import { createAutoEditJob, updateAutoEditJob } from "@/lib/gemini/autoEditJobs";

export const runtime = "nodejs";

// videoProject.tsは"use client"付きのモジュールなので、定数(DEFAULT_CLIP_VOLUME)を
// このサーバー専用ルートに値としてimportすると、RSCバンドル上ではクライアント参照に
// 差し替えられてundefinedになってしまう(型としてのimportは影響を受けない)。
// そのためここでは同じ値をそのまま定義する。
const DEFAULT_CLIP_VOLUME = 1;

const FONT_FAMILY_VALUES = CAPTION_FONT_FAMILY_OPTIONS.map((o) => o.value);
const CAPTION_POSITION_VALUES = CAPTION_POSITION_OPTIONS.map((o) => o.value);
const CAPTION_STYLE_VALUES = CAPTION_STYLE_OPTIONS.map((o) => o.value);
const CAPTION_ANIMATION_VALUES = CAPTION_ANIMATION_OPTIONS.map((o) => o.value);

const requestSchema = z.object({
  segments: z
    .array(
      z.object({
        key: z.string().min(1),
        caption: z.string(),
        durationInSeconds: z.number().positive(),
      })
    )
    .min(1),
  theme: z.object({
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    fontFamily: z.enum(FONT_FAMILY_VALUES as [string, ...string[]]),
    captionPosition: z.enum(CAPTION_POSITION_VALUES as [string, ...string[]]),
    captionStyle: z.enum(CAPTION_STYLE_VALUES as [string, ...string[]]),
    captionAnimation: z.enum(CAPTION_ANIMATION_VALUES as [string, ...string[]]),
  }),
  hasStyleReference: z.boolean(),
});

/**
 * 字幕生成が終わった後・手動編集(/edit)に入る前の「自動編集(バズる動画)」機能。
 * 参考画像/動画は既にextractStyleで解析済みなので、ここではテロップ文言+尺だけをGeminiに渡し、
 * 演出上書き・AIナレーション追加・効果音配置を提案してもらう(ユーザー自身の動画は再送しない)。
 * 生成には数十秒〜数分かかりうるため、他のGemini系エンドポイントと同じくジョブ化してポーリングする。
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

  const apiKeyOverride = readGeminiApiKeyOverride(request);
  const jobId = createAutoEditJob();

  after(async () => {
    try {
      const plan = await generateAutoEditPlan({ ...(parsed.data as AutoEditPlanInput), apiKeyOverride });

      // ナレーション/SFXの配置は、書き出し後の動画上での累積開始秒(segmentStartSeconds、
      // ClipEditor.tsxのhandleGenerateNarrationForAllと同じ計算式)を使う。
      const generatedClips: ProjectSfxClip[] = [];
      let sfxCount = 0;
      let narrationCount = 0;
      let cumulativeStart = 0;
      for (const segment of parsed.data.segments) {
        const decision = plan.segments.find((s) => s.key === segment.key);

        if (decision?.sfxPresetId && sfxCount < MAX_SFX_CLIPS) {
          const preset = SFX_PRESETS.find((p) => p.id === decision.sfxPresetId);
          if (preset) {
            generatedClips.push({
              key: randomUUID(),
              src: preset.src,
              label: preset.label,
              startFromSeconds: cumulativeStart,
              volume: DEFAULT_CLIP_VOLUME,
            });
            sfxCount++;
          }
        }

        if (
          decision?.addNarration &&
          segment.caption.trim() &&
          narrationCount < MAX_AUTO_NARRATION_SEGMENTS &&
          sfxCount < MAX_SFX_CLIPS
        ) {
          // Gemini APIはアプリ全体で直列実行が前提(rateLimiter.ts)のため、あえて逐次待つ。
          const { path } = await getOrGenerateVoiceover(segment.caption.trim(), DEFAULT_VOICE_NAME, apiKeyOverride);
          generatedClips.push({
            key: randomUUID(),
            src: path,
            label: `🎙 ${segment.caption.trim().slice(0, 12)}`,
            startFromSeconds: cumulativeStart,
            volume: DEFAULT_CLIP_VOLUME,
            narrationSegmentKey: segment.key,
          });
          sfxCount++;
          narrationCount++;
        }

        cumulativeStart += segment.durationInSeconds;
      }

      updateAutoEditJob(jobId, { status: "done", plan, generatedClips });
    } catch (error) {
      console.error("[auto-edit] 自動編集の生成に失敗しました", error);
      updateAutoEditJob(jobId, {
        status: "error",
        message: error instanceof Error ? error.message : "自動編集の生成に失敗しました",
      });
    }
  });

  return NextResponse.json({ jobId });
}
