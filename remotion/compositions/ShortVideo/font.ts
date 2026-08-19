import { loadFont } from "@remotion/google-fonts/NotoSansJP";

/**
 * ヘッドレスレンダリング環境(CI/Docker/Lambda等)には日本語フォントが
 * 入っていないことが多く、指定しないとテロップが文字化けする。
 * Google Fonts の Noto Sans JP を明示的にバンドルして常に読み込む。
 */
export const notoSansJP = loadFont("normal", {
  weights: ["400", "700", "800", "900"],
  subsets: ["japanese", "latin"],
  ignoreTooManyRequestsWarning: true,
});
