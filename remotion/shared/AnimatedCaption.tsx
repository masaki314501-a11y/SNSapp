import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { getCaptionAnimationStyle } from "./captionAnimations";
import { ensureCaptionFontLoaded } from "./font";
import type { CaptionAnimation, CaptionFontFamily, CaptionFontSize, CaptionPosition, CaptionStyle } from "./schema";
import { CAPTION_FONT_SIZE_SCALE, resolveFontFamilyStack } from "./schema";

type Props = {
  text: string;
  accentColor: string;
  animation: CaptionAnimation;
  /** pill=アクセントカラーの角丸背景、outline=背景無しの白文字+黒縁取り */
  captionStyle?: CaptionStyle;
  fontFamily?: CaptionFontFamily;
  position?: CaptionPosition;
  fontSize?: CaptionFontSize;
  /** テロップ中で色を変えて大きく見せる単語。 */
  emphasisWords?: string[];
  emphasisColor?: string;
};

/**
 * テロップ文字列を強調単語の出現位置で区切る。長い単語から優先して当てることで、
 * 「3倍」と「3」のように片方がもう片方を含む場合も長い方が強調される。
 */
const splitByEmphasis = (text: string, words: string[]): { text: string; emphasized: boolean }[] => {
  const targets = [...new Set(words.map((w) => w.trim()).filter((w) => w.length > 0))].sort(
    (a, b) => b.length - a.length
  );
  if (targets.length === 0) return [{ text, emphasized: false }];
  const escaped = targets.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "g");
  return text
    .split(pattern)
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, emphasized: targets.includes(part) }));
};

const OFFSET_FROM_EDGE = 160;

const POSITION_STYLE: Record<CaptionPosition, React.CSSProperties> = {
  top: { justifyContent: "flex-start", paddingTop: OFFSET_FROM_EDGE, paddingBottom: 0 },
  middle: { justifyContent: "center", paddingTop: 0, paddingBottom: 0 },
  bottom: { justifyContent: "flex-end", paddingTop: 0, paddingBottom: OFFSET_FROM_EDGE },
};

/**
 * カット/ランキングアイテム共通のテロップ表示。パターンに応じた出現アニメーションは
 * captionAnimations.ts に委譲する。
 */
export const AnimatedCaption: React.FC<Props> = ({
  text,
  accentColor,
  animation,
  captionStyle = "pill",
  fontFamily = "Noto Sans JP",
  position = "bottom",
  fontSize = "medium",
  emphasisWords,
  emphasisColor = "#FFE600",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { transform, opacity, clipPath, filter } = getCaptionAnimationStyle(animation, frame, fps);
  // 選択されているフォントだけを遅延読み込みする(全書体を毎回読み込むのは無駄が大きいため)。
  void ensureCaptionFontLoaded(fontFamily);

  if (!text.trim()) {
    // 発話が無い無音区間はテロップを表示しない(pillスタイルの空の背景ボックスが
    // 出てしまうのを防ぐ)。
    return null;
  }

  const fontFamilyStack = resolveFontFamilyStack(fontFamily);
  const sizeScale = CAPTION_FONT_SIZE_SCALE[fontSize];

  const textStyle: React.CSSProperties =
    captionStyle === "outline"
      ? {
          display: "inline-block",
          color: "white",
          WebkitTextStroke: `2.5px ${accentColor}`,
          paintOrder: "stroke fill",
          fontFamily: fontFamilyStack,
          fontSize: 48 * sizeScale,
          fontWeight: 900,
          lineHeight: 1.35,
          textShadow: "0 4px 12px rgba(0,0,0,0.5)",
        }
      : {
          display: "inline-block",
          backgroundColor: accentColor,
          color: "white",
          fontFamily: fontFamilyStack,
          fontSize: 44 * sizeScale,
          fontWeight: 800,
          padding: "16px 32px",
          borderRadius: 16,
          lineHeight: 1.35,
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        };

  return (
    <AbsoluteFill
      style={{
        ...POSITION_STYLE[position],
        alignItems: "center",
        paddingLeft: 48,
        paddingRight: 48,
      }}
    >
      <div style={{ transform, opacity, filter, maxWidth: "100%", textAlign: "center" }}>
        <span style={{ ...textStyle, clipPath }}>
          {splitByEmphasis(text, emphasisWords ?? []).map((part, i) =>
            part.emphasized ? (
              <span key={i} style={{ color: emphasisColor, fontSize: "1.25em" }}>
                {part.text}
              </span>
            ) : (
              <React.Fragment key={i}>{part.text}</React.Fragment>
            )
          )}
        </span>
      </div>
    </AbsoluteFill>
  );
};
