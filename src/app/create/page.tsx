import { AutoEditor } from "./AutoEditor";

export default function CreatePage() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-2">
        <span className="badge-pill neutral w-fit">Gemini APIで自動生成</span>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
          ショート動画を作成
        </h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          動画・参考スクリーンショット・タイトルを入力すると、AIが
          「フック(0-3秒)→本題(3-20秒)→CTA(20-25秒)」の構成で自動生成します。
        </p>
      </div>

      <AutoEditor />
    </main>
  );
}
