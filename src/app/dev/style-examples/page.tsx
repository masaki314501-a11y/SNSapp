import { listInboxFiles, listStyleExamples } from "@/lib/gemini/styleExamplesStore";
import { StyleExamplesManager } from "./StyleExamplesManager";

/**
 * 開発者用ページ。スタイル抽出(extractStyle)のfew-shot例(正解データ)を登録・管理する。
 * エンドユーザー向けの導線は無く、URLを直接開いて使う(/insights と同じ運用、README参照)。
 * ここで登録した内容は data/style-examples/ にファイルとして保存されるだけなので、
 * 本番環境にも反映したい場合は開発者がそのままgitコミットする必要がある
 * (Render等のデプロイ環境は実行時に書いたファイルを永続化しないため)。
 */
export default async function StyleExamplesPage() {
  const [examples, inboxFiles] = await Promise.all([listStyleExamples(), listInboxFiles()]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:gap-8 sm:px-6 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl tracking-tight sm:text-3xl">
          スタイル抽出の正解データ
        </h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          参考画像/参考動画と「本来抽出してほしいスタイル」の組を登録すると、次回以降のスタイル抽出
          (/create/style)でfew-shot例として渡され、抽出精度の向上に使われます。開発者用のページです。
          手元に動画がまとまってある場合は <code>data/style-examples/inbox/</code>{" "}
          に置いて一括取り込みもできます。
        </p>
      </div>

      <StyleExamplesManager initialExamples={examples} initialInboxFileCount={inboxFiles.length} />
    </main>
  );
}
