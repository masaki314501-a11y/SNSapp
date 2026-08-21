import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import { CLIP_CAPTION_MAX_CHARS, graphemeLength, truncateNaturally } from "./textUtils";
import { runWithGeminiRateLimit } from "./rateLimiter";

const DEFAULT_MODEL = "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 20_000;
/** 初回生成+検証NG時の再生成1回まで。無料枠のレイテンシとのバランスでこの回数に留める。 */
const MAX_ATTEMPTS = 2;

// テロップは縦型ショート動画に大きく重ねて表示するため、視認性を優先して短く制限する。
const HOOK_HEADLINE_LINE_MAX_CHARS = 14;
const HOOK_HEADLINE_TOTAL_MAX_CHARS = 28;
const HOOK_SUBLINE_MAX_CHARS = 16;
const CTA_MAX_CHARS = 16;

// 「過度に誇張しすぎない自然な日本語」から外れやすい定型の煽り表現。検出したら再生成/除去する。
const BANNED_PHRASES = [
  "絶対に",
  "100%",
  "必ず",
  "完全に",
  "誰でも簡単に",
  "史上最強",
  "神",
];

const rawScriptSchema = z.object({
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  hookHeadlineCandidates: z.array(z.string().min(1)).min(1).max(2),
  hookSubline: z.string().optional(),
  clipCaptions: z.array(z.string().min(1)).min(1),
  ctaText: z.string().min(1),
  styleSummary: z.string().optional(),
});

type RawScript = z.infer<typeof rawScriptSchema>;

export type GeneratedScript = {
  primaryColor: string;
  hookHeadline: string;
  /** フックの候補(1〜2案)。hookHeadlineは常にcandidates[0]と一致する。 */
  hookHeadlineCandidates: string[];
  hookSubline?: string;
  clipCaptions: string[];
  ctaText: string;
  styleSummary?: string;
};

export type GenerateScriptInput = {
  title: string;
  clipCount: number;
  /** 各クリップの内容メモ(任意)。indexがclipCaptionsに対応する。 */
  clipNotes?: (string | undefined)[];
  screenshot?: { base64: string; mimeType: string } | null;
};

export type GenerateScriptResult = {
  source: "gemini" | "fallback";
  reason?: string;
  script: GeneratedScript;
};

const DEFAULT_PRIMARY_COLOR = "#FF3366";

const containsBannedPhrase = (text: string): boolean =>
  BANNED_PHRASES.some((phrase) => text.includes(phrase));

const stripBannedPhrases = (text: string): string =>
  BANNED_PHRASES.reduce((acc, phrase) => acc.split(phrase).join(""), text);

const truncateHeadline = (text: string): string => {
  const lines = text
    .split("\n")
    .map((line) => truncateNaturally(line.trim(), HOOK_HEADLINE_LINE_MAX_CHARS));
  let joined = lines.join("\n");
  if (graphemeLength(joined.replace(/\n/g, "")) > HOOK_HEADLINE_TOTAL_MAX_CHARS) {
    joined = truncateNaturally(joined.replace(/\n/g, ""), HOOK_HEADLINE_TOTAL_MAX_CHARS);
  }
  return joined;
};

/**
 * Gemini APIが未設定・レート制限超過・応答不正などの場合に使う
 * 固定テロップのフォールバック。無料枠での運用を止めないための保険。
 */
const buildFallbackScript = (title: string, clipCount: number): GeneratedScript => {
  const trimmedTitle = truncateNaturally(title.trim() || "今日のおすすめ", HOOK_HEADLINE_LINE_MAX_CHARS);
  const headline = `${trimmedTitle}\nまとめました`;
  return {
    primaryColor: DEFAULT_PRIMARY_COLOR,
    hookHeadline: headline,
    hookHeadlineCandidates: [headline],
    hookSubline: "最後まで見て",
    clipCaptions: Array.from({ length: clipCount }, (_, i) => `ポイント${i + 1}`),
    ctaText: "詳しくはプロフィールへ",
  };
};

/**
 * Gemini応答が仕様(文字数上限・誇張表現・クリップ数の一致)を満たしているか検証する。
 * 問題があれば再生成時のフィードバックに使う文言のリストを返す(空配列なら合格)。
 */
