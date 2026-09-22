import Groq from "groq-sdk";

/**
 * Groqは(このアプリでは)管理者が持つ1つのAPIキーだけで動かす方針
 * (docs/gemini-multi-provider-offload/README.md参照)。GeminiのBYOKとは異なり、
 * 友人が各自のGroqキーを登録する仕組みは提供しない。
 */
export const MISSING_GROQ_API_KEY_MESSAGE =
  "AI機能が現在利用できません。しばらく時間をおいてから、もう一度お試しください";

export const createGroqClient = (): Groq => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error("[groq] GROQ_API_KEYが未設定です");
    throw new Error(MISSING_GROQ_API_KEY_MESSAGE);
  }
  return new Groq({ apiKey });
};
