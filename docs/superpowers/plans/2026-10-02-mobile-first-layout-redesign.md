# スマホ基本の画面レイアウト刷新 実装手順書

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** スマホで折り返し・横スクロール・縦スクロールに困らない「アプリ型」の画面にし、タブレット・PCでも使いやすい配置にする。

**Architecture:** 色と共通部品(`globals.css`)を差し替えて全画面の見た目を一括で変える。編集・カット画面は、CSS Gridの領域名(grid-template-areas)を画面幅ごとに切り替える1つのDOMで、スマホ/タブレット縦/横・PCの配置を作る。見た目専用の部品(上部バー・再生バー・タブ・設定パネル・操作ボタン)を新しいファイルに切り出し、`ClipEditor`・`CutEditor`の状態管理には手を入れない。

**Tech Stack:** Next.js 16(App Router)、React 19、Tailwind CSS 4、Remotion Player、vitest

**Spec:** `docs/superpowers/specs/2026-10-02-mobile-first-layout-redesign-design.md`(モックアップ https://claude.ai/artifact/WaUJkeGRrbTaFTusf97HNi)

## Global Constraints

- 新しいライブラリ・フォント・アイコン素材は追加しない(アイコンは `src/components/icons.tsx` の自前SVG)
- 機能・画面遷移・`VideoProject`の保存形式・API・Remotionの動画構成は変えない
- ブラウザのタブ名(`layout.tsx`の`metadata.title`)は変えない
- トップ画面のタイトル(書体・改行・下線の強調)と5つの手順カードの文言は変えない
- 画面幅の区切り: 768px未満=スマホ、768〜1023px=タブレット縦、1024px以上=タブレット横・PC
- 改名する文言: 「動画カット」→「カット」、「スタイル」→「見た目」、「参考スクショ」→「見た目の手本」、「スキップして編集へ進む」→「AIを使わず自分で編集する」
- 手順表示は「ステップ N / 4」(1 動画を選ぶ / 2 使う範囲を選ぶ / 3 見た目の手本を選ぶ / 4 AIで自動編集)
- アクセント色 `#D63F20`(白文字とのコントラスト4.5:1以上)
- コード中のコメント・UI文言は日本語。既存のコメント密度に合わせる

## Review Focus

1. **トリムのドラッグ中にタイムラインの倍率が変わる**: 初期の「全体が収まる倍率」は表示時と画面幅が変わった時だけ計算し、クリップの長さが変わっても計算し直さない(Task 3でテスト観点として確認)
2. **2本指のピンチがクリップ上で始まる**: クリップのドラッグ(指1本目)と同時に起きる。ピンチの倍率変更は動くが、クリップも動いてしまう。ルーラーや空き領域でのピンチを前提にし、ヒント文言でそう案内する(Task 3)
3. **設定シートがタイムライン操作を邪魔する**: クリップを押しただけでシートを開くと、ドラッグ中にタイムラインが隠れる。シートはタブを押した時と「〜の設定を開く」ボタンでだけ開く(Task 5)
4. **iPhoneのアドレスバーの伸び縮み**: 高さは`100vh`ではなく`100dvh`を使い、下端のタブと次へボタンが隠れないようにする(Task 4)
5. **ファイル名が英数字だけで長い**: `overflow-wrap: anywhere`を外すと横にはみ出す。ファイル名を出す箇所に`.break-anywhere`を付ける(Task 1・Task 7)

---

### Task 1: 共通の色・部品・折り返しの見直し

**Files:**
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: CSSクラス `.break-anywhere`、`.flow-page`、`.flow-main`、`.flow-lead`、`.bottom-action-bar`、`.text-link`(Task 7〜9で使う)。既存クラス名(`.panel` `.btn-primary`等)はそのまま中身を変える

- [ ] **Step 1: 色の変数を差し替える**

`:root` の中身を次に置き換える(変数名は既存のまま)。

```css
:root {
  /* すっきりしたアプリ風。面は白、地は少しだけ暖かい灰色 */
  --background: #faf8f5;
  --background-elevated: #ffffff;
  --background-elevated-2: #f4f1ed;
  --foreground: #1f1b17;
  --muted: #6b635b;
  --muted-2: #7d746b;
  --border: #e8e4de;
  --border-strong: #d9d3cb;

  /* アクセントは白文字が読める濃さのコーラル。ほか3色は区別用の補助色 */
  --accent: #d63f20;
  --accent-hover: #bf3519;
  --accent-contrast: #ffffff;
  --accent-soft: #fdebe5;
  --accent-2: #0e9384;
  --accent-2-soft: #dcefea;
  --accent-3: #f2a900;
  --accent-3-soft: #fdf3d7;
  --accent-4: #2f6fed;
  --accent-4-soft: #e1e8fb;

  --success: #12b76a;
  --success-soft: #d7f5e6;
  --warning: #b98200;
  --warning-soft: #fdf3d7;
  --danger: #d1345b;
  --danger-soft: #fbdde7;

  /* 太枠+ハードシャドウはやめ、浮かせたい要素だけ柔らかい影にする(変数名は既存の参照箇所のため残す) */
  --shadow-pop: 0 1px 2px rgba(31, 27, 23, 0.06);
  --shadow-pop-sm: none;
  --shadow-pop-hover: 0 2px 8px rgba(31, 27, 23, 0.1);
  --shadow-pop-active: none;
  --shadow-sheet: 0 -6px 20px rgba(31, 27, 23, 0.12);

  --stage-background: #1f1b17;
}
```

- [ ] **Step 2: 折り返しのルールを変える**

`body` の `overflow-wrap: anywhere;` とその直前のコメントを、次に置き換える。

```css
  /*
   * 以前は overflow-wrap: anywhere で長い英数字のはみ出しを防いでいたが、要素の最小幅が1文字まで
   * 縮むため、横並びの見出しが細い列に押し込まれて1〜2文字ずつ折り返していた。全体は break-word に
   * 戻し、ファイル名など区切りの無い文字列を出す箇所だけ .break-anywhere を付ける。
   * auto-phrase は日本語を文節で折り返す指定(未対応のブラウザでは従来どおりの折り返しになる)。
   */
  overflow-wrap: break-word;
  word-break: auto-phrase;
```

`body { ... }` の直後に次を追加する。

```css
h1,
h2,
h3,
p,
li {
  text-wrap: pretty;
}

.break-anywhere {
  overflow-wrap: anywhere;
}
```

- [ ] **Step 3: 共通部品の見た目を差し替える**

`/* --- reusable component classes --- */` 以降の次のクラスの中身を置き換える(セレクタは既存のまま)。

```css
.panel {
  background: var(--background-elevated);
  border: 1px solid var(--border);
  border-radius: 14px;
}

.panel-flat {
  background: var(--background-elevated);
  border: 1px solid var(--border);
  border-radius: 14px;
}

.field-input {
  background: var(--background);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 14px;
  color: var(--foreground);
  transition: border-color 0.15s ease;
  width: 100%;
}
.field-input:focus {
  outline: none;
  border-color: var(--foreground);
}

.btn-primary {
  background: var(--accent);
  color: var(--accent-contrast);
  font-weight: 700;
  border-radius: 999px;
  border: none;
  transition: background-color 0.15s ease;
}
.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}
.btn-primary:disabled {
  background: var(--border);
  color: var(--muted-2);
  cursor: not-allowed;
}

.btn-outline {
  border: 1px solid var(--border-strong);
  color: var(--foreground);
  border-radius: 999px;
  background: var(--background-elevated);
  transition: background-color 0.15s ease;
}
.btn-outline:hover:not(:disabled) {
  background: var(--background-elevated-2);
}
.btn-outline:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.step-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.upload-drop {
  border: 1.5px dashed var(--border-strong);
  border-radius: 14px;
  background: var(--background-elevated);
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.upload-drop:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.badge-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 700;
  border: none;
}
.badge-pill.neutral {
  color: var(--muted);
  background: var(--background-elevated-2);
}
.badge-pill.success {
  color: #0b6e4a;
  background: var(--success-soft);
}
.badge-pill.warning {
  color: #6b4b00;
  background: var(--warning-soft);
}
.badge-pill.danger {
  color: #9b1c3e;
  background: var(--danger-soft);
}

input[type="file"]::file-selector-button {
  margin-right: 12px;
  padding: 8px 16px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: var(--background-elevated);
  color: var(--foreground);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
input[type="file"]::file-selector-button:hover {
  background: var(--background-elevated-2);
}

.tab-button {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 700;
  color: var(--muted);
  white-space: nowrap;
  border-radius: 999px;
  border: none;
  transition: color 0.15s ease, background-color 0.15s ease;
}
.tab-button:hover {
  color: var(--foreground);
}
.tab-button.active {
  color: var(--accent);
  background: var(--accent-soft);
}

.modal-panel {
  background: var(--background-elevated);
  border: none;
  border-radius: 16px;
  box-shadow: 0 12px 40px rgba(31, 27, 23, 0.2);
  max-width: 560px;
  width: 100%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.preset-card {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--background-elevated);
  transition: border-color 0.15s ease, background-color 0.15s ease;
  text-align: left;
}
.preset-card:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}

input[type="color"] {
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--background-elevated);
  padding: 3px;
  cursor: pointer;
}

.progress-track {
  height: 8px;
  width: 100%;
  overflow: hidden;
  border-radius: 999px;
  border: none;
  background: var(--background-elevated-2);
}
```

`.btn-primary:active`、`.btn-outline:active`、`.btn-primary:hover` の `transform`/`box-shadow` 指定は削除する(上の内容で置き換え済み)。

- [ ] **Step 4: 手順画面(スクロールするページ)用のクラスを追加する**

ファイル末尾に追加する。

```css
/* --- 手順画面(/create系・書き出し)の共通レイアウト --- */
.flow-page {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}
.flow-main {
  flex: 1;
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  padding: 20px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-sizing: border-box;
}
.flow-lead {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--muted);
}

/* 次へ進むボタンの置き場。親指が届く画面下端に固定し、横幅いっぱいのボタンを並べる */
.bottom-action-bar {
  position: sticky;
  bottom: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 16px calc(16px + env(safe-area-inset-bottom));
  background: var(--background-elevated);
  border-top: 1px solid var(--border);
}
.bottom-action-bar > .btn-primary,
.bottom-action-bar > .btn-outline {
  height: 52px;
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
@media (min-width: 768px) {
  .bottom-action-bar {
    align-items: center;
  }
  .bottom-action-bar > .btn-primary,
  .bottom-action-bar > .btn-outline {
    width: 100%;
    max-width: 608px;
  }
}

.text-link {
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--muted);
  text-decoration: none;
}
.text-link:hover {
  color: var(--accent);
}
```

- [ ] **Step 5: 型・lintが通ることを確認する**

Run: `npx tsc --noEmit; npm run lint`
Expected: エラー0件(CSSのみの変更なので既存と同じ結果)

- [ ] **Step 6: コミット**

```bash
git add src/app/globals.css
git commit -m "全体の色・ボタン・パネルをすっきりした見た目にし、文言の折り返し方を見直す"
```

---

### Task 2: アイコンと上部バー・操作ボタンの共通部品

**Files:**
- Modify: `src/components/icons.tsx`
- Create: `src/components/AppTopBar.tsx`
- Create: `src/components/editor/ToolButtons.tsx`
- Modify: `src/app/globals.css`(末尾に追記)

**Interfaces:**
- Produces:
  - `icons.tsx`: `IconProps` を export。`BackIcon` `MoreIcon` `SparkleIcon` `PlayIcon` `PauseIcon` `UndoIcon` `RedoIcon` `ScissorsIcon` `TrimStartIcon` `TrimEndIcon` `PlusIcon` `TrashIcon` `CaptionIcon` `SpeakerIcon` `MusicIcon` `PaletteIcon` `SettingsIcon` `UploadIcon` `InfoIcon` `ChevronRightIcon`(すべて `React.FC<IconProps>`)
  - `AppTopBar`: `({ backHref: string; backLabel?: string; title: string; step?: { current: number; total: number }; actions?: React.ReactNode; className?: string }) => JSX`
  - `ToolButtons`: `type ToolItem = { key: string; label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean; shortcut?: string; danger?: boolean }`、`ToolGrid({ items, className })`、`ToolInline({ items, className })`

- [ ] **Step 1: アイコンを追加する**

`icons.tsx` の `type IconProps` を `export type IconProps` に変え、`MicIcon` の後に追加する。

```tsx
const Svg: React.FC<IconProps & { children: React.ReactNode; filled?: boolean }> = ({
  size = 20,
  className,
  children,
  filled,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    aria-hidden="true"
    {...(filled ? { fill: "currentColor" } : base)}
  >
    {children}
  </svg>
);

export const BackIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M15 18l-6-6 6-6" />
  </Svg>
);
export const ChevronRightIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);
export const MoreIcon: React.FC<IconProps> = (p) => (
  <Svg {...p} filled>
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </Svg>
);
export const SparkleIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
  </Svg>
);
export const PlayIcon: React.FC<IconProps> = (p) => (
  <Svg {...p} filled>
    <polygon points="7 4 20 12 7 20" />
  </Svg>
);
export const PauseIcon: React.FC<IconProps> = (p) => (
  <Svg {...p} filled>
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </Svg>
);
export const UndoIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
  </Svg>
);
export const RedoIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 000 11H13" />
  </Svg>
);
export const ScissorsIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M20 4L8.12 15.88" />
    <path d="M14.47 14.48L20 20" />
    <path d="M8.12 8.12L12 12" />
  </Svg>
);
export const TrimStartIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M6 4v16" />
    <path d="M10 12h10" />
    <path d="M16 8l4 4-4 4" />
  </Svg>
);
export const TrimEndIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M18 4v16" />
    <path d="M14 12H4" />
    <path d="M8 8l-4 4 4 4" />
  </Svg>
);
export const PlusIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Svg>
);
export const TrashIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="M6 7l1 13h10l1-13" />
  </Svg>
);
export const CaptionIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M7 11h10" />
    <path d="M7 15h6" />
  </Svg>
);
export const SpeakerIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M11 5L6 9H3v6h3l5 4z" />
    <path d="M15.5 8.5a5 5 0 010 7" />
    <path d="M18.5 5.5a9 9 0 010 13" />
  </Svg>
);
export const MusicIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M9 18V5l11-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="17" cy="16" r="3" />
  </Svg>
);
export const PaletteIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="8.5" cy="10" r="1.2" />
    <circle cx="12" cy="7.5" r="1.2" />
    <circle cx="15.5" cy="10" r="1.2" />
    <path d="M12 21a3 3 0 010-6h3" />
  </Svg>
);
export const SettingsIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M4 6h10" />
    <path d="M18 6h2" />
    <circle cx="16" cy="6" r="2" />
    <path d="M4 12h2" />
    <path d="M10 12h10" />
    <circle cx="8" cy="12" r="2" />
    <path d="M4 18h10" />
    <path d="M18 18h2" />
    <circle cx="16" cy="18" r="2" />
  </Svg>
);
export const UploadIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M12 16V4" />
    <path d="M7 9l5-5 5 5" />
    <path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
  </Svg>
);
export const InfoIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5" />
    <path d="M12 16.5v.01" />
  </Svg>
);
```

- [ ] **Step 2: 上部バー部品を作る**

`src/components/AppTopBar.tsx`:

```tsx
import Link from "next/link";
import { BackIcon } from "./icons";

type AppTopBarProps = {
  backHref: string;
  backLabel?: string;
  title: string;
  /** 作成手順の画面だけ渡す。「ステップ N / 4」と進み具合のバーを出す。 */
  step?: { current: number; total: number };
  /** 右側に並べるボタン類。 */
  actions?: React.ReactNode;
  className?: string;
};

/**
 * 全画面共通の上部バー。以前は画面ごとに大きな見出し+説明文を置いていたが、スマホでは
 * それだけで画面の上1/4を使っていたため、戻る・画面名・操作を1行にまとめる。
 */
export const AppTopBar: React.FC<AppTopBarProps> = ({ backHref, backLabel = "戻る", title, step, actions, className }) => (
  <header className={`app-topbar${className ? ` ${className}` : ""}`}>
    <div className="app-topbar-row">
      <Link href={backHref} aria-label={backLabel} className="app-topbar-back">
        <BackIcon size={22} />
      </Link>
      <div className="app-topbar-title">
        {step ? (
          <span className="app-topbar-step">
            ステップ {step.current} / {step.total}
          </span>
        ) : null}
        <h1>{title}</h1>
      </div>
      {actions ? <div className="app-topbar-actions">{actions}</div> : null}
    </div>
    {step ? (
      <div className="app-topbar-progress" aria-hidden="true">
        {Array.from({ length: step.total }, (_, i) => (
          <span key={i} className={i < step.current ? "done" : undefined} />
        ))}
      </div>
    ) : null}
  </header>
);
```

- [ ] **Step 3: 操作ボタン部品を作る**

`src/components/editor/ToolButtons.tsx`:

```tsx
export type ToolItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** PCで添えるキーボードの割り当て(例: "S")。 */
  shortcut?: string;
  danger?: boolean;
};

/** スマホ・タブレット縦向き用。アイコン+短い文言のボタンを等分で1行に並べる。 */
export const ToolGrid: React.FC<{ items: ToolItem[]; className?: string }> = ({ items, className }) => (
  <div
    className={`tool-grid${className ? ` ${className}` : ""}`}
    style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
  >
    {items.map((item) => (
      <button
        key={item.key}
        type="button"
        className={`tool-grid-btn${item.danger ? " danger" : ""}`}
        onClick={item.onClick}
        disabled={item.disabled}
      >
        {item.icon}
        <span>{item.label}</span>
      </button>
    ))}
  </div>
);

/** タブレット横向き・PC用。再生バーの中に横一列で並べ、キーボードの割り当てを小さく添える。 */
export const ToolInline: React.FC<{ items: ToolItem[]; className?: string }> = ({ items, className }) => (
  <div className={`tool-inline${className ? ` ${className}` : ""}`}>
    {items.map((item) => (
      <button
        key={item.key}
        type="button"
        className={`tool-inline-btn${item.danger ? " danger" : ""}`}
        onClick={item.onClick}
        disabled={item.disabled}
      >
        {item.icon}
        <span>{item.label}</span>
        {item.shortcut ? <kbd className="keyboard-hint">{item.shortcut}</kbd> : null}
      </button>
    ))}
  </div>
);
```

- [ ] **Step 4: 上部バー・操作ボタンのCSSを追加する**

`globals.css` の末尾に追加する。

```css
/* --- 上部バー(AppTopBar.tsx) --- */
.app-topbar {
  background: var(--background-elevated);
  border-bottom: 1px solid var(--border);
}
.app-topbar-row {
  height: 52px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px 0 2px;
}
.app-topbar-back {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--foreground);
}
.app-topbar-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.app-topbar-title h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.app-topbar-step {
  font-size: 11px;
  color: var(--muted);
}
.app-topbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.app-topbar-progress {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: 4px;
  padding: 0 16px 10px;
}
.app-topbar-progress span {
  height: 4px;
  border-radius: 2px;
  background: var(--border);
}
.app-topbar-progress span.done {
  background: var(--accent);
}
.topbar-icon-btn {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: var(--muted);
}
.topbar-icon-btn:hover:not(:disabled) {
  background: var(--background-elevated-2);
}
.topbar-icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.topbar-pill {
  height: 36px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--background-elevated);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
}
.topbar-pill svg {
  color: var(--accent);
}
.topbar-pill.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.topbar-cta {
  height: 36px;
  padding: 0 16px;
  font-size: 14px;
  white-space: nowrap;
}
.topbar-text-btn {
  height: 36px;
  padding: 0 8px;
  font-size: 13px;
  color: var(--muted);
  white-space: nowrap;
}
.topbar-text-btn:hover {
  color: var(--foreground);
}

/* --- 操作ボタン(ToolButtons.tsx) --- */
.tool-grid {
  display: grid;
  gap: 8px;
  padding: 8px 12px;
  background: var(--background-elevated);
  border-top: 1px solid var(--border);
}
.tool-grid-btn {
  height: 56px;
  min-width: 0;
  border-radius: 10px;
  background: var(--background-elevated-2);
  color: var(--foreground);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 11px;
  line-height: 1.2;
}
.tool-grid-btn span {
  white-space: nowrap;
}
.tool-grid-btn:disabled,
.tool-inline-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.tool-grid-btn.danger,
.tool-inline-btn.danger {
  color: var(--danger);
}
.tool-inline {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tool-inline-btn {
  height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  background: var(--background-elevated-2);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  white-space: nowrap;
}
.tool-inline-btn kbd {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted);
}
```

- [ ] **Step 5: 型・lintの確認**

Run: `npx tsc --noEmit; npm run lint`
Expected: エラー0件

- [ ] **Step 6: コミット**

```bash
git add src/components/icons.tsx src/components/AppTopBar.tsx src/components/editor/ToolButtons.tsx src/app/globals.css
git commit -m "画面共通の上部バー・操作ボタン・アイコンを追加"
```

---

### Task 3: タイムラインを画面幅に収め、ピンチで拡大できるようにする

**Files:**
- Modify: `src/components/editor/timeline/timelineScale.ts`
- Create: `src/components/editor/timeline/timelineScale.test.ts`
- Modify: `src/components/editor/timeline/TimelineRoot.tsx`
- Modify: `src/components/editor/editor-theme.css`

**Interfaces:**
- Produces:
  - `fitPixelsPerSecond(visibleWidthPx: number, totalDurationSeconds: number): number`
  - `pinchPixelsPerSecond(startPixelsPerSecond: number, startDistancePx: number, currentDistancePx: number): number`
  - `MIN_PIXELS_PER_SECOND` を 12 → 1 に変更
  - `TimelineRoot` のpropsから削除: `canUndo` `canRedo` `onUndo` `onRedo` `canAddSegment` `onAddSegment` `selectedCount` `onDeleteSelected` `canSplitAtPlayhead` `onSplitAtPlayhead` `onTrimStartToPlayhead` `onTrimEndToPlayhead` `showCutTools`(操作ボタンは Task 5・6 で `ToolGrid`/`ToolInline` に移す)

- [ ] **Step 1: 失敗するテストを書く**

`src/components/editor/timeline/timelineScale.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PIXELS_PER_SECOND,
  MAX_PIXELS_PER_SECOND,
  MIN_PIXELS_PER_SECOND,
  fitPixelsPerSecond,
  pinchPixelsPerSecond,
} from "./timelineScale";

describe("fitPixelsPerSecond", () => {
  it("動画全体が見える幅にちょうど収まる倍率を返す", () => {
    // スマホ幅390pxからトラック名の列などを除いた328pxに、79.6秒の動画を収める
    expect(fitPixelsPerSecond(328, 79.6)).toBeCloseTo(328 / 79.6);
  });

  it("幅や長さがまだ分からないときは既定の倍率にする", () => {
    expect(fitPixelsPerSecond(0, 80)).toBe(DEFAULT_PIXELS_PER_SECOND);
    expect(fitPixelsPerSecond(328, 0)).toBe(DEFAULT_PIXELS_PER_SECOND);
  });

  it("ごく短い動画は最大倍率で止める", () => {
    expect(fitPixelsPerSecond(1000, 1)).toBe(MAX_PIXELS_PER_SECOND);
  });

  it("1時間の動画でも最小倍率より小さくしない", () => {
    expect(fitPixelsPerSecond(300, 3600)).toBe(MIN_PIXELS_PER_SECOND);
  });
});

describe("pinchPixelsPerSecond", () => {
  it("指の間隔が2倍になれば倍率も2倍になる", () => {
    expect(pinchPixelsPerSecond(10, 100, 200)).toBe(20);
  });

  it("縮めれば倍率も下がる", () => {
    expect(pinchPixelsPerSecond(10, 200, 100)).toBe(5);
  });

  it("上限・下限を超えない", () => {
    expect(pinchPixelsPerSecond(200, 10, 1000)).toBe(MAX_PIXELS_PER_SECOND);
    expect(pinchPixelsPerSecond(2, 1000, 10)).toBe(MIN_PIXELS_PER_SECOND);
  });

  it("指の間隔が0のときは開始時の倍率のまま", () => {
    expect(pinchPixelsPerSecond(10, 0, 100)).toBe(10);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/components/editor/timeline/timelineScale.test.ts`
Expected: FAIL(`fitPixelsPerSecond` が export されていない)

- [ ] **Step 3: 計算を実装する**

`timelineScale.ts` の `MIN_PIXELS_PER_SECOND` を変更し、`clampPixelsPerSecond` の後に追加する。

```ts
// 長い動画でも最初は全体を画面幅に収めたいため、1秒あたり1pxまで縮められるようにする。
export const MIN_PIXELS_PER_SECOND = 1;
```

```ts
/**
 * タイムラインの見える幅(トラック名の列を除く)に、動画全体がちょうど収まる倍率。
 * スマホで最初から全体を見渡せるようにするための初期値で、拡大は利用者に任せる。
 */
export const fitPixelsPerSecond = (visibleWidthPx: number, totalDurationSeconds: number): number => {
  if (visibleWidthPx <= 0 || totalDurationSeconds <= 0) return DEFAULT_PIXELS_PER_SECOND;
  return clampPixelsPerSecond(visibleWidthPx / totalDurationSeconds);
};

/** 2本指の間隔の変化に合わせた倍率(つまみ始めた時の間隔に対する比率で拡大縮小する)。 */
export const pinchPixelsPerSecond = (
  startPixelsPerSecond: number,
  startDistancePx: number,
  currentDistancePx: number
): number => {
  if (startDistancePx <= 0 || currentDistancePx <= 0) return clampPixelsPerSecond(startPixelsPerSecond);
  return clampPixelsPerSecond(startPixelsPerSecond * (currentDistancePx / startDistancePx));
};
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/components/editor/timeline/timelineScale.test.ts`
Expected: PASS(8件)

- [ ] **Step 5: TimelineRoot から操作ボタンを外し、初期倍率とピンチを入れる**

`TimelineRoot.tsx` の変更点:

1. importを差し替える。

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectBgm, ProjectSegment, ProjectSfxClip } from "@/lib/videoProject";
import { beginPointerDrag } from "./pointerDrag";
import {
  DEFAULT_PIXELS_PER_SECOND,
  MAX_PIXELS_PER_SECOND,
  MIN_PIXELS_PER_SECOND,
  clampPixelsPerSecond,
  fitPixelsPerSecond,
  formatTimecode,
  pickRulerStepSeconds,
  pinchPixelsPerSecond,
  pixelsToSeconds,
  secondsToPixels,
} from "./timelineScale";
```

2. `TimelineRootProps` から上記「削除」のpropsを消し、分割代入からも消す。`canTrimAtPlayhead` の行も削除する。

3. `const [pixelsPerSecond, setPixelsPerSecond] = useState(...)` の直後に追加する。

```tsx
  // 最初は動画全体が見える幅に収める。利用者が拡大縮小した後は、その倍率を尊重して勝手に戻さない。
  // 長さが変わるたびに合わせ直すと、トリムのドラッグ中にクリップが指から逃げるため、
  // 合わせ直すのは表示した時と画面幅が変わった時だけにする。
  const userZoomedRef = useRef(false);
  const durationRef = useRef(totalDurationSeconds);
  durationRef.current = totalDurationSeconds;

  const fitToWidth = () => {
    const el = scrollRef.current;
    if (!el) return;
    const labelWidth = el.querySelector<HTMLElement>(".editor-track-label")?.offsetWidth ?? 0;
    setPixelsPerSecond(fitPixelsPerSecond(el.clientWidth - labelWidth, durationRef.current));
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleResize = () => {
      if (!userZoomedRef.current) fitToWidth();
    };
    handleResize();
    const observer = new ResizeObserver(handleResize);
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 表示時と幅の変化時だけ合わせる(理由は上のコメント)
  }, []);

  const zoomTo = (next: number) => {
    userZoomedRef.current = true;
    setPixelsPerSecond(clampPixelsPerSecond(next));
  };

  const showWholeTimeline = () => {
    userZoomedRef.current = false;
    fitToWidth();
  };

  // 2本指のピンチで拡大縮小する。指の位置は子要素(クリップ等)に届いたイベントも含めて
  // 捕捉段階で拾う(クリップ側がsetPointerCaptureしていても、親には伝わってくる)。
  const touchPointsRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ startDistance: number; startPixelsPerSecond: number } | null>(null);
  const pointDistance = () => {
    const [a, b] = [...touchPointsRef.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const handleTouchPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    touchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPointsRef.current.size === 2) {
      pinchRef.current = { startDistance: pointDistance(), startPixelsPerSecond: pixelsPerSecond };
    }
  };
  const handleTouchPointerMove = (e: React.PointerEvent) => {
    if (!touchPointsRef.current.has(e.pointerId)) return;
    touchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pinch = pinchRef.current;
    if (pinch && touchPointsRef.current.size === 2) {
      zoomTo(pinchPixelsPerSecond(pinch.startPixelsPerSecond, pinch.startDistance, pointDistance()));
    }
  };
  const handleTouchPointerEnd = (e: React.PointerEvent) => {
    touchPointsRef.current.delete(e.pointerId);
    if (touchPointsRef.current.size < 2) pinchRef.current = null;
  };
