import { listEditExamples } from "@/lib/gemini/editExamplesStore";
import { EditExamplesManager } from "./EditExamplesManager";

/**
 * 開発者用ページ。自動編集(バズる動画)機能のfew-shot例として使う「学習動画(元素材)」
 * 「正解動画(完成した参考動画)」を登録・管理する。エンドユーザー向けの導線は無く、
 * URLを直接開いて使う(/dev/style-examples と同じ運用、README参照)。
 * ここで登録した内容は data/edit-examples/ にファイルとして保存されるだけなので、
 * 本番環境にも反映したい場合は開発者がそのままgitコミットする必要がある
 * (Render等のデプロイ環境は実行時に書いたファイルを永続化しないため)。
 */
export default async function EditExamplesPage() {
  const examples = await listEditExamples();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:gap-8 sm:px-6 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl tracking-tight sm:text-3xl">
          自動編集の学習・正解動画
        </h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          「正解動画」(バズった/完成度の高い参考動画)を登録すると、自動編集
          (/create/auto-edit)でfew-shot例として使われ、演出・ナレーション・効果音の
          提案精度が上がります。元になった「学習動画」(生素材)も任意で一緒に保管できます。
          開発者用のページです。
        </p>
      </div>

      <EditExamplesManager initialExamples={examples} />
    </main>
  );
}
