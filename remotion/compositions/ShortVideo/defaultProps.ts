import type { ShortVideoProps } from "./schema";
import { NOTO_SANS_JP_FONT_FAMILY } from "./font";

/**
 * Studio/Player でのプレビュー用サンプルデータ。
 * clips[].src は未指定 = プレースホルダー背景で表示される。
 * 実素材を使う場合は public/videos/ 配下に動画を置き、staticFile("videos/xxx.mp4") を指定する。
 */
export const defaultShortVideoProps: ShortVideoProps = {
  hook: {
    headline: "知らないと損する\n節約術3選",
    subline: "最後まで見て",
  },
  clips: [
    { caption: "①まずはここをチェック", durationInSeconds: 5, startFromSeconds: 0 },
    { caption: "②次にやるべきこと", durationInSeconds: 6, startFromSeconds: 0 },
    { caption: "③仕上げの一手", durationInSeconds: 6, startFromSeconds: 0 },
  ],
  cta: {
    text: "詳しくはプロフィールへ",
  },
  theme: {
    primaryColor: "#FF3366",
    fontFamily: `"${NOTO_SANS_JP_FONT_FAMILY}", "Hiragino Sans", sans-serif`,
  },
};
