import Link from "next/link";

const STEPS = [
  {
    label: "動画をアップロード",
    detail: "動画を1本アップロード(長さは自動検出)",
    color: "var(--accent-soft)",
  },
  {
    label: "使う範囲をカット",
    detail: "不要な部分を分割・削除して、使う範囲だけに絞り込む",
    color: "var(--accent-2-soft)",
  },
  {
    label: "見た目をきめる(任意)",
    detail: "参考画像/動画から配色・フォント・テロップ位置・演出をまとめて抽出",
    color: "var(--accent-3-soft)",
  },
  {
    label: "字幕を自動生成",
    detail: "発話の区切りごとに漏れなくテロップ化、待つだけでOK",
    color: "var(--accent-4-soft)",
  },
  {
    label: "編集して書き出し",
    detail: "タイムラインでトリム・並べ替え・SE/BGM/AIナレーション追加して書き出し",
    color: "var(--accent-soft)",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16 sm:px-6 sm:py-24">
      <main className="flex w-full max-w-xl flex-col items-center gap-8 text-center sm:gap-10">
        <div className="flex flex-col gap-4">
          <h1
            className="font-display text-3xl leading-tight tracking-tight sm:text-5xl"
            style={{ color: "var(--foreground)" }}
          >
            縦型ショート動画を
            <br />
            <span
              style={{
                background: "var(--accent-soft)",
                boxShadow: "inset 0 -0.35em 0 var(--accent-soft)",
                borderBottom: "3px solid var(--accent)",
              }}
            >
              サクッと編集
            </span>
          </h1>
          <p className="mx-auto max-w-md text-sm leading-6" style={{ color: "var(--muted)" }}>
            動画をアップロードするだけでAIが字幕を自動生成。あとはタイムラインで
            トリム・並べ替え・見た目調整をして、そのまま書き出せます。
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/create"
            className="btn-primary flex h-12 items-center justify-center px-7 text-sm"
          >
            動画を作成する →
          </Link>
          <Link
            href="/dev/edit-examples"
            className="btn-outline flex h-12 items-center justify-center px-7 text-sm"
          >
            学習・正解動画をアップロード(開発者用)
          </Link>
        </div>

        <ol className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
          {STEPS.map((step, index) => (
            <li
              key={step.label}
              className="panel-flat flex items-start gap-3 p-4 text-left"
              style={{ background: step.color, cursor: "default" }}
            >
              <span className="step-badge" style={{ background: "var(--background)" }}>
                {index + 1}
              </span>
              <div className="flex flex-col text-left">
                <span className="text-sm font-bold">{step.label}</span>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {step.detail}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}
