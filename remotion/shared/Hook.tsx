import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

type Props = {
  headline: string;
  subline?: string;
  accentColor: string;
  /** 字幕の位置。字幕が画面中央にあるときは見出しと重ならないよう上寄りに出す。 */
  captionPosition?: "top" | "middle" | "bottom";
};

/**
 * フック(冒頭0-3秒): 結論・数字を先出しして離脱を防ぐ導入テロップ。
 * 以前は黒背景の独立したタイトルカードだったが、バズるショート動画は1フレーム目から本人の
 * 映像が見えている方がスクロールを止めやすいため、動画の上に重ねる形にしている。
 */
export const Hook: React.FC<Props> = ({ headline, subline, accentColor, captionPosition = "bottom" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({
    frame,
    fps,
    config: { damping: 12, mass: 0.6 },
    durationInFrames: 15,
  });
  const opacity = interpolate(frame, [0, 8], [0, 1], {
    extrapolateRight: "clamp",
  });
  const flashOpacity = interpolate(frame, [0, 6, 16], [0.55, 0, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // 長い見出しが「リベン/ジ」のように1〜2文字だけ次の行へ落ちると読みにくいため、
  // 1行(幅約900px)に収まるよう文字数に応じて縮める。
  const longestLine = Math.max(1, ...headline.split("\n").map((line) => line.length));
  const headlineFontSize = Math.min(84, Math.max(48, Math.floor(880 / longestLine)));

  return (
    <AbsoluteFill
      style={{
        // 上部はずっと出すタイトル(globalOverlays)が使うため、見出しは画面中央に出す。
        // ただし字幕が中央にある場合は重なって両方読めなくなるため、タイトルと字幕の間(上寄り)に出す。
        justifyContent: captionPosition === "middle" ? "flex-start" : "center",
        alignItems: "center",
        padding: 80,
        paddingTop: captionPosition === "middle" ? 560 : 80,
      }}
    >
      <AbsoluteFill style={{ backgroundColor: accentColor, opacity: flashOpacity * 0.6 }} />
      <div style={{ transform: `scale(${scale})`, opacity, textAlign: "center" }}>
        <div
          style={{
            color: "white",
            fontSize: headlineFontSize,
            fontWeight: 900,
            lineHeight: 1.25,
            whiteSpace: "pre-wrap",
            WebkitTextStroke: "3px #000",
            paintOrder: "stroke fill",
            textShadow: "0 6px 24px rgba(0,0,0,0.55)",
          }}
        >
          {headline}
        </div>
        {subline ? (
          <div
            style={{
              marginTop: 28,
              fontSize: 44,
              fontWeight: 800,
              color: accentColor,
              // 本人の映像の上に重ねるため、差し色の文字が背景に埋もれないよう白縁を付ける。
              WebkitTextStroke: "2px #fff",
              paintOrder: "stroke fill",
            }}
          >
            {subline}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