const findScriptIssues = (raw: RawScript, clipCount: number): string[] => {
  const issues: string[] = [];

  raw.hookHeadlineCandidates.forEach((candidate, i) => {
    const lines = candidate.split("\n");
    if (lines.some((line) => graphemeLength(line) > HOOK_HEADLINE_LINE_MAX_CHARS)) {
      issues.push(
        `フック案${i + 1}は1行${HOOK_HEADLINE_LINE_MAX_CHARS}文字以内にしてください`
      );
    }
    if (containsBannedPhrase(candidate)) {
      issues.push(`フック案${i + 1}に誇張表現が含まれています。自然な言葉に変えてください`);
    }
  });

  if (raw.hookSubline && graphemeLength(raw.hookSubline) > HOOK_SUBLINE_MAX_CHARS) {
    issues.push(`hookSublineは${HOOK_SUBLINE_MAX_CHARS}文字以内にしてください`);
  }

  if (raw.clipCaptions.length !== clipCount) {
    issues.push(`clipCaptionsはちょうど${clipCount}個にしてください`);
  }
  raw.clipCaptions.forEach((caption, i) => {
    if (graphemeLength(caption) > CLIP_CAPTION_MAX_CHARS) {
      issues.push(`クリップ${i + 1}のテロップは${CLIP_CAPTION_MAX_CHARS}文字以内にしてください`);
    }
    if (containsBannedPhrase(caption)) {
      issues.push(`クリップ${i + 1}のテロップに誇張表現が含まれています。自然な言葉に変えてください`);
    }
  });

  if (graphemeLength(raw.ctaText) > CTA_MAX_CHARS) {
    issues.push(`ctaTextは${CTA_MAX_CHARS}文字以内にしてください`);
  }
  if (containsBannedPhrase(raw.ctaText)) {
    issues.push("ctaTextに誇張表現が含まれています。自然な言葉に変えてください");
  }

  return issues;
};

/**
 * 検証をパスできなかった場合の最終防衛ライン。文字数を強制的に切り詰め、
 * 誇張表現を除去してから返すことで、UIには常に規定内のテロップが渡るようにする。
 */
const finalizeScript = (raw: RawScript, clipCount: number): GeneratedScript => {
  const candidates = raw.hookHeadlineCandidates
    .slice(0, 2)
    .map((candidate) => truncateHeadline(stripBannedPhrases(candidate.trim())));

  const clipCaptions = Array.from({ length: clipCount }, (_, i) => {
    const caption = raw.clipCaptions[i]?.trim() || `ポイント${i + 1}`;
    return truncateNaturally(stripBannedPhrases(caption), CLIP_CAPTION_MAX_CHARS);
  });

  const hookSubline = raw.hookSubline?.trim()
    ? truncateNaturally(stripBannedPhrases(raw.hookSubline.trim()), HOOK_SUBLINE_MAX_CHARS)
    : undefined;

  const ctaText = truncateNaturally(
    stripBannedPhrases(raw.ctaText.trim()) || "詳しくはプロフィールへ",
    CTA_MAX_CHARS
  );

  return {
    primaryColor: raw.primaryColor ?? DEFAULT_PRIMARY_COLOR,
    hookHeadline: candidates[0],
    hookHeadlineCandidates: candidates,
    hookSubline,
    clipCaptions,
    ctaText,
    styleSummary: raw.styleSummary?.trim() || undefined,
  };
};

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    primaryColor: {
      type: Type.STRING,
      description:
        "参考スクリーンショットから抽出したテロップ配色に使うアクセントカラー。#RRGGBB形式の16進数コード。スクリーンショットが無い場合は動画の雰囲気に合う色を提案する。",
    },
    styleSummary: {
      type: Type.STRING,
      description:
        "参考スクリーンショットのレイアウト・配色・フォント傾向・余白・雰囲気を日本語1〜2文で要約したもの。",
    },
    hookHeadlineCandidates: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        `フックパート(0-3秒)のメインテロップ案を1〜2個。結論や数字を先出しし、視聴維持率を上げる強い引き` +
        `(例:「コスパ最強ガジェット3選」「知らないと損する〜」)。1行あたり全角${HOOK_HEADLINE_LINE_MAX_CHARS}文字以内、` +
        `改行(\\n)は1箇所まで、合計でも全角${HOOK_HEADLINE_TOTAL_MAX_CHARS}文字以内。`,
    },
    hookSubline: {
      type: Type.STRING,
      description: `フックパートの補足テロップ(任意)。全角${HOOK_SUBLINE_MAX_CHARS}文字以内。`,
    },
    clipCaptions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        `本題パート(3-20秒)の各クリップに付けるテロップ。クリップ数と同じ数だけ、順番に生成する。` +
        `各クリップの内容メモがあればその内容を簡潔に反映する。1つあたり全角${CLIP_CAPTION_MAX_CHARS}文字以内で、` +
        "長文にせず要点だけを言い切る。",
    },
    ctaText: {
      type: Type.STRING,
      description: `CTAパート(20-25秒)の一言の行動喚起テキスト。全角${CTA_MAX_CHARS}文字以内。`,
    },
  },
  required: ["hookHeadlineCandidates", "clipCaptions", "ctaText"],
} as const;

