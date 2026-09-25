import { StyleAndTranscribe } from "./StyleAndTranscribe";

export default function CreateStylePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:gap-8 sm:px-6 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl tracking-tight sm:text-3xl">
          参考スクショ(見た目の手本)
        </h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          編集の感じを真似したい投稿のスクリーンショットや動画を渡すと、自動編集がそれを最優先の手本にします。
        </p>
      </div>

      <StyleAndTranscribe />
    </main>
  );
}
