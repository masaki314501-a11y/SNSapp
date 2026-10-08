import React from "react";
import { AbsoluteFill, Easing, Html5Video, interpolate, useCurrentFrame, useRemotionEnvironment, useVideoConfig } from "remotion";
// <OffthreadVideo>はサーバー側のフレーム抽出(compositor)が前提で、ブラウザ内での書き出し
// (@remotion/web-renderer)に対応していない。書き出しを利用者のブラウザで行うようにしたため
// (サーバーのメモリ512MBでは落ちていた。useWebRender.ts参照)、どちらでも動く<Video>を使う。
import { Video } from "@remotion/media";
import { resolveClipSrc } from "./resolveSrc";
import type { ClipZoom, VideoFraming } from "./schema";

const PLACEHOLDER_COLORS = ["#1F2937", "#312E81", "#7C2D12", "#134E4A"];

type Props = {
  src?: string;
  startFromSeconds: number;
  index: number;
  placeholderLabel: string;
  volume?: number;
  zoom?: ClipZoom;
  /** 動画全体の画角。クリップごとの寄り(zoom)はこの上に重なる。 */
  framing?: VideoFraming;
};

/**
 * カット/ランキングアイテム共通の背景メディア表示。
 * src 未指定時はプレースホルダー背景を表示し、実素材が無くてもプレビュー・レンダーが成立するようにする。
 * カットごとの寄り(ズーム)も共通化。
 */
export const MediaBackground: React.FC<Props> = ({
  src,
  startFromSeconds,
  index,
  placeholderLabel,
  volume = 1,
  zoom,
  framing,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { isPlayer } = useRemotionEnvironment();

  // 寄りの指定が無いカットは等倍のまま動かさない。以前はカット頭ごとに1.06倍から引く小さな動きを
  // 入れていたが、1〜4秒で細かく切るとカットのたびに画面が揺れて見え、違和感の元になっていた。
  // punchはカット頭から目標倍率でそのまま映す(切り替わりで寄ったように見える、よくある「寄りカット」)。
  // 以前は目標より5%大きい所から戻していたが、その戻りがカクッとした揺れに見えたのでやめた。
  // slowはカットの長さいっぱいを使って、急に動き出さないよう緩やかに寄る。
  const scale = !zoom
    ? 1
    : zoom.style === "slow"
      ? interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [1, zoom.scale], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.inOut(Easing.quad),
        })
      : zoom.scale;
  const transformOrigin = zoom ? `${zoom.focusXPercent}% ${zoom.focusYPercent}%` : "50% 50%";

  const framingStyle: React.CSSProperties | undefined =
    framing && framing.scale > 1.001
      ? { transform: `scale(${framing.scale})`, transformOrigin: `${framing.focusXPercent}% ${framing.focusYPercent}%` }
      : undefined;

  return (
    <AbsoluteFill style={framingStyle}>
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
    </AbsoluteFill>
  );
};
