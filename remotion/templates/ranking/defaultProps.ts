import type { RankingVideoProps } from "./schema";
import { NOTO_SANS_JP_FONT_FAMILY } from "../../shared/font";

/**
 * Studio/Player でのプレビュー用サンプルデータ。
 * items[].src は未指定 = プレースホルダー背景で表示される。
 */
export const defaultRankingVideoProps: RankingVideoProps = {
  hook: {
    headline: "コスパ最強\nガジェット3選",
    subline: "最後まで見て",
  },
  items: [
    {
      title: "折りたたみスタンド",
      caption: "机の上がすっきり",
      durationInSeconds: 5,
      startFromSeconds: 0,
      captionAnimation: "fade",
    },
    {
      title: "USB-C急速充電器",
      caption: "45分でフル充電",
      durationInSeconds: 5,
      startFromSeconds: 0,
      captionAnimation: "pop",
    },
    {
      title: "ワイヤレスイヤホン",
      caption: "1回の充電で8時間",
      durationInSeconds: 5,
      startFromSeconds: 0,
      captionAnimation: "slide-up",
    },
  ],
  cta: {
    text: "詳しくはプロフィールへ",
  },
  theme: {
    primaryColor: "#FF3366",
    fontFamily: `"${NOTO_SANS_JP_FONT_FAMILY}", "Hiragino Sans", sans-serif`,
  },
};
