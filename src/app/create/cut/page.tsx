import { CutEditor } from "@/components/editor/CutEditor";
import "@/components/editor/editor-theme.css";

export default function CreateCutPage() {
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl tracking-tight sm:text-3xl">
          使う範囲を選ぶ(カット)
        </h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          不要な部分を分割・削除して、実際に使う範囲だけに絞り込みましょう。
          ここで捨てた範囲は、この後の自動編集・字幕の対象になりません。
        </p>
      </div>

      <CutEditor />
    </main>
  );
}
