import { AutoEditScreen } from "./AutoEditScreen";

export default function CreateAutoEditPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:gap-8 sm:px-6 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl tracking-tight sm:text-3xl">自動編集</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          演出・AIナレーション・効果音の配置をAIが提案します。気に入らなければそのまま
          スキップして手動編集に進めます。
        </p>
      </div>

      <AutoEditScreen />
    </main>
  );
}
