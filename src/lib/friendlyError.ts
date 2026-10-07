/**
 * 画面に出すエラーの言い方をそろえる。ブラウザやライブラリが出す英語のエラー
 * (「Load failed」「Encoding task did not complete」など)をそのまま見せても、何が起きて
 * 何をすればいいのか分からないため、よくあるものは分かる言葉に言い換え、それ以外は呼び出し元が
 * 用意した「何が失敗したか+どうすればいいか」の文に置き換える。
 * 元のエラーは調べられるよう、呼び出し元でconsoleに残しておくこと。
 * サーバー側で作った日本語のメッセージ(「動画が見つかりません」等)はそのまま見せてよいので通す。
 */
const JAPANESE_PATTERN = /[぀-ヿ一-鿿]/;

const KNOWN_MESSAGES: { pattern: RegExp; message: string }[] = [
  {
    pattern: /failed to fetch|load failed|networkerror|network error|network connection was lost/i,
    message: "通信が途切れました。電波の良い所で、もう一度お試しください",
  },
  {
    pattern: /timeout|timed out/i,
    message: "時間がかかりすぎたため中断しました。少し時間をおいて、もう一度お試しください",
  },
  {
    pattern: /quotaexceeded|out of memory|memory/i,
    message: "端末のメモリや空き容量が足りなかった可能性があります。ほかのアプリやタブを閉じて、もう一度お試しください",
  },
  {
    pattern: /unexpected token|json/i,
    message: "サーバーから正しい返事が届きませんでした。少し時間をおいて、もう一度お試しください",
  },
];

export const toFriendlyErrorMessage = (error: unknown, fallback: string): string => {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (raw && JAPANESE_PATTERN.test(raw)) return raw;
  return KNOWN_MESSAGES.find(({ pattern }) => pattern.test(raw))?.message ?? fallback;
};
