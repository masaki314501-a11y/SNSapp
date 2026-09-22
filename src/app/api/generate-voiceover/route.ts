import { NextResponse } from "next/server";
import { z } from "zod";
import { readGeminiApiKeyOverride } from "@/lib/gemini/apiKeyHeader";
import { getOrGenerateVoiceover } from "@/lib/gemini/voiceoverCache";
import { DEFAULT_VOICE_NAME, isKnownVoiceName } from "@/lib/gemini/voiceOptions";

export const runtime = "nodejs";

const requestSchema = z.object({
  text: z.string().trim().min(1).max(200),
  voiceName: z.string().optional(),
});

/**
 * テロップ1件分の文言をAIナレーション(読み上げ音声)に変換するAPI。文字起こし・スタイル抽出とは
 * 異なり単発の短い音声(数秒)しか生成しないため、ジョブポーリングは使わず同期レスポンスで返す。
 * 生成済み音声の使い回し(キャッシュ)ロジックは自動編集機能とも共有するため
 * voiceoverCache.tsに切り出してある。
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

  const voiceName =
    parsed.data.voiceName && isKnownVoiceName(parsed.data.voiceName)
      ? parsed.data.voiceName
      : DEFAULT_VOICE_NAME;

  try {
    const apiKeyOverride = readGeminiApiKeyOverride(request);
    const result = await getOrGenerateVoiceover(parsed.data.text, voiceName, apiKeyOverride);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[generate-voiceover] 音声生成に失敗しました", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "音声生成に失敗しました" },
      { status: 500 }
    );
  }
}
