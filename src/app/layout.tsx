import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

/**
 * 画面の文字。デジタル庁デザインシステムの指定どおりNoto Sans JP(本文400・見出しや強調700)。
 * テロップ用に同梱している書体(public/fonts)を使い、Googleから別に読み込まない。
 */
const notoSansJp = localFont({
  variable: "--font-noto-sans-jp",
  src: [
    { path: "../../public/fonts/noto-sans-jp/noto-sans-jp-japanese-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/noto-sans-jp/noto-sans-jp-japanese-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  fallback: ["Hiragino Sans", "Hiragino Kaku Gothic ProN", "Meiryo", "sans-serif"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Clipcraft | 縦型ショート動画エディター",
  description:
    "動画をアップロードして字幕を自動生成、タイムラインでトリム・並べ替え・SE/BGM追加までできる縦型ショート動画編集ツール",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ja"
      className={`${notoSansJp.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
