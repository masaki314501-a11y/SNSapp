import Link from "next/link";

const STEPS = [
  { label: "動画をアップロード", detail: "カット済みの動画を1本、自動で区切りを分割" },
  { label: "タイトル/キーワード", detail: "クリップごとの内容メモも入力可(任意)" },
  { label: "AIがテロップを自動生成", detail: "フック→本題→CTAで構成を組み立て" },
  { label: "テーマを選んで書き出し", detail: "配色・テロップの見た目をワンクリックで選択" },
];

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-24">
      <main className="flex w-full max-w-xl flex-col items-center gap-10 text-center">
        <span className="badge-pill neutral">Powered by Gemini API</span>

        <div className="flex flex-col gap-4">
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
            縦型ショート動画
            <br />
            自動編集システム
          </h1>
          <p className="mx-auto max-w-md text-sm leading-6" style={{ color: "var(--muted)" }}>
            フック(0-3秒)→本題(3-20秒)→CTA(20-25秒)。
            動画とタイトルを入れるだけで、AIが9:16縦型ショート動画を組み立てます。
          </p>
        </div>

        <Link href="/create" className="btn-primary flex h-12 items-center justify-center px-7 text-sm">
          動画を作成する
        </Link>

        <ol className="panel grid w-full grid-cols-1 divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0" style={{ borderColor: "var(--border)" }}>
          {STEPS.map((step, index) => (
            <li key={step.label} className="flex items-start gap-3 p-4" style={{ borderColor: "var(--border)" }}>
              <span className="step-badge">{index + 1}</span>
              <div className="flex flex-col text-left">
                <span className="text-sm font-semibold">{step.label}</span>
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
