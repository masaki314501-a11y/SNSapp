"use client";

import { useEffect, useMemo, useState } from "react";

type EditExampleListItem = {
  id: string;
  label: string;
  notes?: string;
  correctMediaFilename: string;
  rawMediaFilename?: string;
  createdAt: string;
};

type Props = {
  /** 初期一覧はサーバー側(page.tsx)でファイルシステムから直接読んで渡す(マウント時fetch不要)。 */
  initialExamples: EditExampleListItem[];
};

export const EditExamplesManager: React.FC<Props> = ({ initialExamples }) => {
  const [examples, setExamples] = useState<EditExampleListItem[]>(initialExamples);

  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [correctFile, setCorrectFile] = useState<File | null>(null);
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const correctPreviewUrl = useMemo(() => (correctFile ? URL.createObjectURL(correctFile) : null), [correctFile]);
  const rawPreviewUrl = useMemo(() => (rawFile ? URL.createObjectURL(rawFile) : null), [rawFile]);
  useEffect(() => {
    return () => {
      if (correctPreviewUrl) URL.revokeObjectURL(correctPreviewUrl);
    };
  }, [correctPreviewUrl]);
  useEffect(() => {
    return () => {
      if (rawPreviewUrl) URL.revokeObjectURL(rawPreviewUrl);
    };
  }, [rawPreviewUrl]);

  const handleSubmit = async () => {
    if (!correctFile || !label.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const formData = new FormData();
      formData.append("label", label.trim());
      if (notes.trim()) formData.append("notes", notes.trim());
      formData.append("correct", correctFile);
      if (rawFile) formData.append("raw", rawFile);

      const res = await fetch("/api/dev/edit-examples", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "登録に失敗しました");

      setExamples((prev) => [data.example as EditExampleListItem, ...prev]);
      setLabel("");
      setNotes("");
      setCorrectFile(null);
      setRawFile(null);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "登録に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("この編集例を削除しますか?")) return;
    try {
      const res = await fetch(`/api/dev/edit-examples/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "削除に失敗しました");
      setExamples((prev) => prev.filter((example) => example.id !== id));
    } catch (error) {
      alert(error instanceof Error ? error.message : "削除に失敗しました");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex flex-col gap-3 p-5">
        <div className="flex items-baseline gap-2.5">
          <span className="step-badge">+</span>
          <h2 className="text-sm font-semibold">編集例を登録</h2>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="field-label">ラベル(必須・ファイル名にも使われます)</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例: カフェ紹介・冒頭フック強め"
            className="field-input"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="field-label">正解動画(必須・完成度の高い参考動画)</span>
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/x-m4v"
            onChange={(e) => setCorrectFile(e.target.files?.[0] ?? null)}
            className="field-input"
          />
        </label>
        {correctPreviewUrl ? (
          <video src={correctPreviewUrl} controls className="max-h-64 w-auto rounded-lg" />
        ) : null}

        <label className="flex flex-col gap-1.5">
          <span className="field-label">学習動画(任意・上の正解動画のもとになった生素材)</span>
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/x-m4v"
            onChange={(e) => setRawFile(e.target.files?.[0] ?? null)}
            className="field-input"
          />
        </label>
        {rawPreviewUrl ? <video src={rawPreviewUrl} controls className="max-h-64 w-auto rounded-lg" /> : null}

        <label className="flex flex-col gap-1.5">
          <span className="field-label">メモ(任意・何が良い編集なのか。few-shotのヒントとしてそのまま使われます)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="例: 冒頭2秒でフックを出し、テンポよくカットが切り替わる"
            className="field-input"
            rows={2}
          />
        </label>

        {submitError ? <p className="badge-pill danger w-fit">{submitError}</p> : null}
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!correctFile || !label.trim() || submitting}
          className="btn-primary w-fit px-4 py-1.5 text-sm"
        >
          {submitting ? "登録中..." : "登録"}
        </button>
      </div>

      <div className="panel flex flex-col gap-3 p-5">
        <div className="flex items-baseline gap-2.5">
          <span className="step-badge">{examples.length}</span>
          <h2 className="text-sm font-semibold">登録済みの編集例</h2>
          <span className="text-xs" style={{ color: "var(--muted-2)" }}>
            自動編集では新しいものから最大2件をfew-shot例として使用します
          </span>
        </div>

        {examples.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--muted-2)" }}>まだ登録がありません</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {examples.map((example) => (
              <li key={example.id} className="preset-card flex flex-col gap-2 p-3">
                <span className="font-semibold text-xs">{example.label}</span>
                <div className="flex flex-col gap-1">
                  <span className="text-xs" style={{ color: "var(--muted-2)" }}>正解動画</span>
                  <video
                    src={`/api/dev/edit-examples/${example.id}/media?which=correct`}
                    controls
                    className="h-32 w-full rounded-lg object-cover"
                  />
                </div>
                {example.rawMediaFilename ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs" style={{ color: "var(--muted-2)" }}>学習動画</span>
                    <video
                      src={`/api/dev/edit-examples/${example.id}/media?which=raw`}
                      controls
                      className="h-32 w-full rounded-lg object-cover"
                    />
                  </div>
                ) : null}
                {example.notes ? (
                  <p className="text-xs" style={{ color: "var(--muted)" }}>{example.notes}</p>
                ) : null}
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
