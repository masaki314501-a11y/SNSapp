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

  // pointermoveは指/カーソルの動き1回ごとに(高頻度な環境だと1秒間に100回以上)発火するが、
  // onMove側はReactの状態更新とプレビューの再計算を伴い重いため、そのまま繋ぐと
  // ドラッグ中にカクつく。1フレームにつき最新の1回だけ反映すれば見た目は変わらず滑らかになる。
  let rafId: number | null = null;
  const flush = () => {
    rafId = null;
    handlers.onMove(lastDeltaX);
  };

  const handleMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    lastDeltaX = e.clientX - startX;
    if (Math.abs(lastDeltaX) > threshold) moved = true;
    if (rafId === null) rafId = requestAnimationFrame(flush);
  };

  const handleUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    target.removeEventListener("pointermove", handleMove);
    target.removeEventListener("pointerup", handleUp);
    target.removeEventListener("pointercancel", handleUp);
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
      handlers.onMove(lastDeltaX);
    }
    handlers.onEnd?.(lastDeltaX);
    if (!moved) handlers.onClick?.();
  };

  target.addEventListener("pointermove", handleMove);
  target.addEventListener("pointerup", handleUp);
  target.addEventListener("pointercancel", handleUp);
};
