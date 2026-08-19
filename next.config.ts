import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @remotion/renderer, @remotion/bundler はプラットフォーム別ネイティブバイナリを
  // 動的requireで解決するため、バンドラーの静的解析対象から除外しNode実行時解決に任せる
  serverExternalPackages: ["@remotion/bundler", "@remotion/renderer"],
};

export default nextConfig;
