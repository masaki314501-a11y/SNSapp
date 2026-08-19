import { templateRegistry, type TemplateId } from "./registry";
import { StandardVideo, calculateStandardVideoMetadata } from "./standard/StandardVideo";
import { defaultStandardVideoProps } from "./standard/defaultProps";
import { getStandardVideoDurationInFrames } from "./standard/duration";
import { RankingVideo, calculateRankingVideoMetadata } from "./ranking/RankingVideo";
import { defaultRankingVideoProps } from "./ranking/defaultProps";
import { getRankingVideoDurationInFrames } from "./ranking/duration";

/**
 * 実際に描画するReactコンポーネント一式を含むレジストリ。
 * font.ts (ブラウザのFontFace APIに依存) を巻き込むため、
 * Node.jsのAPIルートからは絶対に読み込まないこと(registry.ts を使う)。
 * Root.tsx / Player を使うページ(/create, /preview)専用。
 */
export const clientTemplateRegistry = {
  standard: {
    ...templateRegistry.standard,
    component: StandardVideo,
    calculateMetadata: calculateStandardVideoMetadata,
    defaultProps: defaultStandardVideoProps,
    getDurationInFrames: getStandardVideoDurationInFrames,
  },
  ranking: {
    ...templateRegistry.ranking,
    component: RankingVideo,
    calculateMetadata: calculateRankingVideoMetadata,
    defaultProps: defaultRankingVideoProps,
    getDurationInFrames: getRankingVideoDurationInFrames,
  },
} satisfies Record<TemplateId, unknown>;
