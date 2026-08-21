import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @remotion/renderer, @remotion/bundler はプラットフォーム別ネイティブバイナリを
  // __dirname 基準の動的requireで解決するため、バンドラーの静的解析対象から除外し
  // Node実行時解決に任せる(でないとバイナリパスが壊れてENOENTになる)
  serverExternalPackages: ["@remotion/bundler", "@remotion/renderer"],
};

export default nextConfig;
