import type { StandardVideoProps } from "./schema";

/**
 * Studio/Player でのプレビュー用サンプルデータ。
 * clips[].src は未指定 = プレースホルダー背景で表示される。
 * 実素材を使う場合は public/videos/ 配下に動画を置き、staticFile("videos/xxx.mp4") を指定する。
 */
export const defaultStandardVideoProps: StandardVideoProps = {
  clips: [
    {
      caption: "まずはここをチェック",
      durationInSeconds: 3,
      startFromSeconds: 0,
      captionAnimation: "slide-up",
      volume: 1,
    },
    {
      caption: "次にやるべきこと",
      durationInSeconds: 3,
      startFromSeconds: 3,
      captionAnimation: "pop",
      volume: 1,
    },
    {
      caption: "仕上げの一手",
      durationInSeconds: 3,
      startFromSeconds: 6,
      captionAnimation: "zoom-in",
      volume: 1,
    },
  ],
  theme: {
    primaryColor: "#FF3366",
    fontFamily: "Noto Sans JP",
    captionStyle: "pill",
    captionPosition: "bottom",
    fontSize: "medium",
    fadeInOut: false,
  },
  sfx: [],
};
