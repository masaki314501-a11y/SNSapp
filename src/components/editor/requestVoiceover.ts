import { withGeminiApiKeyHeader } from "@/lib/geminiApiKeyClient";

/** テロップ1件分の文言をAIナレーション音声に変換する(/api/generate-voiceoverの薄いラッパー)。 */
export const requestVoiceover = async (text: string, voiceName: string): Promise<{ path: string }> => {
  const res = await fetch("/api/generate-voiceover", {
    method: "POST",
    headers: withGeminiApiKeyHeader({ "Content-Type": "application/json" }),
    body: JSON.stringify({ text, voiceName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "音声生成に失敗しました");
  return data as { path: string };
};
