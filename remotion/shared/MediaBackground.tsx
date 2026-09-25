import React from "react";
import { AbsoluteFill, Html5Video, interpolate, useCurrentFrame, useRemotionEnvironment, useVideoConfig } from "remotion";
// <OffthreadVideo>はサーバー側のフレーム抽出(compositor)が前提で、ブラウザ内での書き出し
// (@remotion/web-renderer)に対応していない。書き出しを利用者のブラウザで行うようにしたため
// (サーバーのメモリ512MBでは落ちていた。useWebRender.ts参照)、どちらでも動く<Video>を使う。
import { Video } from "@remotion/media";
import { resolveClipSrc } from "./resolveSrc";
import type { ClipZoom } from "./schema";

const PLACEHOLDER_COLORS = ["#1F2937", "#312E81", "#7C2D12", "#134E4A"];

type Props = {
  src?: string;
  startFromSeconds: number;
  index: number;
  placeholderLabel: string;
  volume?: number;
  zoom?: ClipZoom;
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
  volume = 1,
  zoom,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { isPlayer } = useRemotionEnvironment();

  // 寄りの指定が無いカットは従来通り、カット頭でわずかに引く小さなパンチインだけ入れる。
  // punchはカット頭で目標倍率より少し大きい所から一瞬で落ち着かせ「ドンッ」と寄った印象に、
  // slowはカットの長さいっぱいを使ってじわじわ寄る。
  const scale = !zoom
    ? interpolate(frame, [0, 10], [1.06, 1], { extrapolateRight: "clamp" })
    : zoom.style === "slow"
      ? interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [1, zoom.scale], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : interpolate(frame, [0, 5], [zoom.scale * 1.05, zoom.scale], { extrapolateRight: "clamp" });
  const transformOrigin = zoom ? `${zoom.focusXPercent}% ${zoom.focusYPercent}%` : "50% 50%";

  return (
    <AbsoluteFill style={{ transform: `scale(${scale})`, transformOrigin }}>
      {src && isPlayer ? (
        // 編集画面のプレビューでは、ブラウザ標準の<video>で再生する。@remotion/mediaの<Video>は1コマずつ
        // 解読してcanvasに描くため重く、iPhone/iPadでは読み込み待ちのたびにプレビュー全体が止まっていた。
        // 標準の<video>は端末のハードウェアで再生され、読み込みが遅れても全体は止めずに進む
        // (その間だけ絵が少し止まる)。書き出しはコマ単位で正確に描く必要があるので、下の<Video>のまま。
        <Html5Video
          src={resolveClipSrc(src)}
          trimBefore={Math.round(startFromSeconds * fps)}
          volume={volume}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : src ? (
        <Video
          src={resolveClipSrc(src)}
          trimBefore={Math.round(startFromSeconds * fps)}
          volume={volume}
          objectFit="cover"
          style={{ width: "100%", height: "100%" }}
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