const buildPrompt = (params: {
  title: string;
  clipCount: number;
  clipNotes?: (string | undefined)[];
  hasScreenshot: boolean;
  previousIssues?: string[];
}) => {
  const { title, clipCount, clipNotes, hasScreenshot, previousIssues } = params;

  const clipNotesSection = Array.from({ length: clipCount }, (_, i) => {
    const note = clipNotes?.[i]?.trim();
    return `  - クリップ${i + 1}: ${note ? note : "(内容メモなし。タイトル/キーワードから自然に推測する)"}`;
  }).join("\n");

  const retrySection = previousIssues?.length
    ? `\n# 前回出力の修正指示(必ず反映すること)\n${previousIssues.map((issue) => `- ${issue}`).join("\n")}\n`
    : "";

  return `
あなたはショート動画(縦型9:16、TikTok/Instagramリール想定、尺15〜30秒)のテロップ構成作家です。
以下の入力をもとに、「フック(0-3秒)→本題(3-20秒)→CTA(20-25秒)」という唯一の構成で
動画に載せるテロップをJSONで出力してください。

# 入力
- タイトル/キーワード: ${title}
- 本題パートのクリップ数: ${clipCount}
- 各クリップの内容メモ:
${clipNotesSection}
${
  hasScreenshot
    ? "- 参考動画のスクリーンショット(添付画像): このスクリーンショットのテロップ配置・配色・フォントの太さや雰囲気・余白の取り方を分析し、primaryColorとstyleSummaryに反映してください。"
    : "- 参考スクリーンショット: 今回は未添付。動画の雰囲気に合う配色を提案してください。"
}

# 出力ルール
- hookHeadlineCandidates: 結論・数字を先出しする短いコピーを1〜2案。最後まで見たくなる引きにする。
- hookSubline: 任意の補足コピー。不要なら空文字でよい。
- clipCaptions: 必ず${clipCount}個。本題の各クリップに1対1で対応する短いテロップ。内容メモがあれば優先して反映する。
- ctaText: プロフィール誘導やフォロー等、一言の行動喚起。
- 短尺動画で離脱を防ぐテンポの良い言葉選びをし、テロップはすべて短く・視認性重視で長文にしない。
- 「絶対に」「100%」「必ず」「完全に」のような過度な誇張表現は使わず、自然な日本語にする。
- すべて日本語。絵文字や記号の装飾は使わない。
- JSON以外の文字列(説明文やマークダウン)は出力しない。
${retrySection}`.trim();
};

const callGemini = async (
  ai: GoogleGenAI,
  model: string,
  prompt: string,
  screenshot?: { base64: string; mimeType: string } | null
): Promise<RawScript> => {
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: prompt },
  ];
  if (screenshot) {
    parts.push({ inlineData: { mimeType: screenshot.mimeType, data: screenshot.base64 } });
  }

  const generatePromise = ai.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: {
      responseMimeType: "application/json",
      responseSchema,
    },
  });

  // 無料枠のレート制限やネットワーク不調で応答が長時間返らないケースに備え、
  // タイムアウトしたら例外にしてフォールバックへ倒す。
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Gemini API timeout")), GEMINI_TIMEOUT_MS);
  });

  const response = await Promise.race([generatePromise, timeoutPromise]);
  const text = response.text;
  if (!text) {
    throw new Error("Gemini APIから空の応答が返されました");
  }

  const parsed = rawScriptSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(`Gemini応答のスキーマ検証に失敗: ${parsed.error.message}`);
  }
  return parsed.data;
};

export const generateScript = async (
  input: GenerateScriptInput
): Promise<GenerateScriptResult> => {
  const clipCount = Math.max(1, Math.round(input.clipCount));
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      source: "fallback",
      reason: "GEMINI_API_KEYが未設定です",
      script: buildFallbackScript(input.title, clipCount),
    };
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  let previousIssues: string[] | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const prompt = buildPrompt({
        title: input.title,
        clipCount,
        clipNotes: input.clipNotes,
        hasScreenshot: Boolean(input.screenshot),
        previousIssues,
      });
      const raw = await runWithGeminiRateLimit(() =>
        callGemini(ai, model, prompt, input.screenshot)
      );
      const issues = findScriptIssues(raw, clipCount);

      if (issues.length === 0) {
        return { source: "gemini", script: finalizeScript(raw, clipCount) };
      }

      if (attempt < MAX_ATTEMPTS) {
        // 品質NGだが再生成の余地がある場合は、問題点をフィードバックして作り直させる。
        previousIssues = issues;
        continue;
      }

      // リトライ上限に達した場合も、最終防衛ラインの強制サニタイズで規定内に収めて返す。
      return {
        source: "gemini",
        reason: `一部テロップを自動調整しました(${issues.join(" / ")})`,
        script: finalizeScript(raw, clipCount),
      };
    } catch (error) {
      lastError = error;
      console.error(`[generateScript] Gemini API呼び出しに失敗しました(試行${attempt})`, error);
    }
  }

  return {
    source: "fallback",
    reason: lastError instanceof Error ? lastError.message : "不明なエラー",
    script: buildFallbackScript(input.title, clipCount),
  };
};
