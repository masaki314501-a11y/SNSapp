import { staticFile } from "remotion";
import { loadFont } from "@remotion/fonts";
import type { CaptionFontFamily } from "./schema";

/**
 * ヘッドレスレンダリング環境(CI/Docker/Lambda等)には日本語フォントが
 * 入っていないことが多く、指定しないとテロップが文字化けする。
 *
 * @remotion/google-fonts は初回に Google Fonts CDN へ大量のリクエスト
 * (Noto Sans JP は1ウェイトあたり100件超のunicode-range分割)を行うため、
 * ネットワークが無い/不安定なレンダー環境では失敗・低速化しやすい。
 * そのため public/fonts/ に同梱したファイルを @remotion/fonts でロードする。
 */
export const NOTO_SANS_JP_FONT_FAMILY = "Noto Sans JP" as const;

type FontDefinition = {
  slug: string;
  weights: readonly string[];
};

// テロップ用に選べるフォント一式。familyの一覧は shared/schema.ts の
// captionFontFamilySchema / CAPTION_FONT_FAMILY_OPTIONS と対応させること。
const FONT_DEFINITIONS: Record<CaptionFontFamily, FontDefinition> = {
  "Noto Sans JP": { slug: "noto-sans-jp", weights: ["400", "700", "800", "900"] },
  "M PLUS Rounded 1c": { slug: "m-plus-rounded-1c", weights: ["700"] },
  "Zen Maru Gothic": { slug: "zen-maru-gothic", weights: ["700"] },
  "Kosugi Maru": { slug: "kosugi-maru", weights: ["400"] },
  "Zen Kaku Gothic New": { slug: "zen-kaku-gothic-new", weights: ["700"] },
  "Dela Gothic One": { slug: "dela-gothic-one", weights: ["400"] },
  "Yusei Magic": { slug: "yusei-magic", weights: ["400"] },
  "Potta One": { slug: "potta-one", weights: ["400"] },
  "Reggae One": { slug: "reggae-one", weights: ["400"] },
  "RocknRoll One": { slug: "rocknroll-one", weights: ["400"] },
  "Mochiy Pop One": { slug: "mochiy-pop-one", weights: ["400"] },
  "Noto Serif JP": { slug: "noto-serif-jp", weights: ["700"] },
  "Shippori Mincho": { slug: "shippori-mincho", weights: ["700"] },
  Yomogi: { slug: "yomogi", weights: ["400"] },
  "Kaisei Decol": { slug: "kaisei-decol", weights: ["700"] },
};

// family単位でロード済み(またはロード中)のPromiseをキャッシュする。
// loadFont()はfamily/weightの重複チェックを行わないため、呼び出し側で
// 二重登録(delayRenderの重複・同一FontFaceの重複追加)を防ぐ必要がある。
const loadedFamilies = new Map<CaptionFontFamily, Promise<void>>();

/**
 * 選択されているフォントファミリーだけを読み込む。15書体すべてを毎回まとめて
 * ダウンロードするのは無駄が大きい(1書体あたり数百KB〜2MB)ため、実際に使う
 * ものだけを都度読み込む。familyごとにキャッシュ済みなので繰り返し呼んでも安全。
 */
export const ensureCaptionFontLoaded = (family: CaptionFontFamily): Promise<void> => {
  const cached = loadedFamilies.get(family);
  if (cached) return cached;

  if (typeof FontFace === "undefined") {
    // Node.js側SSR等、ブラウザ/ヘッドレスChromeでない環境では何もしない。
    const resolved = Promise.resolve();
    loadedFamilies.set(family, resolved);
    return resolved;
  }

  const def = FONT_DEFINITIONS[family];
  const promise = Promise.all(
    def.weights.map((weight) =>
      loadFont({
        family,
        url: staticFile(`fonts/${def.slug}/${def.slug}-japanese-${weight}-normal.woff2`),
        weight,
        style: "normal",
      })
    )
  ).then(() => undefined);
  loadedFamilies.set(family, promise);
  return promise;
};
