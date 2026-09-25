"use client";

import { useEffect, useRef, useState } from "react";
import { VIDEO_FPS, VIDEO_WIDTH } from "@video/shared/constants";
import { resolveClipSrc } from "@video/shared/resolveSrc";
import type { ImageOverlay, TextOverlay } from "@video/shared/schema";
import type { ProjectSegment } from "@/lib/videoProject";

/** どの文字/画像を動かしているか。clipKeyがnullなら動画全体に出すもの(globalOverlays/globalImages)。 */
export type DragTarget = { clipKey: string | null; kind: "text" | "image"; index: number };

type Props = {
  segments: ProjectSegment[];
  globalOverlays: TextOverlay[] | null | undefined;
  globalImages: ImageOverlay[] | null | undefined;
  /** 今のプレビューの位置(フレーム)。この時点で画面に出ている文字/画像だけをつかめるようにする。 */
  frame: number;
  fontFamilyStack: string;
  onMove: (target: DragTarget, xPercent: number, yPercent: number) => void;
};

type Item = DragTarget & { key: string; overlay: TextOverlay | ImageOverlay };

const isVisibleAt = (item: { startOffsetSeconds: number; durationInSeconds?: number }, seconds: number) =>
  seconds >= item.startOffsetSeconds &&
  (item.durationInSeconds === undefined || seconds < item.startOffsetSeconds + item.durationInSeconds);

const clampPercent = (value: number) => Math.min(100, Math.max(0, Math.round(value * 10) / 10));

/**
 * プレビューの上に重ねる、強調テキスト・画像をドラッグで動かすための透明な層。
 * 自動編集が置いた文字の位置を「演出」タブの数値でしか直せず、直感的に動かしたいという要望に応えたもの。
 *
 * 実際の文字はRemotionの動画の中に描かれていてつかめないため、同じ大きさ・同じ位置に見えない枠を重ね、
 * その枠をつかませる。枠は動画と同じ1080px幅の座標で描いてから表示サイズに縮める
 * (文字の大きさをTextOverlays.tsxと同じ指定で再現し、枠と実際の文字をずらさないため)。
 * 指でもマウスでも動かせるようPointer Eventsを使う(iPhone/iPadが主な利用環境)。
 */
export const PreviewDragLayer: React.FC<Props> = ({
  segments,
  globalOverlays,
  globalImages,
  frame,
  fontFamilyStack,
  onMove,
}) => {
  const layerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [dragging, setDragging] = useState<string | null>(null);
  // 位置の更新は1描画につき1回にまとめる(指の動きのたびに編集内容全体を更新・保存すると重いため)
  const pendingMoveRef = useRef<{ target: DragTarget; x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setScale(el.clientWidth / VIDEO_WIDTH));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const items: Item[] = [];
  let clipStartFrame = 0;
  for (const segment of segments) {
    const clipEndFrame = clipStartFrame + Math.round(segment.durationInSeconds * VIDEO_FPS);
    if (frame >= clipStartFrame && frame < clipEndFrame) {
      const seconds = (frame - clipStartFrame) / VIDEO_FPS;
      segment.images?.forEach((overlay, index) => {
        if (isVisibleAt(overlay, seconds)) {
          items.push({ key: `${segment.key}-image-${index}`, clipKey: segment.key, kind: "image", index, overlay });
        }
      });
      segment.overlays?.forEach((overlay, index) => {
        if (overlay.text.trim() && isVisibleAt(overlay, seconds)) {
          items.push({ key: `${segment.key}-text-${index}`, clipKey: segment.key, kind: "text", index, overlay });
        }
      });
    }
    clipStartFrame = clipEndFrame;
  }
  const globalSeconds = frame / VIDEO_FPS;
  globalImages?.forEach((overlay, index) => {
    if (isVisibleAt(overlay, globalSeconds)) {
      items.push({ key: `global-image-${index}`, clipKey: null, kind: "image", index, overlay });
    }
  });
  globalOverlays?.forEach((overlay, index) => {
    if (overlay.text.trim() && isVisibleAt(overlay, globalSeconds)) {
      items.push({ key: `global-text-${index}`, clipKey: null, kind: "text", index, overlay });
    }
  });

  const handlePointerDown = (item: Item) => (event: React.PointerEvent<HTMLDivElement>) => {
    const layer = layerRef.current;
    if (!layer) return;
    // プレビューのクリック(再生/一時停止)として扱われないようにする
    event.stopPropagation();
    event.preventDefault();
    const rect = layer.getBoundingClientRect();
    // つかんだ点と文字の中心のずれを保ち、つかんだ瞬間に中心が指の位置へ飛ばないようにする
    const grabOffsetX = event.clientX - (rect.left + (item.overlay.xPercent / 100) * rect.width);
    const grabOffsetY = event.clientY - (rect.top + (item.overlay.yPercent / 100) * rect.height);
    const target: DragTarget = { clipKey: item.clipKey, kind: item.kind, index: item.index };
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    setDragging(item.key);

    const handleMove = (moveEvent: PointerEvent) => {
      pendingMoveRef.current = {
        target,
        x: clampPercent(((moveEvent.clientX - grabOffsetX - rect.left) / rect.width) * 100),
        y: clampPercent(((moveEvent.clientY - grabOffsetY - rect.top) / rect.height) * 100),
      };
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const pending = pendingMoveRef.current;
        if (pending) onMove(pending.target, pending.x, pending.y);
      });
    };
    const handleUp = () => {
      handle.removeEventListener("pointermove", handleMove);
      handle.removeEventListener("pointerup", handleUp);
      handle.removeEventListener("pointercancel", handleUp);
      setDragging(null);
    };
    handle.addEventListener("pointermove", handleMove);
    handle.addEventListener("pointerup", handleUp);
    handle.addEventListener("pointercancel", handleUp);
  };

  return (
    <div ref={layerRef} className="preview-drag-layer">
      {scale > 0 ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: VIDEO_WIDTH,
            height: `${100 / scale}%`,
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
            // 枠線は縮小後も見える太さにするため、縮小率の逆数をCSSに渡す(editor-theme.css)
            ["--drag-inverse-scale" as string]: 1 / scale,
          }}
        >
          {items.map((item) => {
            const overlay = item.overlay;
            const common: React.CSSProperties = {
              left: `${overlay.xPercent}%`,
              top: `${overlay.yPercent}%`,
              transform: `translate(-50%, -50%) rotate(${overlay.rotationDeg}deg)`,
            };
            return (
              <div
                key={item.key}
                className={`preview-drag-handle${dragging === item.key ? " dragging" : ""}`}
                style={
                  item.kind === "image"
                    ? { ...common, width: `${(overlay as ImageOverlay).widthPercent}%` }
                    : { ...common, maxWidth: "90%" }
                }
                onPointerDown={handlePointerDown(item)}
                title="ドラッグで動かせます"
              >
                {item.kind === "image" ? (
                  // 枠の高さを実際の画像と揃えるためだけに、見えない画像を置く
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={resolveClipSrc((overlay as ImageOverlay).src)} alt="" draggable={false} />
                ) : (
                  <span
                    style={{
                      fontFamily: fontFamilyStack,
                      fontSize: (overlay as TextOverlay).fontSizePx,
                      padding: (overlay as TextOverlay).backgroundColor ? "0.12em 0.4em" : undefined,
                    }}
                  >
                    {(overlay as TextOverlay).text}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
