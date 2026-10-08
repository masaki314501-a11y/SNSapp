<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 共通ルール(Claude Code・Claude Code Chat・Gemini Code Assist で共有)

- 返答・コミットメッセージ・PRの説明は日本語で書く。
- アプリの仕様と画面の流れは `README.md`、全体の仕組みは `docs/system-overview.md` を先に読む。
- 秘密の値(`GEMINI_API_KEY` など)は `.env.local` に置き、コミットしない。項目の一覧は `.env.local.example`。
