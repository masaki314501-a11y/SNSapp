import { describe, expect, it, vi } from "vitest";
import { beginPointerDrag, cancelActivePointerDrags } from "./pointerDrag";

// テスト実行環境(node)にはDOMが無いため、ドラッグ処理が使う最小限の要素とイベントを用意する。
const makeTarget = () => {
  const target = new EventTarget() as EventTarget & {
    setPointerCapture: (id: number) => void;
    releasePointerCapture: (id: number) => void;
    hasPointerCapture: (id: number) => boolean;
  };
  target.setPointerCapture = () => {};
  target.releasePointerCapture = () => {};
  target.hasPointerCapture = () => true;
  return target;
};
const pointerEvent = (type: string, pointerId: number, clientX = 0) =>
  Object.assign(new Event(type), { pointerId, clientX });
const startDrag = (target: ReturnType<typeof makeTarget>, handlers: Parameters<typeof beginPointerDrag>[1]) =>
  beginPointerDrag(
    { button: 0, clientX: 100, pointerId: 1, currentTarget: target } as unknown as React.PointerEvent<HTMLElement>,
    handlers
  );

describe("cancelActivePointerDrags", () => {
  it("2本指のピンチが始まったら、1本目のドラッグを確定させずに元の位置へ戻す", () => {
    const target = makeTarget();
    const onMove = vi.fn();
    const onEnd = vi.fn();
    const onClick = vi.fn();
    const onCancel = vi.fn();
    startDrag(target, { onMove, onEnd, onClick, onCancel });

    cancelActivePointerDrags();

    expect(onMove).toHaveBeenLastCalledWith(0);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();

    // 取り消した後に指を離しても、並べ替え等は確定しない
    target.dispatchEvent(pointerEvent("pointerup", 1, 180));
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("取り消しが無ければ、指を離した時に通常どおり確定する", () => {
    const target = makeTarget();
    const onEnd = vi.fn();
    startDrag(target, { onMove: vi.fn(), onEnd });

    target.dispatchEvent(pointerEvent("pointerup", 1, 100));

    expect(onEnd).toHaveBeenCalledWith(0);
  });

  it("確定済みのドラッグは取り消しの対象にならない", () => {
    const target = makeTarget();
    const onCancel = vi.fn();
    startDrag(target, { onMove: vi.fn(), onCancel });
    target.dispatchEvent(pointerEvent("pointerup", 1, 100));

    cancelActivePointerDrags();

    expect(onCancel).not.toHaveBeenCalled();
  });
});
