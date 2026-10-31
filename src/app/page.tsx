import Link from "next/link";

/** 使い方マニュアル(Claude Docs)。変更した時は .env の NEXT_PUBLIC_MANUAL_URL で差し替えられる。 */
const MANUAL_URL = process.env.NEXT_PUBLIC_MANUAL_URL || "https://claude.ai/artifact/JCJdkxuFbogkZwxVqJVfvJ";

const STEPS = [
  {
    label: "動画を選ぶ",
    detail: "縦長で撮った動画を1本選ぶ",
    color: "var(--accent-soft)",
  },
  {
    label: "使う範囲を選ぶ",
    detail: "前置きや撮り直しなど、使わない所を切る(全部使うなら何もしない)",
    color: "var(--accent-2-soft)",
  },
  {
    label: "見た目の手本を選ぶ(なくてもよい)",
    detail: "まねしたい投稿のスクショや動画を渡すと、その雰囲気に寄せる",
    color: "var(--accent-3-soft)",
  },
  {
    label: "AIで自動編集",
    detail: "切り方・タイトル・文字・画像・寄り・効果音まで、2〜4分でまとめて編集",
    color: "var(--accent-4-soft)",
  },
  {
    label: "強調する字幕を選ぶ(なくてもよい)",
    detail: "目立たせたい字幕をタップすると、帯・色・効果音が付く",
    color: "var(--accent-soft)",
  },
  {
    label: "編集画面で手直し(なくてもよい)",
    detail: "気になる所だけ直す。文章で「AIに頼む」こともできる",
    color: "var(--accent-2-soft)",
  },
  {
    label: "書き出して保存",
    detail: "動画ファイルにして保存。表紙(サムネイル)も作れる",
    color: "var(--accent-3-soft)",
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
            動画を選ぶだけで、AIが字幕・文字・効果音・寄りまで入れて編集します。
            気になる所だけ直して、そのまま書き出せます。
          </p>
        </div>

        <div className="flex w-full flex-col items-center gap-2">
          <Link
            href="/create"
            className="btn-primary flex h-12 w-full max-w-xs items-center justify-center px-7 text-base"
          >
            動画を作成する →
          </Link>
          <a
            href={MANUAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-outline flex h-11 w-full max-w-xs items-center justify-center px-7 text-sm"
          >
            使い方マニュアルを見る
          </a>
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
