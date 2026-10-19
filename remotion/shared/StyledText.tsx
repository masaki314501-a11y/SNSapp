import React from "react";
import { LINE_STYLE } from "./textWrap";
import { resolveFontFamilyStack } from "./schema";
import { ensureCaptionFontLoaded } from "./font";
import type { TextStylePreset } from "./textStylePresets";

const rgba = (hex: string, alpha: number): string => {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
};

/**
 * 丸い縁取り。文字を少しずつずらした影を輪のように並べて作る。
 * -webkit-text-strokeは角が尖る(miter)うえ角の形を変えられず、太い縁取りで角がトゲのように飛び出したため。
 * 影は書き出し(@remotion/web-renderer)でもそのまま描ける。輪は3重にし、2.5pxおきに並べてふちがギザギザしないようにする。
 */
const roundStrokeShadow = (color: string, widthPx: number): string => {
  const shadows: string[] = [];
  for (const radius of [widthPx, widthPx * 0.66, widthPx * 0.33]) {
    const count = Math.max(8, Math.ceil((2 * Math.PI * radius) / 2.5));
    for (let i = 0; i < count; i++) {
      const angle = (2 * Math.PI * i) / count;
      shadows.push(`${(Math.cos(angle) * radius).toFixed(1)}px ${(Math.sin(angle) * radius).toFixed(1)}px 0 ${color}`);
    }
  }
  return shadows.join(",");
};

/** 1行の中の、色や大きさを変える一部分(字幕の重大ワード・強調する語)。 */
export type StyledTextPart = { text: string; color?: string; scale?: number; hidden?: boolean };

type Props = {
  preset: TextStylePreset;
  fontSizePx: number;
  /** 行ごとの文字。色や大きさを変える所がある行は、部分の並びで渡す。 */
  lines: (string | StyledTextPart[])[];
  italic?: boolean;
  /** 書体だけ変える(字幕の強調で本人が書体を選んだ時)。省略時はスタイルの書体。 */
  fontFamily?: TextStylePreset["fontFamily"];
};

/**
 * 文字のスタイル(textStylePresets.ts)で文字を描く。後ろから「背景の箱 → 影・光 → 太い縁取り → 細い縁取り → 文字」の順に重ねる。
 * 縁取りの層には同じ文字を置き、影でふち取る(層ごとに太さと色を変えて、何重もの縁取りにする)。
 */
export const StyledText: React.FC<Props> = ({ preset, fontSizePx, lines, italic, fontFamily = preset.fontFamily }) => {
  void ensureCaptionFontLoaded(fontFamily);
  const textStyle: React.CSSProperties = {
    fontFamily: resolveFontFamilyStack(fontFamily),
    fontWeight: preset.fontWeight,
    fontStyle: italic ? "italic" : undefined,
    fontSize: fontSizePx,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
  };
  const strokes = [...preset.strokes].sort((a, b) => b[1] - a[1]);
  // 縁取り・影の層では色を付けず(層の色で塗る)、大きさだけ変える。文字の層でだけ部分の色を付ける。
  const renderLines = (withColor: boolean) =>
    lines.map((line, index) => (
      <span key={index} style={LINE_STYLE}>
        {typeof line === "string"
          ? line
          : line.map((part, partIndex) =>
              part.color || part.scale || part.hidden ? (
                <span
                  key={partIndex}
                  style={{
                    fontSize: part.scale ? `${part.scale}em` : undefined,
                    // まだ話していない言葉(話に合わせて順に出す時)は、場所は取ったまま見えなくする(行の位置がずれないように)
                    visibility: part.hidden ? "hidden" : undefined,
                    // グラデーションの文字(背景を文字の形に切り抜く)の中でも色が出るよう、色は文字の色で塗る
                    ...(withColor && part.color ? { color: part.color, WebkitTextFillColor: part.color } : {}),
                  }}
                >
                  {part.text}
                </span>
              ) : (
                <React.Fragment key={partIndex}>{part.text}</React.Fragment>
              )
            )}
      </span>
    ));
  const text = renderLines(false);
  const fill: React.CSSProperties = preset.gradient
    ? {
        backgroundImage: `linear-gradient(${90 + preset.gradient.angleDeg}deg, ${preset.gradient.stops
          .map(([color, position]) => `${color} ${(position * 100).toFixed(1)}%`)
          .join(", ")})`,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
      }
    : { color: preset.color ?? "#FFFFFF" };

  // 影・光は、一番外側の縁取り(+影の広がり)と同じ形をした層を、ずらしてぼかして後ろに置く。
  // CSSのdrop-shadowを重ねると2つ目の影が1つ目の影にも付いてしまうので、影ごとに層を分ける。
  const outerStrokeWidth = strokes.length > 0 ? strokes[0][1] : 0;
  const shadowLayers = [...(preset.shadows ?? [])].reverse().map((shadow, index) => {
    const spread = (outerStrokeWidth + shadow.size) * fontSizePx;
    return (
      <span
        key={`shadow${index}`}
        aria-hidden
        style={{
          ...textStyle,
          position: "absolute",
          inset: 0,
          color: shadow.color,
          textShadow: spread > 0 ? roundStrokeShadow(shadow.color, spread) : undefined,
          opacity: shadow.opacity,
          transform: `translate(${(shadow.dx * fontSizePx).toFixed(1)}px, ${(shadow.dy * fontSizePx).toFixed(1)}px)`,
          // Premiereのぼかしの値をそのままCSSのblurに渡すとぼけすぎる(スクリーンショットと見比べて約8分の1が合った)。
          filter: shadow.blur > 0 ? `blur(${((shadow.blur * fontSizePx) / 8).toFixed(1)}px)` : undefined,
        }}
      >
        {text}
      </span>
    );
  });

  return (
    <span lang="ja" style={{ position: "relative", display: "inline-block" }}>
      {(preset.backgrounds ?? []).map((background, index) => (
        <span
          key={`bg${index}`}
          style={{
            position: "absolute",
            left: -background.padX * fontSizePx,
            right: -background.padX * fontSizePx,
            top: -background.padY * fontSizePx,
            bottom: -background.padY * fontSizePx,
            borderRadius: background.radius * fontSizePx,
            backgroundColor: rgba(background.color, background.opacity),
          }}
        />
      ))}
      {shadowLayers}
      {strokes.map(([color, width], index) => (
        <span
          key={`stroke${index}`}
          aria-hidden
          style={{
            ...textStyle,
            position: "absolute",
            inset: 0,
            color,
            textShadow: roundStrokeShadow(color, width * fontSizePx),
          }}
        >
          {text}
        </span>
      ))}
      <span style={{ ...textStyle, position: "relative", display: "block", ...fill }}>{renderLines(true)}</span>
    </span>
  );
};
