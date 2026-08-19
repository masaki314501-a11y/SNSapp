import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-lg flex-col items-center gap-6 px-8 py-24 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          縦型ショート動画 自動編集システム
        </h1>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          フック(0-3秒)→本題(3-20秒、クリップ2〜4個)→CTA(20-25秒)の
          9:16縦型テンプレートで構成されるRemotionコンポジションです。
        </p>
        <div className="flex gap-3">
          <Link
            href="/create"
            className="flex h-12 items-center justify-center rounded-full bg-foreground px-6 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            動画を作成する
          </Link>
          <Link
            href="/preview"
            className="flex h-12 items-center justify-center rounded-full border border-black/[.08] px-6 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
          >
            サンプルプレビュー
          </Link>
        </div>
      </main>
    </div>
  );
}
