import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { GeminiApiKeySettings } from "@/components/settings/GeminiApiKeySettings";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {children}
        <GeminiApiKeySettings />
      </body>
    </html>
  );
}
