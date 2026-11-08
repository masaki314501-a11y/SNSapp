import { useEffect } from "react";

/**
 * active の間、スマホの画面が自動で消えない(ロックされない)ようにする(Screen Wake Lock API)。
 * AIの自動編集は画面を開いたままでないと止まるため、待っている間に画面が消えて止まるのを防ぐ。
 * 別のアプリに切り替えると外れるので、この画面に戻ってきた時にもう一度頼む。
 * 対応していないブラウザ(古いSafari等)では何もしない(今までどおり「画面を開いたままに」と案内する)。
 */
export const useWakeLock = (active: boolean) => {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) void next.release();
        else lock = next;
      } catch {
        // 省電力モード中などで断られた時は、何もしない(画面の案内のまま)
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void request();
    };
    void request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
};
