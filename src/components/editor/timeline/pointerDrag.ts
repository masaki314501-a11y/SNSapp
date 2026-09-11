/**
 * タイムライン上のクリップ移動/トリムで共通して使う、Pointer Eventsベースのドラッグ処理。
 * ネイティブHTML5 DnD(旧リスト実装)だとタッチ操作やピクセル単位の連続移動に弱いため、
 * pointerdown/move/upを自前で束ねる。setPointerCaptureで要素にポインタを固定するので、
 * ドラッグ中に指/カーソルがブロックの外に出てもmove/upを取りこぼさない。
 */

type DragHandlers = {
  onStart?: () => void;
  onMove: (deltaXPixels: number) => void;
  onEnd?: (deltaXPixels: number) => void;
  /** この閾値(px)未満の移動はクリック扱いにしたい呼び出し側向けに、確定した総移動量を渡す。 */
  onClick?: () => void;
  clickThresholdPixels?: number;
};

export const beginPointerDrag = (event: React.PointerEvent<HTMLElement>, handlers: DragHandlers): void => {
  // 左クリック/主タッチ以外は無視(右クリックメニュー等を邪魔しない)。
  if (event.button !== undefined && event.button !== 0) return;
  const target = event.currentTarget;
  const startX = event.clientX;
  const pointerId = event.pointerId;
  let lastDeltaX = 0;
  let moved = false;
  const threshold = handlers.clickThresholdPixels ?? 4;

  target.setPointerCapture(pointerId);
  handlers.onStart?.();

  const handleMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    lastDeltaX = e.clientX - startX;
    if (Math.abs(lastDeltaX) > threshold) moved = true;
    handlers.onMove(lastDeltaX);
  };

  const handleUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    target.removeEventListener("pointermove", handleMove);
    target.removeEventListener("pointerup", handleUp);
    target.removeEventListener("pointercancel", handleUp);
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    handlers.onEnd?.(lastDeltaX);
    if (!moved) handlers.onClick?.();
  };

  target.addEventListener("pointermove", handleMove);
  target.addEventListener("pointerup", handleUp);
  target.addEventListener("pointercancel", handleUp);
};
