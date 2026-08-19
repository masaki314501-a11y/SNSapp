import { staticFile } from "remotion";
import { loadFont } from "@remotion/fonts";

/**
 * ヘッドレスレンダリング環境(CI/Docker/Lambda等)には日本語フォントが
 * 入っていないことが多く、指定しないとテロップが文字化けする。
 *
 * @remotion/google-fonts は初回に Google Fonts CDN へ大量のリクエスト
 * (Noto Sans JP は1ウェイトあたり100件超のunicode-range分割)を行うため、
 * ネットワークが無い/不安定なレンダー環境では失敗・低速化しやすい。
 * そのため public/fonts/ に同梱したファイルを @remotion/fonts でロードする。
 */
export const NOTO_SANS_JP_FONT_FAMILY = "Noto Sans JP";

const WEIGHTS = ["400", "700", "800", "900"] as const;

// @remotion/fonts の loadFont() はブラウザの FontFace API を直接使うため、
// Next.js のNode.js側SSR(クライアントコンポーネントの事前レンダー)で
// このモジュールが評価されるとエラーになる。実際にフォントが必要になるのは
// ブラウザ(Player/Studio)とレンダー用ヘッドレスChromeのみなのでガードする。
export const notoSansJPLoaded =
  typeof FontFace === "undefined"
    ? Promise.resolve()
    : Promise.all(
        WEIGHTS.map((weight) =>
          loadFont({
            family: NOTO_SANS_JP_FONT_FAMILY,
            url: staticFile(
              `fonts/noto-sans-jp/noto-sans-jp-japanese-${weight}-normal.woff2`
            ),
            weight,
            style: "normal",
          })
        )
      );
