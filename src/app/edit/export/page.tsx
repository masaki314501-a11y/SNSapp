import { ExportScreen } from "@/components/editor/ExportScreen";
import "@/components/editor/editor-theme.css";

export default function ExportPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl tracking-tight sm:text-3xl">
          動画を書き出す
        </h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          書き出しが終わるとダウンロードできます。この画面を閉じずにお待ちください。
        </p>
      </div>

      <ExportScreen />
    </main>
  );
}
