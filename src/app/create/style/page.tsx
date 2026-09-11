import { StyleAndTranscribe } from "./StyleAndTranscribe";

export default function CreateStylePage() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:gap-8 sm:px-6 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl tracking-tight sm:text-3xl">
          参考画像・字幕生成
        </h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          カットで選んだ範囲を対象に、見た目の参考画像と自動字幕を設定します。
        </p>
      </div>

      <StyleAndTranscribe />
    </main>
  );
}