```

4. `return (...)` の中で、`<div className="editor-timeline-toolbar">...</div>` を丸ごと削除し、
   `<div className="editor-timeline-scroll" ref={scrollRef}>` を次に置き換える。

```tsx
      <div
        className="editor-timeline-scroll"
        ref={scrollRef}
        onPointerDownCapture={handleTouchPointerDown}
        onPointerMoveCapture={handleTouchPointerMove}
        onPointerUpCapture={handleTouchPointerEnd}
        onPointerCancelCapture={handleTouchPointerEnd}
      >
```

5. `editor-timeline-scroll` の閉じタグの後(`editor-timeline-wrap` の閉じタグの前)に拡大縮小の行を追加する。

```tsx
      <div className="editor-timeline-zoom">
        <span className="editor-timeline-zoom-hint">2本の指で広げると拡大</span>
        <button type="button" className="editor-zoom-btn" onClick={showWholeTimeline}>
          全体
        </button>
        <button
          type="button"
          className="editor-zoom-btn"
          aria-label="縮小"
          onClick={() => zoomTo(pixelsPerSecond / 1.4)}
        >
          −
        </button>
        <input
          type="range"
          className="editor-zoom-range"
          aria-label="拡大率"
          min={MIN_PIXELS_PER_SECOND}
          max={MAX_PIXELS_PER_SECOND}
          value={pixelsPerSecond}
          onChange={(e) => zoomTo(Number(e.target.value))}
        />
        <button
          type="button"
          className="editor-zoom-btn"
          aria-label="拡大"
          onClick={() => zoomTo(pixelsPerSecond * 1.4)}
        >
          ＋
        </button>
      </div>
