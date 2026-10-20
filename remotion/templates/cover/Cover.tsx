import React from "react";
import { AbsoluteFill } from "remotion";
import { MediaBackground } from "../../shared/MediaBackground";
import { TextOverlays } from "../../shared/TextOverlays";
import { breakIntoLines } from "../../shared/textWrap";
import { resolveFontFamilyStack, type CaptionFontFamily, type VideoFraming } from "../../shared/schema";

/**
 * 投稿の表紙(サムネイル)。動画の好きな場面に、タイトルを大きく重ねた1枚の絵。
 * 書き出し画面で、動画と同じ部品(映像・文字のスタイル)を使ってブラウザの中で画像にする(CoverMaker.tsx)。
 *
 * 文字の出現演出(フェード等)が終わった後の絵にするため、30コマの短い動画として作り、最後のコマを画像にする。
 * そのため映像は、選んだ場面の1秒前から流し、最後のコマでちょうど選んだ場面になるようにする。
 */
export const COVER_FPS = 30;
export const COVER_DURATION_IN_FRAMES = 30;
/** 画像にするコマ(最後のコマ)。 */
export const COVER_STILL_FRAME = COVER_DURATION_IN_FRAMES - 1;
/** タイトルの1行の幅の上限(px)。画面の端に寄りすぎないようにする。 */
const COVER_TITLE_MAX_WIDTH_PX = 900;

export type CoverProps = {
  /** 元の動画(public/配下のパス)。 */
  videoSrc: string;
  /** 表紙にする場面(元の動画の秒数)。 */
  frameSeconds: number;
  /** 動画全体の画角(本編と同じ寄せ方にする)。 */
  framing?: VideoFraming;
  title: string;
  /** 文字のスタイル(textStylePresets.tsのid)。無ければ白い文字に黒い縁取り。 */
  textStyleId?: string;
  /** タイトルの中心の縦位置(%)と大きさ(px)。 */
  yPercent: number;
  fontSizePx: number;
  fontFamily: CaptionFontFamily;
};

export const Cover: React.FC<CoverProps> = ({
  videoSrc,
  frameSeconds,
  framing,
  title,
  textStyleId,
  yPercent,
  fontSizePx,
  fontFamily,
}) => (
  <AbsoluteFill style={{ backgroundColor: "#000" }}>
    <MediaBackground
      src={videoSrc}
      startFromSeconds={Math.max(0, frameSeconds - COVER_STILL_FRAME / COVER_FPS)}
      index={0}
      placeholderLabel=""
      volume={0}
      framing={framing}
    />
    {title.trim() ? (
      <TextOverlays
        fontFamilyStack={resolveFontFamilyStack(fontFamily)}
        overlays={[
          {
            // 長いタイトルは文節の切れ目で行を分け、大きいまま出す(1行に詰めると文字が小さく縮められてしまう)
            text: title.includes("\n") ? title : breakIntoLines(title, fontSizePx, COVER_TITLE_MAX_WIDTH_PX).join("\n"),
            startOffsetSeconds: 0,
            xPercent: 50,
            yPercent,
            fontSizePx,
            color: "#FFFFFF",
            strokeColor: "#000000",
            rotationDeg: 0,
            animation: "fade",
            textStyleId,
          },
        ]}
      />
    ) : null}
  </AbsoluteFill>
);
