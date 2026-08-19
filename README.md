# SNSapp

縦型ショート動画(9:16)自動編集システムのMVP。Next.js + [Remotion](https://www.remotion.dev/) で、
フック(0-3秒) → 本題(3-20秒、クリップ2〜4個) → CTA(20-25秒) のテンプレートに沿って
動画を自動生成する。

## Remotion コンポジション

- 定義: `remotion/compositions/ShortVideo/`
  - `schema.ts` — 入力プロパティのzodスキーマ(フック文言・クリップ配列・CTA文言・テーマ色)
  - `ShortVideo.tsx` — フック/本題(クリップ連結)/CTAを`<Series>`でつなぐルートコンポーネント
  - `duration.ts` — クリップ尺の合計から動画全体の尺(フレーム数)を算出する共通ロジック
  - `font.ts` — ヘッドレスレンダリング環境でも日本語が文字化けしないようNoto Sans JPを明示バンドル
- Studioで確認: `npm run remotion:studio`
- レンダリング: `npm run remotion:render`(`out/short-video.mp4`に出力)
- 実素材を使う場合は `public/videos/` に動画を置き、各クリップの`src`に
  `staticFile("videos/xxx.mp4")` を指定する(未指定時はプレースホルダー背景で代替表示)

## Next.js側プレビュー

`npm run dev` 後、`http://localhost:3000/preview` で `@remotion/player` によるブラウザプレビューを確認できる。

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