```

`formatTimecode` はルーラーの目盛りで引き続き使う。`DEFAULT_PIXELS_PER_SECOND` は `useState` の初期値で使う。

- [ ] **Step 6: タイムラインのCSSを差し替える**

`editor-theme.css` の変更点:

1. `.editor-timeline-wrap` を次に置き換える。

```css
.editor-timeline-wrap {
  display: flex;
  flex-direction: column;
  background: var(--background-elevated);
}
```

2. `.editor-timeline-toolbar`、`.editor-toolbar-hint`、`.editor-timeline-spacer`、`.editor-timecode`、`.editor-zoom-control`、`.editor-zoom-control input[type="range"]` を削除し、代わりに追加する。

```css
.editor-timeline-zoom {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  padding: 4px 12px 8px;
}
.editor-timeline-zoom-hint {
  margin-right: auto;
  font-size: 11px;
  color: var(--muted-2);
}
.editor-zoom-btn {
  min-width: 28px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--background-elevated);
  color: var(--muted);
  font-size: 12px;
}
.editor-zoom-range {
  display: none;
  width: 100px;
  accent-color: var(--accent);
}
@media (min-width: 1024px) {
  .editor-zoom-range {
    display: block;
  }
}
/* マウス操作の端末ではピンチの案内は不要 */
@media (hover: hover) and (pointer: fine) {
  .editor-timeline-zoom-hint {
    display: none;
  }
}
```

3. `.editor-timeline-scroll` に `touch-action: pan-x;` を追加する(ページ全体の拡大ではなく、こちらのピンチ処理に指の動きを渡すため)。

4. `.editor-ruler` の `background` を `var(--background)` に、`.editor-ruler-tick` の `border-left` を `1px solid var(--border)` に変える。

5. トラック名の列と映像レーンをスマホで狭く・低くする。`.editor-track-label` の `width: 64px;` を `width: var(--track-label-width);` にし、`.editor-track-video .editor-lane` の `height: 76px;` を `height: var(--video-lane-height);` にして、ファイル先頭の「レイアウト」節の前に追加する。

```css
:root {
  --track-label-width: 36px;
  --video-lane-height: 56px;
}
@media (min-width: 1024px) {
  :root {
    --track-label-width: 64px;
    --video-lane-height: 64px;
  }
}
```

6. `.editor-clip-block.video` の `border-color: var(--foreground);` を `border-color: var(--border-strong);` に変える。

- [ ] **Step 7: 型チェックで呼び出し側の修正箇所を確認する**

Run: `npx tsc --noEmit`
Expected: `ClipEditor.tsx` と `CutEditor.tsx` の `<TimelineRoot>` で、削除したprops(`canUndo`等)が「存在しない」というエラー。Task 5・6で直すため、ここではエラー箇所だけ確認する。

- [ ] **Step 8: テストを実行してコミット**

Run: `npm test`
Expected: PASS(既存のテストと新規の8件)

```bash
git add src/components/editor/timeline/timelineScale.ts src/components/editor/timeline/timelineScale.test.ts src/components/editor/timeline/TimelineRoot.tsx src/components/editor/editor-theme.css
git commit -m "タイムラインを最初から動画全体が画面幅に収まる表示にし、2本指で拡大できるようにする"
```

(この時点では `ClipEditor`/`CutEditor` が型エラーのまま。Task 5・6で解消する。)

---

### Task 4: 編集・カット画面の土台(配置・再生バー・タブ・設定パネル)

**Files:**
- Create: `src/components/editor/PlaybackBar.tsx`
- Create: `src/components/editor/EditorTabBar.tsx`
- Create: `src/components/editor/SettingsPanel.tsx`
- Create: `src/components/editor/EditorMenu.tsx`
- Modify: `src/components/editor/editor-theme.css`

**Interfaces:**
- Consumes: `icons.tsx`(Task 2)、`formatTimecode`(既存)
- Produces:
  - `PlaybackBar({ isPlaying, onTogglePlay, currentSeconds, totalSeconds, canUndo, canRedo, onUndo, onRedo, children?, className? })`
  - `type EditorTab = "cut" | "caption" | "effects" | "se" | "narration" | "bgm" | "style"`、`EDITOR_TAB_LABELS: Record<EditorTab, string>`、`EditorTabBar({ active, onSelect, className? })`
  - `SettingsPanel({ title, subtitle?, onClose, children, className? })`
  - `type MenuItem = { key: string; label: string; onClick?: () => void; onFile?: (file: File | null) => void; accept?: string }`、`EditorMenu({ items, footer? })`
  - CSSクラス: `.editor-app`、`.editor-app.sheet-open`、`.cut-app`、`.cut-side`、`.editor-area-{topbar,tabs,stage,playback,timeline,tools,settings,coverage,action}`、`.editor-stage`、`.editor-stage-frame`、`.editor-open-settings-btn`

- [ ] **Step 1: 再生バーを作る**

`src/components/editor/PlaybackBar.tsx`:

```tsx
import { PauseIcon, PlayIcon, RedoIcon, UndoIcon } from "@/components/icons";
import { formatTimecode } from "./timeline/timelineScale";

type PlaybackBarProps = {
  isPlaying: boolean;
  onTogglePlay: () => void;
  currentSeconds: number;
  totalSeconds: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** タブレット横向き・PCで、再生バーの中に並べる操作ボタン(ToolInline)。 */
  children?: React.ReactNode;
  className?: string;
};

/**
 * 動画のすぐ下に置く再生バー。Remotion Player標準のコントロールは動画の上に重なって
 * スマホでは字幕や演出を隠していたため使わず、再生・時刻・元に戻す/やり直すをここに集める。
 */
