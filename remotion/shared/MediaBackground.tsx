import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { resolveClipSrc } from "./resolveSrc";

const PLACEHOLDER_COLORS = ["#1F2937", "#312E81", "#7C2D12", "#134E4A"];

type Props = {
  src?: string;
  startFromSeconds: number;
  index: number;
  placeholderLabel: string;
};

/**
 * カット/ランキングアイテム共通の背景メディア表示。
 * src 未指定時はプレースホルダー背景を表示し、実素材が無くてもプレビュー・レンダーが成立するようにする。
 * カット頭のパンチインズームも共通化。
 */
export const MediaBackground: React.FC<Props> = ({
  src,
  startFromSeconds,
  index,
  placeholderLabel,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const zoom = interpolate(frame, [0, 10], [1.06, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
      {src ? (
        <OffthreadVideo
          src={resolveClipSrc(src)}
          startFrom={Math.round(startFromSeconds * fps)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <AbsoluteFill
          style={{
            backgroundColor: PLACEHOLDER_COLORS[index % PLACEHOLDER_COLORS.length],
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <span
            style={{
              color: "rgba(255,255,255,0.3)",
              fontSize: 32,
              fontWeight: 700,
            }}
          >
            {placeholderLabel}
          </span>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
