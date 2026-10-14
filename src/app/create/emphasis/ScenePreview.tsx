"use client";

import { useEffect, useRef } from "react";
import { resolveFontFamilyStack, type CaptionEmphasis } from "@video/shared/schema";

export type PreviewScene = {
  /** 元の動画の、この場面の開始・終了秒。 */
  from: number;
  to: number;
  caption: string;
  emphasis?: CaptionEmphasis;
  /** 同じ場面をもう一度押した時にも流し直すための番号。 */
  nonce: number;
};

/**
 * 強調を選ぶ画面の小さな動画プレビュー。字幕の「▶」を押すと、その場面だけを流して止める。
 * 字幕の文字と時間だけでは、どれがどの場面か(山場か)を思い出せなかったため。
 * 字幕は強調の見た目(帯・色・書体)の簡単な見本として重ねる(動画での正確な見え方は編集画面のプレビューで見る)。
 */
export const ScenePreview: React.FC<{ videoSrc: string; scene: PreviewScene | null }> = ({ videoSrc, scene }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  // 場面の情報は描くたびに作り直されるので、流し直すのは「押された時」(nonceが変わった時)だけにする
  // (強調の見た目を変えただけで頭から流し直さないように)
  const from = scene?.from;
  const nonce = scene?.nonce;
  useEffect(() => {
    const video = videoRef.current;
    if (!video || from === undefined || nonce === undefined) return;
    video.currentTime = from;
    void video.play().catch(() => {
      // 自動再生が止められた時は、動画の再生ボタンで流してもらう
    });
  }, [from, nonce]);

  const emphasis = scene?.emphasis;
  return (
    <div className="relative overflow-hidden rounded-lg" style={{ background: "#000", height: 240 }}>
      <video
        ref={videoRef}
        src={videoSrc}
        playsInline
        preload="metadata"
        onTimeUpdate={(e) => {
          if (scene && e.currentTarget.currentTime >= scene.to) e.currentTarget.pause();
        }}
        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
      />
      {scene ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3">
          <span
            lang="ja"
            style={{
              display: "inline-block",
              maxWidth: "100%",
              textAlign: "center",
              fontWeight: 900,
              fontSize: 14,
              lineHeight: 1.35,
              padding: emphasis?.band ? "3px 8px" : undefined,
              borderRadius: 4,
              background: emphasis?.band ? (emphasis.bandColor ?? "#FFFFFF") : undefined,
              color: emphasis?.textColor ?? (emphasis?.band ? "#111111" : "#FFFFFF"),
              fontFamily: emphasis?.fontFamily ? resolveFontFamilyStack(emphasis.fontFamily) : undefined,
              WebkitTextStroke: emphasis?.band ? undefined : "3px #000000",
              paintOrder: "stroke fill",
            }}
          >
            {scene.caption}
          </span>
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs" style={{ color: "#bbb" }}>
          字幕の▶を押すと、その場面を流します
        </div>
      )}
    </div>
  );
};