export const PlaybackBar: React.FC<PlaybackBarProps> = ({
  isPlaying,
  onTogglePlay,
  currentSeconds,
  totalSeconds,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  children,
  className,
}) => (
  <div className={`playback-bar${className ? ` ${className}` : ""}`}>
    <button
      type="button"
      className="playback-play"
      onClick={onTogglePlay}
      aria-label={isPlaying ? "一時停止" : "再生"}
    >
      {isPlaying ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
    </button>
    <span className="playback-time">
      {formatTimecode(currentSeconds)} <span>/ {formatTimecode(totalSeconds)}</span>
    </span>
    {children ? <div className="playback-tools">{children}</div> : null}
    <div className="playback-spacer" />
    <button type="button" className="topbar-icon-btn" onClick={onUndo} disabled={!canUndo} aria-label="元に戻す">
      <UndoIcon />
    </button>
    <button type="button" className="topbar-icon-btn" onClick={onRedo} disabled={!canRedo} aria-label="やり直す">
      <RedoIcon />
    </button>
  </div>
);
```

- [ ] **Step 2: タブを作る**

`src/components/editor/EditorTabBar.tsx`:

```tsx
import {
  CaptionIcon,
  MicIcon,
  MusicIcon,
  PaletteIcon,
  ScissorsIcon,
  SparkleIcon,
  SpeakerIcon,
  type IconProps,
} from "@/components/icons";

export type EditorTab = "cut" | "caption" | "effects" | "se" | "narration" | "bgm" | "style";

export const EDITOR_TAB_LABELS: Record<EditorTab, string> = {
  cut: "カット",
  caption: "字幕",
  effects: "演出",
  se: "効果音",
  narration: "AI音声",
  bgm: "BGM",
  style: "見た目",
};

const TABS: { id: EditorTab; Icon: React.FC<IconProps> }[] = [
  { id: "cut", Icon: ScissorsIcon },
  { id: "caption", Icon: CaptionIcon },
  { id: "effects", Icon: SparkleIcon },
  { id: "se", Icon: SpeakerIcon },
  { id: "narration", Icon: MicIcon },
  { id: "bgm", Icon: MusicIcon },
  { id: "style", Icon: PaletteIcon },
];

/**
 * 編集画面のタブ。スマホ・タブレット縦向きでは画面下端に7等分で、1024px以上では左端に縦に並ぶ
 * (並び方はeditor-theme.cssの.editor-tabbarで切り替える)。以前の横並びの文字タブは
 * スマホ幅からはみ出し、横スクロールしないと「AI音声」以降が見えなかった。
 */
export const EditorTabBar: React.FC<{
  active: EditorTab;
  onSelect: (tab: EditorTab) => void;
  className?: string;
}> = ({ active, onSelect, className }) => (
  <nav aria-label="編集メニュー" className={`editor-tabbar${className ? ` ${className}` : ""}`}>
    {TABS.map(({ id, Icon }) => (
      <button
        key={id}
        type="button"
        className={`editor-tabbar-btn${active === id ? " active" : ""}`}
        aria-current={active === id ? "page" : undefined}
        onClick={() => onSelect(id)}
      >
        <Icon size={22} />
        <span>{EDITOR_TAB_LABELS[id]}</span>
      </button>
    ))}
  </nav>
);
```

- [ ] **Step 3: 設定パネルを作る**

`src/components/editor/SettingsPanel.tsx`:

```tsx
type SettingsPanelProps = {
  title: string;
  /** 対象のクリップ等(例: 「クリップ2」)。 */
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
};

/**
 * 各タブの設定(既存のInspectorPanel)の入れ物。スマホでは画面下からせり上がるシート、
 * タブレット縦向きではタイムラインの下、1024px以上では右側に常に表示される
 * (出し分けはeditor-theme.cssの.editor-settings)。「完了」はシートの時だけ見える。
 */
export const SettingsPanel: React.FC<SettingsPanelProps> = ({ title, subtitle, onClose, children, className }) => (
  <section aria-label={title} className={`editor-settings${className ? ` ${className}` : ""}`}>
    <div className="editor-settings-handle" aria-hidden="true" />
    <div className="editor-settings-header">
      <div className="editor-settings-title">
        <h2>{title}</h2>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
      <button type="button" className="editor-settings-close" onClick={onClose}>
        完了
      </button>
    </div>
    <div className="editor-settings-body">{children}</div>
  </section>
);
```

- [ ] **Step 4: 「…」メニューを作る**

`src/components/editor/EditorMenu.tsx`:

```tsx
"use client";

import { useState } from "react";
import { MoreIcon } from "@/components/icons";

export type MenuItem = {
  key: string;
  label: string;
  onClick?: () => void;
  /** 指定するとファイル選択になる(「保存した編集データを開く」用)。 */
  onFile?: (file: File | null) => void;
  accept?: string;
};

/**
 * 上部バー右の「…」メニュー。以前は画面上部に並べていた、たまにしか使わない操作
 * (やり直し・編集データの保存/読み込み・自動編集を試す)と動画の情報をここにまとめる。
 */
export const EditorMenu: React.FC<{ items: MenuItem[]; footer?: React.ReactNode }> = ({ items, footer }) => {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className="editor-menu">
      <button
        type="button"
        className="topbar-icon-btn"
        aria-label="その他のメニュー"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreIcon />
      </button>
      {open ? (
        <>
          <button type="button" className="editor-menu-backdrop" aria-label="メニューを閉じる" onClick={close} />
          <div className="editor-menu-popover" role="menu">
            {items.map((item) =>
              item.onFile ? (
                <label key={item.key} className="editor-menu-item" role="menuitem">
                  {item.label}
                  <input
                    type="file"
                    accept={item.accept}
                    className="hidden"
                    onChange={(e) => {
                      item.onFile?.(e.target.files?.[0] ?? null);
                      e.target.value = "";
                      close();
                    }}
                  />
                </label>
              ) : (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  className="editor-menu-item"
                  onClick={() => {
                    close();
                    item.onClick?.();
                  }}
                >
                  {item.label}
                </button>
              )
            )}
            {footer ? <div className="editor-menu-footer">{footer}</div> : null}
          </div>
        </>
      ) : null}
    </div>
  );
};
```

- [ ] **Step 5: 画面の配置CSSを書く**

`editor-theme.css` の「レイアウト」節(`.editor-shell`〜`.editor-preview-col`)を削除し、次に置き換える。

```css
/* --- レイアウト: 編集画面(.editor-app)・カット画面(.cut-app) ---
 * 画面の高さいっぱいを使い、ページ全体はスクロールさせない「アプリ型」。
 * 1つのDOMのまま、grid-template-areasを画面幅ごとに切り替えて配置を変える。
 *   768px未満     : 上に動画、下端にタブ。設定は下からせり上がるシート
 *   768〜1023px   : スマホと同じ並びで、設定はタイムラインの下に常に表示
 *   1024px以上    : 左にタブ、中央に動画、右に設定、下にタイムライン
 * 高さは100vhではなく100dvh(iPhoneのアドレスバーの伸び縮みで下端が隠れないように)。
 */
.editor-app {
  --editor-topbar-h: 53px;
  --editor-tabbar-h: calc(64px + env(safe-area-inset-bottom));
  --editor-sheet-stage-h: 34dvh;
  height: 100dvh;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr) auto auto auto auto;
  grid-template-areas:
    "topbar"
    "stage"
    "playback"
    "timeline"
    "tools"
    "tabs";
  overflow: hidden;
  background: var(--background);
}
.editor-app.sheet-open {
  grid-template-rows: auto var(--editor-sheet-stage-h) auto auto auto auto;
}
.editor-area-topbar { grid-area: topbar; }
.editor-area-tabs { grid-area: tabs; }
.editor-area-stage { grid-area: stage; }
.editor-area-playback { grid-area: playback; }
.editor-area-timeline { grid-area: timeline; min-width: 0; }
.editor-area-tools { grid-area: tools; }
.editor-area-settings { grid-area: settings; }

/* 動画の置き場。暗い地に、縦長の動画を高さいっぱいで中央に置く */
.editor-stage {
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
  background: var(--stage-background);
}
.editor-stage-frame {
  position: relative;
  height: 100%;
  max-width: 100%;
  aspect-ratio: 9 / 16;
  border-radius: 8px;
  overflow: hidden;
}
.editor-stage-empty {
  height: 100%;
  aspect-ratio: 9 / 16;
  max-width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  border-radius: 8px;
  border: 1px dashed rgba(255, 255, 255, 0.3);
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  text-align: center;
}

/* 再生バー(PlaybackBar.tsx) */
.playback-bar {
  height: 48px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 12px;
  background: var(--background-elevated);
  border-bottom: 1px solid var(--border);
}
.playback-play {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.playback-time {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.playback-time span {
  color: var(--muted);
}
.playback-tools {
  display: none;
}
.playback-spacer {
  flex: 1;
}

/* タブ(EditorTabBar.tsx)。スマホ・タブレット縦向きは下端に7等分 */
.editor-tabbar {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  height: var(--editor-tabbar-h);
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--background-elevated);
  border-top: 1px solid var(--border);
  position: relative;
  z-index: 45;
}
.editor-tabbar-btn {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-size: 10px;
  color: var(--muted);
}
.editor-tabbar-btn span {
  white-space: nowrap;
}
.editor-tabbar-btn.active {
  color: var(--accent);
  font-weight: 700;
  box-shadow: inset 0 2px 0 var(--accent);
}

/* カット以外のタブで、操作ボタンの代わりに出す「〜の設定を開く」(スマホのみ) */
.editor-open-settings-btn {
  width: 100%;
  height: 56px;
  border-radius: 10px;
  background: var(--background-elevated-2);
  font-size: 14px;
  font-weight: 700;
}
.editor-tools-single {
  padding: 8px 12px;
  background: var(--background-elevated);
  border-top: 1px solid var(--border);
}

/* 設定パネル(SettingsPanel.tsx)。スマホでは下からせり上がるシート */
.editor-settings {
  display: none;
  flex-direction: column;
  min-height: 0;
  background: var(--background-elevated);
}
.editor-app .editor-settings {
  position: fixed;
  left: 0;
  right: 0;
  top: calc(var(--editor-topbar-h) + var(--editor-sheet-stage-h) - 8px);
  bottom: var(--editor-tabbar-h);
  z-index: 40;
  border-radius: 16px 16px 0 0;
  box-shadow: var(--shadow-sheet);
}
.editor-app.sheet-open .editor-settings {
  display: flex;
}
.editor-settings-handle {
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background: var(--border-strong);
  margin: 8px auto 0;
}
.editor-settings-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px 10px;
  border-bottom: 1px solid var(--border);
}
.editor-settings-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.editor-settings-title h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}
.editor-settings-title span {
  font-size: 11px;
  color: var(--muted);
}
.editor-settings-close {
  height: 36px;
  padding: 0 16px;
  border-radius: 999px;
  background: var(--foreground);
  color: var(--background-elevated);
  font-size: 13px;
  font-weight: 700;
}
.editor-settings-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

/* 「…」メニュー(EditorMenu.tsx) */
.editor-menu {
  position: relative;
}
.editor-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: transparent;
}
.editor-menu-popover {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 61;
  width: min(280px, calc(100vw - 24px));
  padding: 6px;
  border-radius: 14px;
  background: var(--background-elevated);
  box-shadow: 0 12px 40px rgba(31, 27, 23, 0.18);
  display: flex;
  flex-direction: column;
}
.editor-menu-item {
  min-height: 44px;
  padding: 0 12px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}
