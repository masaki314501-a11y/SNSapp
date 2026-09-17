"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CAPTION_ANIMATION_OPTIONS,
  CAPTION_FONT_FAMILY_OPTIONS,
  CAPTION_POSITION_OPTIONS,
  CAPTION_STYLE_OPTIONS,
  type CaptionAnimation,
  type CaptionFontFamily,
  type CaptionPosition,
  type CaptionStyle,
} from "@video/shared/schema";

type CorrectStyle = {
  primaryColor: string;
  fontFamily: CaptionFontFamily;
  captionPosition: CaptionPosition;
  captionStyle: CaptionStyle;
  captionAnimation: CaptionAnimation;
};

type StyleExampleListItem = {
  id: string;
  kind: "image" | "video";
  correctStyle: {
    primaryColor: string;
    fontFamily: string;
    captionPosition: string;
    captionStyle: string;
    captionAnimation: string;
  };
  label?: string;
  createdAt: string;
};

const DEFAULT_CORRECT_STYLE: CorrectStyle = {
  primaryColor: "#FF3366",
  fontFamily: CAPTION_FONT_FAMILY_OPTIONS[0].value,
  captionPosition: CAPTION_POSITION_OPTIONS[CAPTION_POSITION_OPTIONS.length - 1].value,
  captionStyle: CAPTION_STYLE_OPTIONS[0].value,
  captionAnimation: CAPTION_ANIMATION_OPTIONS[0].value,
};

const labelFor = (options: { value: string; label: string }[], value: string): string =>
  options.find((option) => option.value === value)?.label ?? value;

type Props = {
  /** 初期一覧はサーバー側(page.tsx)でファイルシステムから直接読んで渡す(マウント時fetch不要)。 */
  initialExamples: StyleExampleListItem[];
  initialInboxFileCount: number;
};

