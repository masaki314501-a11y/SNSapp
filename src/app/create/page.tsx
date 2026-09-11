import { UploadGenerator } from "./UploadGenerator";

export default function CreatePage() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:gap-8 sm:px-6 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl tracking-tight sm:text-3xl">
          動画をアップロード
        </h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          アップロード後、使う範囲を選ぶ(カット)→参考画像・字幕生成→編集の順に進みます。
        </p>
      </div>

      <UploadGenerator />
    </main>
  );
}