.editor-menu-item:hover {
  background: var(--background-elevated-2);
}
.editor-menu-footer {
  margin-top: 6px;
  padding: 10px 12px 6px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* カット画面。可視化バー・操作ボタン・次へボタンを .cut-side にまとめ、スマホでは
   display: contents で中身を直接グリッドに並べる */
/* .editor-app の画面幅ごとの指定より優先させるため、2クラスで指定する */
.editor-app.cut-app {
  grid-template-rows: auto minmax(0, 1fr) auto auto auto auto auto;
  grid-template-areas:
    "topbar"
    "stage"
    "playback"
    "coverage"
    "timeline"
    "tools"
    "action";
}
.cut-side {
  display: contents;
}
.editor-area-coverage {
  grid-area: coverage;
  padding: 10px 12px 8px;
  background: var(--background-elevated);
}
.editor-area-action {
  grid-area: action;
  padding: 10px 12px calc(14px + env(safe-area-inset-bottom));
  background: var(--background-elevated);
}
.editor-area-action .btn-primary {
  width: 100%;
  height: 50px;
  font-size: 15px;
}

/* タブレット縦向き: 設定はシートにせず、タイムラインの下に常に表示 */
@media (min-width: 768px) and (max-width: 1023px) {
  .editor-app {
    grid-template-rows: auto minmax(0, 1fr) auto auto auto minmax(0, 32dvh) auto;
    grid-template-areas:
      "topbar"
      "stage"
      "playback"
      "timeline"
      "tools"
      "settings"
      "tabs";
  }
  .editor-app.sheet-open {
    grid-template-rows: auto minmax(0, 1fr) auto auto auto minmax(0, 32dvh) auto;
  }
  .editor-app .editor-settings {
    position: static;
    display: flex;
    border-radius: 0;
    box-shadow: none;
    border-top: 1px solid var(--border);
  }
  .editor-settings-handle,
  .editor-settings-close,
  .editor-tools-single {
    display: none;
  }
  .editor-tabbar-btn {
    font-size: 12px;
  }
  .editor-app.cut-app {
    grid-template-rows: auto minmax(0, 1fr) auto auto auto auto auto;
    grid-template-areas:
      "topbar"
      "stage"
      "playback"
      "coverage"
      "timeline"
      "tools"
      "action";
  }
}

/* タブレット横向き・PC: 左にタブ、中央に動画、右に設定、下にタイムライン */
@media (min-width: 1024px) {
  .editor-app,
  .editor-app.sheet-open {
    --editor-tabbar-h: auto;
    grid-template-columns: 84px minmax(0, 1fr) 360px;
    grid-template-rows: auto minmax(0, 1fr) auto auto;
    grid-template-areas:
      "topbar topbar topbar"
      "tabs stage settings"
      "playback playback playback"
      "timeline timeline timeline";
  }
  .editor-app .editor-settings {
    position: static;
    display: flex;
    border-radius: 0;
    box-shadow: none;
    border-left: 1px solid var(--border);
  }
  .editor-settings-handle,
  .editor-settings-close,
  .editor-area-tools {
    display: none;
  }
  .editor-tabbar {
    grid-template-columns: none;
    grid-auto-rows: 62px;
    align-content: start;
    height: auto;
    padding: 8px 0;
    border-top: none;
    border-right: 1px solid var(--border);
  }
  .editor-tabbar-btn {
    font-size: 12px;
  }
  .editor-tabbar-btn.active {
    background: var(--accent-soft);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .playback-bar {
    height: 54px;
    padding: 0 20px;
    border-top: 1px solid var(--border);
  }
  .playback-tools {
    display: flex;
    margin-left: 12px;
  }
  .editor-app.cut-app {
    grid-template-columns: minmax(0, 1fr) 360px;
    grid-template-rows: auto minmax(0, 1fr) auto auto;
    grid-template-areas:
      "topbar topbar"
      "stage side"
      "playback playback"
      "timeline timeline";
  }
  .cut-side {
    grid-area: side;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    background: var(--background-elevated);
    border-left: 1px solid var(--border);
    overflow-y: auto;
  }
  .cut-side .editor-area-tools {
    display: block;
  }
  .cut-side .tool-grid {
    border-top: none;
    padding: 0;
  }
  .cut-side .editor-area-coverage,
  .cut-side .editor-area-action {
    padding: 0;
  }
  .cut-side .editor-area-action {
    margin-top: auto;
  }
}
```

あわせて、インスペクターの枠をやめる(シート・右パネルの中に入るため)。`.editor-inspector` と `@media (min-width: 900px) { .editor-inspector {...} }` を次に置き換える。

```css
.editor-inspector {
  width: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
}
```

`.editor-inspector-footer` の `border-top: 1.5px solid var(--foreground);` を `border-top: 1px solid var(--border);` に、`.editor-field input, .editor-field select, .editor-field textarea` の `border: 1.5px solid var(--border-strong);` を `border: 1px solid var(--border);` に、`background: var(--background-elevated-2);` を `background: var(--background);` に変える。

`.editor-toolbar-btn`(インスペクター内のボタンで引き続き使う)を次に置き換え、`:active` の指定は削除する。

```css
.editor-toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 700;
  color: var(--foreground);
  background: var(--background-elevated);
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  transition: background-color 0.12s ease;
}
.editor-toolbar-btn:hover:not(:disabled) {
  background: var(--background-elevated-2);
}
```

`.editor-coverage-bar` の `border: 1.5px solid var(--foreground);` を `border: none;` にする。

- [ ] **Step 6: 型・lintの確認**

Run: `npx tsc --noEmit`
Expected: Task 3で出た `ClipEditor`/`CutEditor` のエラーだけが残り、新規ファイルのエラーは0件

- [ ] **Step 7: コミット**

```bash
git add src/components/editor/PlaybackBar.tsx src/components/editor/EditorTabBar.tsx src/components/editor/SettingsPanel.tsx src/components/editor/EditorMenu.tsx src/components/editor/editor-theme.css
git commit -m "編集・カット画面の画面幅ごとの配置と、再生バー・タブ・設定パネル・メニューの部品を追加"
```

---

### Task 5: 編集画面(ClipEditor)を新しい配置に組み替える

**Files:**
- Modify: `src/components/editor/ClipEditor.tsx`(import、state追加、`return` 以降のJSX)
- Modify: `src/components/editor/AiRevisePanel.tsx:80-91`
- Modify: `src/app/edit/page.tsx`

**Interfaces:**
- Consumes: `AppTopBar`、`ToolGrid`/`ToolInline`/`ToolItem`(Task 2)、`PlaybackBar`/`EditorTabBar`/`EDITOR_TAB_LABELS`/`EditorTab`/`SettingsPanel`/`EditorMenu`(Task 4)、`TimelineRoot` の新props(Task 3)
- Produces: なし(画面の組み替えのみ)

- [ ] **Step 1: import と state を追加する**

`ClipEditor.tsx` の import に追加する。

```tsx
import { AppTopBar } from "@/components/AppTopBar";
import {
  PlusIcon,
  ScissorsIcon,
  SettingsIcon,
  SparkleIcon,
  TrimEndIcon,
  TrimStartIcon,
} from "@/components/icons";
import { EditorMenu } from "./EditorMenu";
import { EDITOR_TAB_LABELS, EditorTabBar, type EditorTab } from "./EditorTabBar";
import { PlaybackBar } from "./PlaybackBar";
import { SettingsPanel } from "./SettingsPanel";
import { ToolGrid, ToolInline, type ToolItem } from "./ToolButtons";
```

`const [activeTab, setActiveTab] = useState<...>("cut");` を次に置き換える。

```tsx
  const [activeTab, setActiveTab] = useState<EditorTab>("cut");
  // スマホで設定シートを開いているか(1024px以上・タブレット縦向きではCSSで常時表示になり、この値は見た目に効かない)。
  const [sheetOpen, setSheetOpen] = useState(false);
  // 設定パネルに出すもの。「AIに頼む」を押した時だけAIの依頼欄にする。
  const [settingsView, setSettingsView] = useState<"tab" | "ai">("tab");
```

- [ ] **Step 2: タブ・シート・再生の操作関数を追加する**

`if (!hasCheckedProject) {` の直前に追加する。

```tsx
  /**
   * タブを押した時。カット以外は設定シートも開く(カットはタイムラインの下の操作ボタンが主役なので開かない)。
   * クリップを押しただけではシートを開かない: 押した瞬間にシートが出ると、ドラッグ中のタイムラインが隠れるため。
   */
  const handleSelectTab = (tab: EditorTab) => {
    setActiveTab(tab);
    setSettingsView("tab");
    setSheetOpen(tab !== "cut");
  };
  const openSettings = () => {
    setSettingsView("tab");
    setSheetOpen(true);
  };
  const openAiPanel = () => {
    setSettingsView("ai");
    setSheetOpen(true);
  };
  const closeSettings = () => {
    setSheetOpen(false);
    setSettingsView("tab");
  };
  const togglePlay = () => playerRef.current?.toggle();
```

- [ ] **Step 3: return のJSXを置き換える**

`return (` から `bulkEditOpen ? (` の直前まで(上部のボタン列〜「動画を書き出す」ボタン)を、次に置き換える。字幕の一括編集ダイアログ(`bulkEditOpen ? (...) : null`)と最後の閉じタグはそのまま残す。各タブの設定(`activeTab === "cut" ? <ClipInspectorPanel .../> : ...`)と「見た目」タブの中身は、既存のJSXをそのまま `tabSettings` に移す。

```tsx
  const selectedSegmentIndex = selectedSegmentKey
    ? form.segments.findIndex((segment) => segment.key === selectedSegmentKey)
    : -1;
  const selectionLabel =
    selectedKeys.size > 1
      ? `${selectedKeys.size}件のクリップ`
      : selectedSegmentIndex >= 0
        ? `クリップ${selectedSegmentIndex + 1}`
        : audioSelection?.kind === "bgm"
          ? "BGM"
          : audioSelection?.kind === "sfx"
            ? "選んだ音"
            : undefined;

  const cutTools: ToolItem[] = [
    {
      key: "split",
      label: "分割",
      icon: <ScissorsIcon />,
      onClick: splitAtPlayhead,
      disabled: !canSplitAtPlayhead,
      shortcut: "S",
    },
    {
      key: "trim-start",
      label: "ここから使う",
      icon: <TrimStartIcon />,
      onClick: trimStartToPlayhead,
      disabled: activeSegmentKey === null,
      shortcut: "I",
    },
    {
      key: "trim-end",
      label: "ここまで使う",
      icon: <TrimEndIcon />,
      onClick: trimEndToPlayhead,
      disabled: activeSegmentKey === null,
      shortcut: "O",
    },
    { key: "add", label: "クリップ追加", icon: <PlusIcon />, onClick: addSegment, disabled: !canAddSegment },
  ];
  // スマホでは選択中クリップの設定(複製・結合・削除・音量)を開くボタンも並べる
  const cutToolsWithSettings: ToolItem[] = [
    ...cutTools,
    { key: "settings", label: "設定", icon: <SettingsIcon />, onClick: openSettings },
  ];

  const tabSettings =
    activeTab === "style" ? (
      /* 既存の「スタイル」パネル(<div className="panel flex flex-col gap-4 p-5">...</div>)の
         外側のdivだけ <div className="flex flex-col gap-4 p-4"> に変えて、中身はそのまま置く */
      STYLE_PANEL_JSX
    ) : (
      /* 既存の activeTab === "cut" ? <ClipInspectorPanel/> : ... : activeTab === "bgm" ? <BgmInspectorPanel/> : null
         をそのまま置く */
      INSPECTOR_JSX
    );

  return (
    <div className={`editor-app${sheetOpen ? " sheet-open" : ""}`}>
      <AppTopBar
        className="editor-area-topbar"
        backHref="/"
        backLabel="トップへ戻る"
        title="編集"
        actions={
          <>
            <button type="button" className="topbar-text-btn hidden lg:inline-flex" onClick={handleExportProject}>
              編集データを保存
            </button>
            <label className="topbar-text-btn hidden cursor-pointer items-center lg:inline-flex">
              保存したデータを開く
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  void handleImportProjectFile(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
            </label>
            <EditorMenu
              items={[
                { key: "auto-edit", label: "自動編集を試す", onClick: handleGoToAutoEdit },
                { key: "save", label: "編集データを保存", onClick: handleExportProject },
                {
                  key: "open",
                  label: "保存した編集データを開く",
                  accept: "application/json",
                  onFile: (file) => void handleImportProjectFile(file),
                },
                { key: "copy", label: copyStatus === "done" ? "✓ 字幕をコピーしました" : "字幕をコピー", onClick: () => void handleCopyCaptions() },
                { key: "start-over", label: "別の動画からやり直す", onClick: handleStartOver },
              ]}
              footer={
                <>
                  <span>
                    総尺 {stats.totalSeconds.toFixed(1)}秒・クリップ {stats.clipCount}個・文字数 {stats.charCount}字
                  </span>
                  <span>
                    「編集データを保存」は、今の編集の状態(カット・字幕・演出など)をファイルに残します。動画そのものは入りません。
                  </span>
                </>
              }
            />
            <button
              type="button"
              className={`topbar-pill${settingsView === "ai" && sheetOpen ? " active" : ""}`}
              onClick={openAiPanel}
            >
              <SparkleIcon size={16} />
              AIに頼む
            </button>
            <button
              type="button"
              className="btn-primary topbar-cta"
              onClick={handleGoToExport}
              disabled={!canRender}
            >
              書き出す
            </button>
          </>
        }
      />

      <EditorTabBar className="editor-area-tabs" active={activeTab} onSelect={handleSelectTab} />

      <div className="editor-area-stage editor-stage">
        {form.segments.length > 0 ? (
          <div className="editor-stage-frame">
            <Player
              ref={playerRef}
              component={StandardVideo}
              inputProps={props}
              durationInFrames={Math.max(durationInFrames, 1)}
              fps={VIDEO_FPS}
              compositionWidth={VIDEO_WIDTH}
              compositionHeight={VIDEO_HEIGHT}
              style={{ width: "100%", height: "100%" }}
              clickToPlay
              loop
            />
            {!isPreviewPlaying ? (
              <PreviewDragLayer
                segments={form.segments}
                globalOverlays={project?.globalOverlays}
                globalImages={project?.globalImages}
                frame={previewFrame}
                fontFamilyStack={resolveFontFamilyStack(fontFamily)}
                onMove={moveOverlayOnPreview}
              />
            ) : null}
          </div>
        ) : (
          <div className="editor-stage-empty">クリップを追加するとここで再生確認できます</div>
        )}
      </div>

      <PlaybackBar
        className="editor-area-playback"
        isPlaying={isPreviewPlaying}
        onTogglePlay={togglePlay}
        currentSeconds={previewFrame / VIDEO_FPS}
        totalSeconds={stats.totalSeconds}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
      >
        {activeTab === "cut" ? <ToolInline items={cutTools} /> : null}
      </PlaybackBar>

      <div className="editor-area-timeline">
        <TimelineRoot
          segments={form.segments}
          sfxClips={activeTab === "se" ? sfxOnlyClips : activeTab === "narration" ? narrationOnlyClips : sfxClips}
          bgm={bgm}
          videoPath={project.videoPath}
          totalDurationSeconds={stats.totalSeconds}
          currentSeconds={previewFrame / VIDEO_FPS}
          selectedKeys={selectedKeys}
          activeSegmentKey={activeSegmentKey}
          audioSelection={audioSelection}
          onSelectSegment={selectSegment}
          onTrimStart={(key, value) => updateSegment(key, { startFromSeconds: value })}
          onTrimEnd={(key, value) => updateSegment(key, { durationInSeconds: value })}
          onTrimBegin={pushHistory}
          onReorder={reorderSegment}
          onSelectSfx={selectSfx}
          onMoveSfx={(key, value) => updateSfxClip(key, { startFromSeconds: value })}
          onSelectBgm={selectBgm}
          onScrub={(seconds) => playerRef.current?.seekTo(Math.round(seconds * VIDEO_FPS))}
          tracks={{
            video: true,
            sfx: activeTab === "se" || activeTab === "narration",
            bgm: activeTab === "bgm",
          }}
        />
      </div>

      <div className="editor-area-tools">
        {activeTab === "cut" ? (
          <ToolGrid items={cutToolsWithSettings} />
        ) : (
          <div className="editor-tools-single">
            <button type="button" className="editor-open-settings-btn" onClick={openSettings}>
              {EDITOR_TAB_LABELS[activeTab]}の設定を開く{selectionLabel ? `(${selectionLabel})` : ""}
            </button>
          </div>
        )}
      </div>

      <SettingsPanel
        className="editor-area-settings"
        title={settingsView === "ai" ? "AIに頼む" : EDITOR_TAB_LABELS[activeTab]}
        subtitle={settingsView === "ai" ? undefined : selectionLabel}
        onClose={closeSettings}
      >
        {settingsView === "ai" ? (
          <AiRevisePanel
            buildState={buildAiEditableState}
            videoDurationInSeconds={videoDurationInSeconds}
            selectedClip={
              selectedSegmentIndex >= 0
                ? {
                    id: selectedSegmentIndex,
                    label: form.segments[selectedSegmentIndex].caption.trim().slice(0, 12) || "字幕なし",
                  }
                : null
            }
            onApply={applyAiRevision}
            canUndo={aiUndoSnapshot !== null}
            onUndo={undoAiRevision}
          />
        ) : (
          tabSettings
        )}
      </SettingsPanel>
```

`STYLE_PANEL_JSX` と `INSPECTOR_JSX` は説明用の目印。実際のコードでは、現在の `return` 内にある該当JSX(「見た目」タブ: `{activeTab === "style" ? (<div className="panel ...">...</div>) : null}` の中身、各タブ: `{activeTab === "cut" ? (<ClipInspectorPanel .../>) : ... : null}`)を切り取ってそこに貼る。

削除するもの: 上部のボタン列と説明文、`editor-top-row`、統計の行、キーボード操作の説明文、旧 `AiRevisePanel` の配置、`tab-bar` のボタン7個、旧「動画を書き出す」ボタン、旧 `TimelineRoot` の操作ボタン系props。

- [ ] **Step 4: AIの依頼欄の見出しをパネルに合わせる**

`AiRevisePanel.tsx` の `return (` 直後の2行を次に置き換える(設定パネルの見出しが「AIに頼む」になるため、重複する見出しと枠をやめる)。

```tsx
    <div className="flex flex-col gap-2 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          演出を足す・直すお願いを、文章で書いてください
        </p>
```

(元の `<h2 className="text-sm font-semibold">🤖 AIに頼む(演出を足す・直す)</h2>` を上の `<p>` に置き換え、外側の `className="panel flex flex-col gap-2 p-4"` を `className="flex flex-col gap-2 p-4"` にする。)

- [ ] **Step 5: 編集画面のページから見出しと余白をなくす**

`src/app/edit/page.tsx`:

```tsx
import { ClipEditor } from "@/components/editor/ClipEditor";
import "@/components/editor/editor-theme.css";

// 見出し・説明文は上部バー(AppTopBar)に置き換え、画面の高さいっぱいを編集に使う。
export default function EditPage() {
  return <ClipEditor />;
}
```

`ClipEditor.tsx` の `EmptyState` を、上部バー付きのページで包む。

```tsx
const EmptyState: React.FC = () => (
  <div className="flow-page">
    <AppTopBar backHref="/" title="編集" />
    <main className="flow-main">
      <div className="panel flex flex-col items-center gap-3 p-10 text-center">
        <p className="text-sm font-medium">編集する動画がありません</p>
        <p className="text-xs" style={{ color: "var(--muted-2)" }}>
          まずは動画をアップロードして字幕を生成してください
        </p>
        <a href="/create" className="btn-primary px-4 py-2 text-sm">
          動画をアップロードする →
        </a>
      </div>
    </main>
  </div>
);
```

- [ ] **Step 6: 型・lint・テストを確認する**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: `ClipEditor.tsx` のエラーが消え、残りは `CutEditor.tsx` のみ。lintで未使用になった関数・importが出たら削除する(`handleStartOver` 等はメニューで使うので残る)。

- [ ] **Step 7: 実画面で確認する**

`npm run dev` が起動している状態で、ブラウザの幅を390px・820px・1180pxにして `/edit` を開き、次を確認する。
- 390px: 動画が上、タブが下端、カットタブで操作ボタン5個が1行。字幕タブを押すと設定シートが出て、動画が見えたまま。「完了」で閉じる
- 820px: 設定がタイムラインの下に常に表示され、「完了」ボタンは出ない
- 1180px: 左にタブ、右に設定、下にタイムライン。カットタブで再生バーに操作ボタンとキー(S・I・O)が並ぶ
- 再生ボタン、動画のタップで再生/一時停止できる。止めている時に演出の枠をドラッグできる

- [ ] **Step 8: コミット**

```bash
git add src/components/editor/ClipEditor.tsx src/components/editor/AiRevisePanel.tsx src/app/edit/page.tsx
git commit -m "編集画面を、動画を上に固定し操作を下にまとめたアプリ型の配置に組み替える"
```

---

### Task 6: カット画面(CutEditor)を新しい配置に組み替える

**Files:**
- Modify: `src/components/editor/CutEditor.tsx`(import、再生状態、`EmptyState`、`return` 以降のJSX)
- Modify: `src/app/create/cut/page.tsx`

**Interfaces:**
- Consumes: `AppTopBar`、`ToolGrid`/`ToolItem`(Task 2)、`PlaybackBar`(Task 4)、`TimelineRoot` の新props(Task 3)

- [ ] **Step 1: import と再生状態を追加する**

import に追加する。

```tsx
import { AppTopBar } from "@/components/AppTopBar";
import { PlusIcon, ScissorsIcon, TrashIcon, TrimEndIcon, TrimStartIcon } from "@/components/icons";
import { PlaybackBar } from "./PlaybackBar";
import { ToolGrid, type ToolItem } from "./ToolButtons";
```

`const [previewFrame, setPreviewFrame] = useState(0);` の直後に `const [isPlaying, setIsPlaying] = useState(false);` を追加し、その下の `useEffect` を次に置き換える。

```tsx
  useEffect(() => {
    if (!hasClips) return;
    const player = playerRef.current;
    if (!player) return;
    const handleFrameUpdate = ({ detail }: { detail: { frame: number } }) => {
      setPreviewFrame(detail.frame);
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    player.addEventListener("frameupdate", handleFrameUpdate);
    player.addEventListener("play", handlePlay);
    player.addEventListener("pause", handlePause);
    return () => {
      player.removeEventListener("frameupdate", handleFrameUpdate);
      player.removeEventListener("play", handlePlay);
      player.removeEventListener("pause", handlePause);
    };
  }, [hasClips]);
```

- [ ] **Step 2: EmptyState を上部バー付きにする**

```tsx
const EmptyState: React.FC = () => (
  <div className="flow-page">
    <AppTopBar backHref="/create" title="使う範囲を選ぶ" step={{ current: 2, total: 4 }} />
    <main className="flow-main">
      <div className="panel flex flex-col items-center gap-3 p-10 text-center">
        {/* 既存のEmptyStateの中身(文言とリンク)をそのまま置く */}
      </div>
    </main>
  </div>
);
```

(既存 `EmptyState` の `<div className="panel ...">` の中身をそのままここへ移す。)

- [ ] **Step 3: return のJSXを置き換える**

`return (` 以降を次に置き換える。可視化バー(`editor-coverage-bar`)と範囲選択時の操作行は、既存のJSXをそのまま使い、見出し行だけを変える。

```tsx
  const cutTools: ToolItem[] = [
    { key: "split", label: "分割", icon: <ScissorsIcon />, onClick: splitAtPlayhead, disabled: !canSplitAtPlayhead },
    {
      key: "trim-start",
      label: "ここから使う",
      icon: <TrimStartIcon />,
      onClick: trimStartToPlayhead,
      disabled: activeSegmentKey === null,
    },
    {
      key: "trim-end",
      label: "ここまで使う",
      icon: <TrimEndIcon />,
      onClick: trimEndToPlayhead,
      disabled: activeSegmentKey === null,
    },
    { key: "add", label: "クリップ追加", icon: <PlusIcon />, onClick: addSegment, disabled: !canAddSegment },
    {
      key: "discard",
      label: "捨てる",
      icon: <TrashIcon />,
      onClick: () => removeSegments(selectedKeys),
      disabled: selectedKeys.size === 0,
      danger: true,
    },
  ];

  return (
    <div className="editor-app cut-app">
      <AppTopBar
        className="editor-area-topbar"
        backHref="/create"
        title="使う範囲を選ぶ"
        step={{ current: 2, total: 4 }}
        actions={
          <button type="button" className="topbar-text-btn" onClick={handleStartOver}>
            別の動画にする
          </button>
        }
      />

      <div className="editor-area-stage editor-stage">
        <div className="editor-stage-frame">
          <Player
            ref={playerRef}
            component={StandardVideo}
            inputProps={props}
            durationInFrames={Math.max(durationInFrames, 1)}
            fps={VIDEO_FPS}
            compositionWidth={VIDEO_WIDTH}
            compositionHeight={VIDEO_HEIGHT}
            style={{ width: "100%", height: "100%" }}
            clickToPlay
            loop
          />
        </div>
      </div>

      <PlaybackBar
        className="editor-area-playback"
        isPlaying={isPlaying}
        onTogglePlay={() => playerRef.current?.toggle()}
        currentSeconds={previewFrame / VIDEO_FPS}
        totalSeconds={totalSeconds}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
      />

      <div className="editor-area-timeline">
        <TimelineRoot
          segments={segments}
          sfxClips={[]}
          bgm={null}
          videoPath={project.videoPath}
          totalDurationSeconds={totalSeconds}
          currentSeconds={previewFrame / VIDEO_FPS}
          selectedKeys={selectedKeys}
          activeSegmentKey={activeSegmentKey}
          audioSelection={null}
          onSelectSegment={selectSegment}
          onTrimStart={handleTrimStart}
          onTrimEnd={handleTrimEnd}
          onTrimBegin={pushHistory}
          onReorder={reorderSegment}
          onSelectSfx={() => {}}
          onMoveSfx={() => {}}
          onSelectBgm={() => {}}
          onScrub={(seconds) => playerRef.current?.seekTo(Math.round(seconds * VIDEO_FPS))}
          tracks={{ sfx: false, bgm: false }}
        />
      </div>

      <div className="cut-side">
        {videoDurationInSeconds > 0 ? (
          <div className="editor-area-coverage editor-coverage-wrap">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-bold">使う範囲</span>
              <span className="whitespace-nowrap tabular-nums" style={{ color: "var(--muted)" }}>
                <b style={{ color: "var(--foreground)" }}>{sourceCoverage.keptSeconds.toFixed(1)}秒</b> / 全体{" "}
                {videoDurationInSeconds.toFixed(1)}秒
              </span>
            </div>
            {/* 既存の <div className="editor-coverage-bar" ...>...</div> をそのまま置く */}
            {/* 既存の sourceRange ? (範囲選択時の操作行) : (説明文) をそのまま置き、
                説明文の文言だけ「バーを指でなぞると、まとめて捨てる範囲を選べます」に変える */}
          </div>
        ) : null}

        <div className="editor-area-tools">
          <ToolGrid items={cutTools} />
        </div>

        <div className="editor-area-action">
          <button
            type="button"
            onClick={handleGoToStyle}
            disabled={segments.length === 0}
            className="btn-primary flex items-center justify-center"
          >
            見た目の手本へ進む
          </button>
        </div>
      </div>
    </div>
  );
```

削除するもの: 「← 別の動画からやり直す」ボタン(上部バーの「別の動画にする」に移動)、キーボード操作の説明文、旧「この範囲で進む(参考スクショへ) →」ボタン、旧 `TimelineRoot` の操作ボタン系props。

- [ ] **Step 4: カット画面のページから見出しと余白をなくす**

`src/app/create/cut/page.tsx`:

```tsx
import { CutEditor } from "@/components/editor/CutEditor";
import "@/components/editor/editor-theme.css";

// 見出し・説明文は上部バー(AppTopBar)に置き換え、画面の高さいっぱいをカットに使う。
export default function CreateCutPage() {
  return <CutEditor />;
}
```

- [ ] **Step 5: 型・lint・テストを確認する**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: すべてエラー0件・PASS

- [ ] **Step 6: 実画面で確認する**

幅390pxと1180pxで `/create/cut` を開き、次を確認する。
- 390px: 上部に「ステップ 2 / 4」と進み具合、動画、再生バー、「使う範囲 62.3秒 / 全体 79.6秒」が1行、タイムライン、操作5個が1行、下端に「見た目の手本へ進む」。縦スクロールが出ない
- 1180px: 右側に使う範囲・操作ボタン・次へボタン、下にタイムライン
- 可視化バーをなぞって範囲を選び、「この範囲を捨てる」が動く

- [ ] **Step 7: コミット**

```bash
git add src/components/editor/CutEditor.tsx src/app/create/cut/page.tsx
git commit -m "カット画面を編集画面と同じアプリ型の配置に組み替える"
```

---

### Task 7: 動画を選ぶ・見た目の手本・自動編集の画面

**Files:**
- Modify: `src/app/create/page.tsx`
- Modify: `src/app/create/UploadGenerator.tsx`(`return` 以降のJSX)
- Modify: `src/app/create/style/page.tsx`
- Modify: `src/app/create/style/StyleAndTranscribe.tsx`(`return` 以降のJSX)
- Modify: `src/app/create/auto-edit/page.tsx`
- Modify: `src/app/create/auto-edit/AutoEditScreen.tsx`(`return` 以降のJSX)

**Interfaces:**
- Consumes: `AppTopBar`、`UploadIcon`・`InfoIcon`・`SparkleIcon`(Task 2)、`.flow-page` `.flow-main` `.flow-lead` `.bottom-action-bar` `.text-link` `.break-anywhere`(Task 1)

- [ ] **Step 1: 3つのページを上部バー付きのページにする**

`src/app/create/page.tsx`:

```tsx
import { AppTopBar } from "@/components/AppTopBar";
import { UploadGenerator } from "./UploadGenerator";

export default function CreatePage() {
  return (
    <div className="flow-page">
      <AppTopBar backHref="/" backLabel="トップへ戻る" title="動画を選ぶ" step={{ current: 1, total: 4 }} />
      <UploadGenerator />
    </div>
  );
}
```

`src/app/create/style/page.tsx`:

```tsx
import { AppTopBar } from "@/components/AppTopBar";
import { StyleAndTranscribe } from "./StyleAndTranscribe";

export default function CreateStylePage() {
  return (
    <div className="flow-page">
      <AppTopBar backHref="/create/cut" title="見た目の手本を選ぶ" step={{ current: 3, total: 4 }} />
      <StyleAndTranscribe />
    </div>
  );
}
```

`src/app/create/auto-edit/page.tsx`:

```tsx
import { AppTopBar } from "@/components/AppTopBar";
import { AutoEditScreen } from "./AutoEditScreen";

export default function CreateAutoEditPage() {
  return (
    <div className="flow-page">
      <AppTopBar backHref="/create/style" title="AIで自動編集" step={{ current: 4, total: 4 }} />
      <AutoEditScreen />
    </div>
  );
}
```

各コンポーネントは `<main className="flow-main">...</main>` と `<div className="bottom-action-bar">...</div>` を返す形にする(Step 2〜4)。`EmptyState` も `<main className="flow-main">` で包む。

- [ ] **Step 2: 動画を選ぶ画面(UploadGenerator)**

`return (` 以降を次に置き換える。

```tsx
  return (
    <>
      <main className="flow-main">
        <p className="flow-lead">編集したい縦長の動画を1本選んでください。長さは自動で読み取ります。</p>

        {existingProject ? (
          <div className="panel flex flex-col gap-3 p-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-bold">前回の編集内容が残っています</span>
              <span className="break-anywhere text-xs" style={{ color: "var(--muted)" }}>
                {existingProject.videoFileName ?? "動画"}・クリップ{existingProject.segments.length}個・
                {existingProject.videoDurationInSeconds.toFixed(1)}秒
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href="/edit" className="btn-primary px-4 py-2 text-sm">
                編集を再開する
              </a>
              <button type="button" onClick={handleDiscardExisting} className="btn-outline px-4 py-2 text-sm">
                破棄して新しくはじめる
              </button>
            </div>
          </div>
        ) : null}

        <input
          id="video-file"
          type="file"
          accept="video/*"
          className="sr-only"
          onChange={(e) => {
            void handleVideoFileChange(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />

        {videoFileName ? (
          <div className="panel flex flex-col gap-3 p-4">
            <span className="break-anywhere line-clamp-2 text-sm font-bold">{videoFileName}</span>
            {videoUploading ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {videoConvertPercent !== null
                    ? `どの端末でも使える形式に変換中... ${videoConvertPercent}%`
                    : videoUploadPercent < 100
                      ? `アップロード中... ${videoUploadPercent}%`
                      : "保存中..."}
                </span>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${videoConvertPercent ?? videoUploadPercent}%` }} />
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {videoDurationInSeconds ? (
                  <span className="badge-pill success">長さ {videoDurationInSeconds.toFixed(1)}秒</span>
                ) : null}
                <label htmlFor="video-file" className="btn-outline cursor-pointer px-4 py-1.5 text-sm">
                  別の動画にする
                </label>
              </div>
            )}
            {durationError ? (
              <div className="flex flex-col gap-2">
                <span className="badge-pill danger w-fit">{durationError}(長さが取得できず、次へ進めません)</span>
                <button
                  type="button"
                  className="btn-outline w-fit px-3 py-1.5 text-xs"
                  onClick={() => pendingFile && detectDuration(pendingFile)}
                >
                  長さの取得を再試行
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <label
            htmlFor="video-file"
            className="upload-drop flex cursor-pointer flex-col items-center justify-center gap-2 p-8 text-center"
          >
            <UploadIcon size={28} />
            <span className="text-base font-bold">動画を選ぶ</span>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              縦長の動画を1本
            </span>
          </label>
        )}
      </main>

      <div className="bottom-action-bar">
        <button type="button" onClick={handleGoToCut} disabled={!canProceed} className="btn-primary">
          使う範囲を選ぶへ進む
        </button>
      </div>
    </>
  );
```

import に `import { UploadIcon } from "@/components/icons";` を追加する。

- [ ] **Step 3: 見た目の手本の画面(StyleAndTranscribe)**

`return (` 以降を次に置き換える。手本は今と同じく1つ(画像か動画)を選ぶ。

```tsx
  const hasAnyReference = Boolean(styleReference ?? project.styleReference);
  const isBusy = referenceUploading || extractStyleState.status === "processing";

  return (
    <>
      <main className="flow-main">
        <span className="badge-pill neutral w-fit">なくてもOK</span>
        <p className="flow-lead">
          まねしたい投稿のスクショや動画を選ぶと、AIが配色・文字・演出をその雰囲気に寄せて編集します。
        </p>

        <input
          id="style-reference-file"
          type="file"
          accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm"
          className="sr-only"
          onChange={(e) => {
            void handleReferenceFileChange(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />

        {referencePreviewUrl ? (
          <div className="flex items-start gap-3">
            {referenceFile?.type.startsWith("video/") ? (
              <video
                src={referencePreviewUrl}
                controls
                muted
                className="w-28 rounded-lg object-cover"
                style={{ aspectRatio: "9 / 16" }}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={referencePreviewUrl}
                alt="見た目の手本のプレビュー"
                className="w-28 rounded-lg object-cover"
                style={{ aspectRatio: "9 / 16" }}
              />
            )}
            <label htmlFor="style-reference-file" className="btn-outline cursor-pointer px-4 py-1.5 text-sm">
              別の手本にする
            </label>
          </div>
        ) : (
          <label
            htmlFor="style-reference-file"
            className="upload-drop flex cursor-pointer flex-col items-center justify-center gap-2 p-8 text-center"
          >
            <UploadIcon size={28} />
            <span className="text-base font-bold">手本の画像・動画を選ぶ</span>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              動画なら、文字の出し方の動きも読み取ります
            </span>
          </label>
        )}

        {referenceUploading ? <span className="badge-pill warning w-fit">手本の動画をアップロード中...</span> : null}
        {!referenceUploading && extractStyleState.status === "processing" ? (
          <span className="badge-pill warning w-fit">見た目を読み取り中...</span>
        ) : null}
        {extractStyleState.status === "done" ? (
          <div className="panel flex flex-col gap-2 p-4">
            <span className="text-xs font-bold" style={{ color: "var(--muted)" }}>
              手本から読み取った見た目
            </span>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span
                className="h-6 w-6 rounded-full"
                style={{ background: primaryColor ?? project.primaryColor, border: "1px solid var(--border)" }}
              />
              <span>
                背景: {captionStyleLabel(extractStyleState.captionStyle)}・出し方:{" "}
                {captionAnimationLabel(extractStyleState.captionAnimation)}
              </span>
            </div>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              次の編集画面でいつでも変えられます
            </span>
          </div>
        ) : null}
        {extractStyleState.status === "error" ? (
          <p className="badge-pill danger w-fit">{extractStyleState.message}</p>
        ) : null}
        {!styleReference && project.styleReference ? (
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            新しい手本を選ばなければ、前回の手本をそのまま使います
          </span>
        ) : null}
      </main>

      <div className="bottom-action-bar">
        <button type="button" onClick={goToAutoEdit} disabled={isBusy} className="btn-primary">
          {hasAnyReference ? "自動編集へ進む" : "手本なしで進む"}
        </button>
      </div>
    </>
  );
```

import に `import { UploadIcon } from "@/components/icons";` を追加する。

- [ ] **Step 4: AIで自動編集の画面(AutoEditScreen)**

ファイル上部(`totalSeconds` の定義の後)に定数を追加する。

```tsx
const AI_DECIDES = ["切り方", "寄り(ズーム)", "強調テキスト", "効果音", "ナレーション", "冒頭の見出し", "締めの一言"];
```

`return (` 以降を次に置き換える。

```tsx
  return (
    <>
      <main className="flow-main">
        <div className="panel flex flex-col gap-3 p-4">
          <span className="text-sm font-bold">AIがまとめて決めること</span>
          <div className="flex flex-wrap gap-1.5">
            {AI_DECIDES.map((label) => (
              <span key={label} className="badge-pill neutral font-normal">
                {label}
              </span>
            ))}
          </div>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            数分かかることがあります。字幕は次の編集画面で付けるか決められます。
          </span>
        </div>

        {hasReference ? (
          <span className="badge-pill success w-fit">見た目の手本を最優先の手本にします</span>
        ) : (
          <div
            className="flex gap-2.5 rounded-[14px] p-3.5"
            style={{ background: "var(--warning-soft)", color: "#6b4b00" }}
          >
            <InfoIcon size={20} className="mt-0.5 shrink-0" />
            <div className="flex flex-col gap-1.5 text-sm">
              <span>見た目の手本が未設定です。設定すると、その雰囲気に寄せて編集します。</span>
              <a href="/create/style" className="font-bold" style={{ color: "#6b4b00" }}>
                見た目の手本を設定する ›
              </a>
            </div>
          </div>
        )}

        {autoEditState.status === "processing" ? (
          <div className="panel flex flex-col gap-1 p-4">
            <span className="text-sm font-bold">AIが編集中…({elapsedSeconds}秒経過)</span>
            {hasReference && !autoEditState.usedStyleReference ? (
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                見た目の手本がサーバー上に見つからなかったため、今回は手本無しで編集しています(見た目の手本の画面からもう一度選んでください)
              </span>
            ) : null}
          </div>
        ) : null}

        {autoEditState.status === "error" ? <p className="badge-pill danger w-fit">{autoEditState.message}</p> : null}

        {autoEditState.status === "done" ? (
          /* 既存の autoEditState.status === "done" の中身のうち、ボタンの行(<div className="flex gap-2">...</div>)を
             除いた部分を <div className="panel flex flex-col gap-3 p-4"> で包んで置く */
          DONE_SUMMARY_JSX
        ) : null}
      </main>

      <div className="bottom-action-bar">
        {autoEditState.status === "done" ? (
          <>
            <button type="button" onClick={applyPlan} className="btn-primary">
              この案を使う
            </button>
            <button type="button" onClick={handleRun} className="btn-outline">
              別の案を作る
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handleRun}
            disabled={autoEditState.status === "processing"}
            className="btn-primary"
          >
            <SparkleIcon size={18} />
            {autoEditState.status === "processing"
              ? "AIが編集中…"
              : autoEditState.status === "error"
                ? "もう一度自動編集する"
                : "AIで自動編集する"}
          </button>
        )}
        <button type="button" onClick={goToEditorWithoutChanges} className="text-link">
          AIを使わず自分で編集する
        </button>
      </div>
    </>
  );
```

`DONE_SUMMARY_JSX` は説明用の目印。実際のコードでは既存の `done` 表示(要約文・参考の説明・内訳リスト・注意書き)を切り取って貼る。import に `import { InfoIcon, SparkleIcon } from "@/components/icons";` を追加する。

- [ ] **Step 5: 型・lintの確認**

Run: `npx tsc --noEmit; npm run lint`
Expected: エラー0件

- [ ] **Step 6: 実画面で確認する**

幅390pxで `/create` → 動画選択 → `/create/cut` → `/create/style` → `/create/auto-edit` と進み、各画面で次を確認する。
- 上部に「ステップ N / 4」と進み具合バーが正しい数だけ塗られている
- 見出しと説明文が細い列に押し込まれていない。長いファイル名が2行で省略される
- 次へ進むボタンが画面下端にあり、横幅いっぱい
- 「AIで自動編集」画面の注意書きは、文章とリンクが上下に分かれている

- [ ] **Step 7: コミット**

```bash
git add src/app/create
git commit -m "動画を選ぶ・見た目の手本・自動編集の画面を、手順表示と下端の次へボタンのある配置にする"
```

---

### Task 8: 書き出し画面とトップ画面

**Files:**
- Modify: `src/app/edit/export/page.tsx`
- Modify: `src/components/editor/ExportScreen.tsx`(`return` 部分)
- Modify: `src/components/editor/RenderPanel.tsx`(ログ表示2か所)
- Modify: `src/app/page.tsx`(開発者用ボタン)

**Interfaces:**
- Consumes: `AppTopBar`(Task 2)、`.flow-page` `.flow-main` `.break-anywhere` `.text-link`(Task 1)

- [ ] **Step 1: 書き出しのページを上部バー付きにする**

`src/app/edit/export/page.tsx`:

```tsx
import { AppTopBar } from "@/components/AppTopBar";
import { ExportScreen } from "@/components/editor/ExportScreen";
import "@/components/editor/editor-theme.css";

export default function ExportPage() {
  return (
    <div className="flow-page">
      <AppTopBar backHref="/edit" backLabel="編集に戻る" title="書き出し" />
      <main className="flow-main">
        <ExportScreen />
      </main>
    </div>
  );
}
```

`ExportScreen.tsx` の最後の `return` から「← 編集に戻る」のリンクを削除し、案内文を次にする。

```tsx
  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex flex-col gap-1 p-4">
        <p className="break-anywhere text-sm font-bold">{project.videoFileName ?? "動画"}を書き出しています</p>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          この画面を開いたままお待ちください。終わるとダウンロードできます。
        </p>
      </div>
      <RenderPanel
        canRender={canRender}
        renderState={renderState}
        logs={logs}
        elapsedSeconds={elapsedSeconds}
        onRender={() => startRender(project)}
        result={result}
      />
    </div>
  );
```

- [ ] **Step 2: 詳しい進み具合を折りたたむ**

`RenderPanel.tsx` に2か所ある `{logs.length > 0 ? (<div className="log-panel">...</div>) : null}` を、それぞれ次に置き換える。

```tsx
          {logs.length > 0 ? (
            <details className="text-xs" style={{ color: "var(--muted)" }}>
              <summary className="cursor-pointer py-1">詳しい進み具合を見る</summary>
              <div className="log-panel mt-1">
                {logs.map((line, i) => (
                  <span key={i} className={`log-line${i === logs.length - 1 ? " current" : ""}`}>
                    {line}
                  </span>
                ))}
              </div>
            </details>
          ) : null}
```

完成後の動画の `<video>` の `style={{ border: "1.5px solid var(--foreground)" }}` を `style={{ border: "1px solid var(--border)" }}` に変える。

- [ ] **Step 3: トップの開発者用ボタンを文字リンクにする**

`src/app/page.tsx` の2つのボタンを並べている `<div className="flex flex-wrap items-center justify-center gap-2">...</div>` を次に置き換える(タイトル・説明文・手順カードは変えない)。

```tsx
        <div className="flex w-full flex-col items-center gap-2">
          <Link
            href="/create"
            className="btn-primary flex h-12 w-full max-w-xs items-center justify-center px-7 text-base"
          >
            動画を作成する →
          </Link>
          <Link href="/dev/edit-examples" className="text-link text-xs">
            学習・正解動画をアップロード(開発者用)
          </Link>
        </div>
```

手順カードの `className="panel-flat flex items-start gap-3 p-4 text-left"` に付いている枠は、共通部品の変更(Task 1)で細線になる。カードの `style` の `cursor: "default"` はそのまま残す。

- [ ] **Step 4: 型・lintの確認**

Run: `npx tsc --noEmit; npm run lint`
Expected: エラー0件

- [ ] **Step 5: コミット**

```bash
git add src/app/edit/export/page.tsx src/components/editor/ExportScreen.tsx src/components/editor/RenderPanel.tsx src/app/page.tsx
git commit -m "書き出し画面に上部バーを付けて詳しい進み具合を折りたたみ、トップの開発者用ボタンを文字リンクにする"
```

---

### Task 9: 全画面・全幅の見た目の検査と、設計書の更新

**Files:**
- Create(リポジトリ外・コミットしない): `<スクラッチパッド>/layout-audit.py`
- Modify: `docs/superpowers/specs/2026-10-02-mobile-first-layout-redesign-design.md`(実装で決めた差分の反映)

- [ ] **Step 1: 検査スクリプトを用意する**

スクラッチパッドに `layout-audit.py` を作る(過去にテスト用スクリプトを誤ってコミットしたため、リポジトリには置かない)。

```python
import json, os, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "audit")
VIDEO = r"C:\workspace\systems\SNSapp\data\edit-examples\media\raw\日本と韓国の矯正治療の違い-4bef6187.mp4"
WIDTHS = [(390, 844), (820, 1180), (1180, 820), (1440, 900)]
PAGES = ["/", "/create", "/create/cut", "/create/style", "/create/auto-edit", "/edit", "/edit/export"]

# ページ全体の横はみ出しを調べる。タイムラインの中身と動画(Remotion)の内部は対象外。
OVERFLOW_JS = """() => {
  const vw = document.documentElement.clientWidth;
  const skip = (el) => el.closest('.editor-timeline-scroll, .editor-stage-frame');
  const offenders = [];
  for (const el of document.querySelectorAll('body *')) {
    if (skip(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > vw + 1) offenders.push((el.className?.toString?.() || el.tagName).slice(0, 60));
  }
  const timeline = document.querySelector('.editor-timeline-scroll');
  return {
    pageScroll: document.documentElement.scrollWidth > vw,
    offenders: offenders.slice(0, 10),
    timelineOverflow: timeline ? timeline.scrollWidth > timeline.clientWidth + 1 : null,
    docHeight: document.documentElement.scrollHeight,
  };
}"""

os.makedirs(OUT, exist_ok=True)
failed = False
with sync_playwright() as p:
    browser = p.chromium.launch()
    for w, h in WIDTHS:
        ctx = browser.new_context(viewport={"width": w, "height": h}, is_mobile=w < 1024, has_touch=w < 1024)
        page = ctx.new_page()
        page.goto(BASE + "/create")
        page.set_input_files("#video-file", VIDEO)
        page.get_by_role("button", name="使う範囲を選ぶへ進む").click(timeout=120000)
        page.wait_for_url("**/create/cut", timeout=120000)
        for path in PAGES:
            page.goto(BASE + path)
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(2500)
            result = page.evaluate(OVERFLOW_JS)
            name = f"{w}x{h}{path.replace('/', '_') or '_top'}"
            page.screenshot(path=os.path.join(OUT, name + ".png"), full_page=True)
            bad = result["pageScroll"] or result["offenders"] or result["timelineOverflow"]
            failed = failed or bool(bad)
            print(("NG " if bad else "OK ") + name, json.dumps(result, ensure_ascii=False))
        ctx.close()
    browser.close()
sys.exit(1 if failed else 0)
```

`/edit/export` は開くと書き出しが自動で始まるため、スクリーンショット後すぐ次の幅へ進む(書き出しの完了は待たない)。

- [ ] **Step 2: 検査を実行する**

Run: `PYTHONIOENCODING=utf-8 python <スクラッチパッド>/layout-audit.py`
Expected: 全行が `OK`(ページの横スクロールなし・はみ出し要素なし・拡大前のタイムラインに横スクロールなし)。`/edit` と `/create/cut` は `docHeight` が画面の高さと同じ(縦スクロールなし)。

`NG` が出たら、`offenders` に出たクラス名の要素を直して再実行する。

- [ ] **Step 3: スクリーンショットを目で確認する**

`audit/` の画像のうち、少なくとも次をReadツールで開いて、モックアップ(①〜⑪)と見比べる。
- `390x844_edit.png`、`390x844_create_cut.png`、`390x844_create_style.png`、`390x844_create_auto-edit.png`
- `820x1180_edit.png`、`1180x820_edit.png`、`1440x900_edit.png`
- `390x844_top.png`(今のトップと同じタイトル・手順カードであること)

- [ ] **Step 4: 設計書に実装で決めた差分を反映する**

設計書の該当箇所を次のとおり直す。
- 5章「操作ボタン」: 「選択中クリップの削除は、選択時に出る設定シート内に置く」→「スマホのカットタブでは5個目に『設定』ボタンを置き、選択中クリップの設定(複製・結合・削除・音量)をシートで開く」
- 5章「設定パネル」: 「タイムライン上のクリップ・音声を押すと、設定シートが下からせり上がる」→「タブを押すか、カット以外のタブでタイムラインの下に出る『〜の設定を開く』を押すと、設定シートが下からせり上がる(クリップを押した瞬間に開くと、ドラッグ中のタイムラインが隠れるため)」
- 7章「見た目の手本」: 「手本の一覧(3列のサムネイル+追加ボタン)」→「選んだ手本1つのサムネイルと『別の手本にする』(手本は今と同じく1つ)」
- 7章「書き出し」: 「動画の縮小表示」→ 削除(書き出しはブラウザ内で行う重い処理のため、書き出し中に動画を再生できるプレビューは置かない。完成後の動画表示は従来どおり)

- [ ] **Step 5: 最終確認とコミット**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: すべてエラー0件・PASS

```bash
git add docs/superpowers/specs/2026-10-02-mobile-first-layout-redesign-design.md
git commit -m "設計書に、実装で決めた設定シートの開き方と手本・書き出し画面の扱いを反映"
```
