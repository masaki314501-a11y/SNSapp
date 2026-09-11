import { InsightsExplorer } from "./InsightsExplorer";

export default function InsightsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:gap-8 sm:px-6 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl tracking-tight sm:text-3xl">
          お店のクチコミを見る
        </h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Googleマップの公開情報(評価・口コミ)を、自社・競合を問わず検索できます。
          投稿ネタ探しの参考にどうぞ。
        </p>
      </div>

      <InsightsExplorer />
    </main>
  );
}
