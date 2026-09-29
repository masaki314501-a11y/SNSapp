# Next.js の "output: standalone" は使わない。@remotion/bundler と
# @remotion/renderer はプラットフォーム別ネイティブバイナリを __dirname 基準の
# 動的requireで解決しており(next.config.ts参照)、standaloneのファイルトレースでは
# 正しく検出できずランタイムでENOENTになる恐れがあるため、node_modules全体を
# そのまま含めるシンプルな構成にしている。
#
# 組み立て用と実行用の2段に分けている。1段だとTypeScript・ESLintなど開発用の道具や
# ビルドキャッシュまで本番に残り、イメージが約4.8GBになってRenderの無料枠(5GB)を
# アップロード動画と合わせて使い切り、サービスが止められたため。
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build \
    && rm -rf .next/cache \
    && npm prune --omit=dev

FROM node:22-bookworm-slim

# 以前はサーバーで書き出すためにChromium(約700MB)・ヘッドレスChrome・Remotionバンドルを
# 入れていたが、書き出しはブラウザ内に移し(README「6. 書き出し」)画面から使わなくなったので
# 本番には入れない。/api/render はローカル(npm run dev)でだけ使える。
WORKDIR /app

COPY --from=builder /app/package.json /app/next.config.ts ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/data ./data

ENV NODE_ENV=production
EXPOSE 3000

# npx経由だとnpm自体のプロセス(約75MB)がメモリに残るので、nextを直接起動する
CMD ["sh", "-c", "node node_modules/next/dist/bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]
