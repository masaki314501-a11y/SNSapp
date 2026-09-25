import { ClipEditor } from "@/components/editor/ClipEditor";
import "@/components/editor/editor-theme.css";

export default function EditPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1800px] flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl tracking-tight sm:text-3xl">
          クリップを編集する
        </h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          いらない部分をカットしたり、順番を並べ替えたりして、動画を書き出しましょう。
        </p>
      </div>

      <ClipEditor />
    </main>
  );
}