export const StyleExamplesManager: React.FC<Props> = ({ initialExamples, initialInboxFileCount }) => {
  const [examples, setExamples] = useState<StyleExampleListItem[]>(initialExamples);
  const [inboxFileCount, setInboxFileCount] = useState(initialInboxFileCount);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [correctStyle, setCorrectStyle] = useState<CorrectStyle>(DEFAULT_CORRECT_STYLE);
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** 「今のAIならどう読むか」の結果。フォームの下書きにしつつ、人が直した箇所の対比にも使う。 */
  const [suggested, setSuggested] = useState<CorrectStyle | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const selectFile = (next: File | null) => {
    setFile(next);
    setSuggested(null);
    setSuggestError(null);
  };

  /**
   * 素材をそのまま今の抽出にかけ、結果をフォームに流し込む。全項目を手入力するのではなく
   * 「AIが外したところだけ直す」流れにするのが狙い。差分はそのまま、今の抽出の弱点になる。
   */
  const handleSuggest = async () => {
    if (!file) return;
    setSuggesting(true);
    setSuggestError(null);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/dev/style-examples/suggest", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "抽出に失敗しました");
      const style = data.style as CorrectStyle;
      setSuggested(style);
      setCorrectStyle(style);
    } catch (error) {
      setSuggestError(error instanceof Error ? error.message : "抽出に失敗しました");
    } finally {
      setSuggesting(false);
    }
  };

  const correctedFields = suggested
    ? (Object.keys(correctStyle) as (keyof CorrectStyle)[]).filter((key) => correctStyle[key] !== suggested[key])
    : [];

  /** 人が直した項目にだけ「AIは何と答えたか」を添える(何を教え込もうとしているかが見えるように)。 */
  const suggestionNote = (key: keyof CorrectStyle, options?: { value: string; label: string }[]) =>
    suggested && suggested[key] !== correctStyle[key] ? (
      <span className="text-xs" style={{ color: "var(--muted-2)" }}>
        AIの判定: {options ? labelFor(options, suggested[key]) : suggested[key]}
      </span>
    ) : null;

  const handleSubmit = async () => {
    if (!file) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("correctStyle", JSON.stringify(correctStyle));
      if (label.trim()) formData.append("label", label.trim());

      const res = await fetch("/api/dev/style-examples", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "登録に失敗しました");

      setExamples((prev) => [data.example as StyleExampleListItem, ...prev]);
      selectFile(null);
      setLabel("");
      setCorrectStyle(DEFAULT_CORRECT_STYLE);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "登録に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("この正解データを削除しますか?")) return;
    try {
      const res = await fetch(`/api/dev/style-examples/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "削除に失敗しました");
      setExamples((prev) => prev.filter((example) => example.id !== id));
    } catch (error) {
      alert(error instanceof Error ? error.message : "削除に失敗しました");
    }
  };

  const handleImportFromInbox = async () => {
    setImporting(true);
    setImportMessage(null);
    try {
      const res = await fetch("/api/dev/style-examples/import", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "取り込みに失敗しました");

      const imported = data.imported as { fileName: string; id: string }[];
      const skipped = data.skipped as { fileName: string; reason: string }[];
      setExamples(data.examples as StyleExampleListItem[]);
      setInboxFileCount((prev) => Math.max(0, prev - imported.length));
      setImportMessage(
        `${imported.length}件取り込みました` +
          (skipped.length > 0
            ? ` / ${skipped.length}件スキップ: ${skipped.map((s) => `${s.fileName}(${s.reason})`).join(", ")}`
            : "")
      );
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "取り込みに失敗しました");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex flex-col gap-3 p-5">
        <div className="flex items-baseline gap-2.5">
          <span className="step-badge">+</span>
          <h2 className="text-sm font-semibold">正解データを登録</h2>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="field-label">参考画像 / 参考動画</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm,video/x-m4v"
            onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
            className="field-input"
          />
        </label>
        {previewUrl && file?.type.startsWith("video/") ? (
          <video src={previewUrl} controls className="max-h-64 w-auto rounded-lg" />
        ) : previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="プレビュー" className="max-h-64 w-auto rounded-lg" />
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSuggest()}
            disabled={!file || suggesting}
            className="btn-ghost px-4 py-1.5 text-sm"
            title="今のAIがこの素材をどう読むかを下書きとして入れます(動画は1分ほどかかります)"
          >
            {suggesting ? "AIが判定中..." : "🤖 今のAIの判定を下書きにする"}
          </button>
          {suggested ? (
            <span className={`badge-pill ${correctedFields.length === 0 ? "success" : "neutral"}`}>
              {correctedFields.length === 0
                ? "AIの判定と一致(この素材は既に正しく読めています)"
                : `AIが外した項目: ${correctedFields.length}件`}
            </span>
          ) : null}
        </div>
        {suggestError ? <p className="badge-pill danger w-fit">{suggestError}</p> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="field-label">primaryColor(この画像なら本来こう抽出してほしい色)</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={correctStyle.primaryColor}
                onChange={(e) => setCorrectStyle((prev) => ({ ...prev, primaryColor: e.target.value }))}
              />
              <input
                type="text"
                value={correctStyle.primaryColor}
                onChange={(e) => setCorrectStyle((prev) => ({ ...prev, primaryColor: e.target.value }))}
                className="field-input"
              />
            </div>
            {suggestionNote("primaryColor")}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="field-label">fontFamily</span>
            <select
              value={correctStyle.fontFamily}
              onChange={(e) =>
                setCorrectStyle((prev) => ({ ...prev, fontFamily: e.target.value as CaptionFontFamily }))
              }
              className="field-input"
            >
              {CAPTION_FONT_FAMILY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {suggestionNote("fontFamily", CAPTION_FONT_FAMILY_OPTIONS)}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="field-label">captionPosition</span>
            <select
              value={correctStyle.captionPosition}
              onChange={(e) =>
                setCorrectStyle((prev) => ({ ...prev, captionPosition: e.target.value as CaptionPosition }))
              }
              className="field-input"
            >
              {CAPTION_POSITION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {suggestionNote("captionPosition", CAPTION_POSITION_OPTIONS)}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="field-label">captionStyle</span>
            <select
              value={correctStyle.captionStyle}
              onChange={(e) =>
                setCorrectStyle((prev) => ({ ...prev, captionStyle: e.target.value as CaptionStyle }))
              }
              className="field-input"
            >
              {CAPTION_STYLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {suggestionNote("captionStyle", CAPTION_STYLE_OPTIONS)}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="field-label">captionAnimation</span>
            <select
              value={correctStyle.captionAnimation}
              onChange={(e) =>
                setCorrectStyle((prev) => ({ ...prev, captionAnimation: e.target.value as CaptionAnimation }))
              }
              className="field-input"
            >
              {CAPTION_ANIMATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {suggestionNote("captionAnimation", CAPTION_ANIMATION_OPTIONS)}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="field-label">メモ(任意)</span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="例: 競合A社のTikTok投稿"
              className="field-input"
            />
          </label>
        </div>

        {submitError ? <p className="badge-pill danger w-fit">{submitError}</p> : null}
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!file || submitting}
          className="btn-primary w-fit px-4 py-1.5 text-sm"
        >
          {submitting ? "登録中..." : "登録"}
        </button>
      </div>

      <div className="panel flex flex-col gap-3 p-5">
        <div className="flex items-baseline gap-2.5">
          <span className="step-badge">📥</span>
          <h2 className="text-sm font-semibold">inboxから一括取り込み</h2>
        </div>
        <p className="text-xs" style={{ color: "var(--muted-2)" }}>
          <code>data/style-examples/inbox/</code> に動画・画像ファイルと{" "}
          <code>answers.json</code>(正解データ)を置いてから実行してください
          (書き方は <code>inbox/README.md</code> 参照)。
        </p>
        <div className="flex items-center gap-3">
          <span className="badge-pill neutral w-fit">inbox内のファイル: {inboxFileCount}件</span>
          <button
            type="button"
            onClick={() => void handleImportFromInbox()}
            disabled={importing}
            className="btn-primary w-fit px-4 py-1.5 text-sm"
          >
            {importing ? "取り込み中..." : "inboxから取り込み"}
          </button>
        </div>
        {importMessage ? <p className="text-xs" style={{ color: "var(--muted)" }}>{importMessage}</p> : null}
      </div>

      <div className="panel flex flex-col gap-3 p-5">
        <div className="flex items-baseline gap-2.5">
          <span className="step-badge">{examples.length}</span>
          <h2 className="text-sm font-semibold">登録済みの正解データ</h2>
          <span className="text-xs" style={{ color: "var(--muted-2)" }}>
            抽出時は新しいものから最大6件をfew-shot例として使用します
          </span>
        </div>

        {examples.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--muted-2)" }}>まだ登録がありません</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {examples.map((example) => (
              <li key={example.id} className="preset-card flex flex-col gap-2 p-3">
                {example.kind === "video" ? (
                  <video
                    src={`/api/dev/style-examples/${example.id}/media`}
                    controls
                    className="h-32 w-full rounded-lg object-cover"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/dev/style-examples/${example.id}/media`}
                    alt={example.label ?? example.id}
                    className="h-32 w-full rounded-lg object-cover"
                  />
                )}
                <div className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted)" }}>
                  {example.label ? <span className="font-semibold">{example.label}</span> : null}
                  <span>色: {example.correctStyle.primaryColor}</span>
                  <span>フォント: {labelFor(CAPTION_FONT_FAMILY_OPTIONS, example.correctStyle.fontFamily)}</span>
                  <span>位置: {labelFor(CAPTION_POSITION_OPTIONS, example.correctStyle.captionPosition)}</span>
                  <span>背景: {labelFor(CAPTION_STYLE_OPTIONS, example.correctStyle.captionStyle)}</span>
                  <span>演出: {labelFor(CAPTION_ANIMATION_OPTIONS, example.correctStyle.captionAnimation)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDelete(example.id)}
                  className="badge-pill danger w-fit"
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
