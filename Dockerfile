# Next.js の "output: standalone" は使わない。@remotion/bundler と
# @remotion/renderer はプラットフォーム別ネイティブバイナリを __dirname 基準の
# 動的requireで解決しており(next.config.ts参照)、standaloneのファイルトレースでは
# 正しく検出できずランタイムでENOENTになる恐れがあるため、node_modules全体を
# そのまま含めるシンプルな構成にしている。
FROM node:22-bookworm-slim

# RemotionがダウンロードするヘッドレスChrome(chrome-headless-shell)の実行に
# 必要な共有ライブラリを揃えるため、chromium パッケージを依存関係の供給源として
# インストールする(chromium自体は起動しない。Remotion同梱の実行バイナリを使う)。
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# ビルド時にヘッドレスChromeを取得しイメージに焼き込む。
# (実行時の初回レンダーで毎回ダウンロードが走るのを防ぐ)
RUN npx remotion browser ensure

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["sh", "-c", "npx next start -H 0.0.0.0 -p ${PORT:-3000}"]
