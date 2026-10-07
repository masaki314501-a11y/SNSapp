"use client";

import { useEffect, useMemo, useState } from "react";
import { uploadEditExampleMedia } from "./uploadEditExampleMedia";
import { WaitTime } from "@/components/WaitTime";
import { toFriendlyErrorMessage } from "@/lib/friendlyError";

type EditExampleListItem = {
  id: string;
  label: string;
  notes?: string;
  correctMediaFilename: string;
  rawMediaFilename?: string;
  /** AIが書いた「どんな動画か」の説明。自動編集で近い手本を選ぶときに使う。 */
  profile?: string;
  /** 正解動画の書き起こし(自動編集のお手本の答え)。ここでは中身の量だけ表示する。 */
  breakdown?: {
    clips: { overlays?: unknown[] | null; zoom?: unknown | null; sfx?: unknown[] | null }[];
    referenceNotes?: string | null;
  };
  createdAt: string;
};

/** 書き起こしの作成を待つ間、一覧を読み直す間隔と、待つのをやめるまでの時間。 */
const BREAKDOWN_POLL_INTERVAL_MS = 5000;
const BREAKDOWN_POLL_LIMIT_MS = 15 * 60 * 1000;

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
  const [submitStage, setSubmitStage] = useState<"correct" | "raw" | "registering" | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [describing, setDescribing] = useState(false);
  /** 書き起こしを作り直している学習データのid(終わるまでボタンを押せなくする)。 */
  const [breakingDownIds, setBreakingDownIds] = useState<string[]>([]);
  const missingProfileCount = examples.filter((example) => !example.profile).length;

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
      const trimmedLabel = label.trim();

      setSubmitStage("correct");
      const correctUpload = await uploadEditExampleMedia("correct", correctFile, trimmedLabel);

      let rawUpload: { filename: string; mimeType: string } | null = null;
      if (rawFile) {
        setSubmitStage("raw");
        rawUpload = await uploadEditExampleMedia("raw", rawFile, trimmedLabel);
      }

      setSubmitStage("registering");
      const res = await fetch("/api/dev/edit-examples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: trimmedLabel,
          notes: notes.trim() || undefined,
          correctMediaFilename: correctUpload.filename,
          correctMimeType: correctUpload.mimeType,
          rawMediaFilename: rawUpload?.filename,
          rawMimeType: rawUpload?.mimeType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "登録に失敗しました");

      setExamples((prev) => [data.example as EditExampleListItem, ...prev]);
      setLabel("");
      setNotes("");
      setCorrectFile(null);
      setRawFile(null);
    } catch (error) {
      setSubmitError(toFriendlyErrorMessage(error, "登録に失敗しました"));
    } finally {
      setSubmitting(false);
      setSubmitStage(null);
    }
  };

  const submitLabel =
    submitStage === "correct"
      ? "正解動画をアップロード中..."
      : submitStage === "raw"
        ? "学習動画をアップロード中..."
        : submitStage === "registering"
          ? "登録中(AIが動画の特徴を読み取っています)..."
          : "登録";

  const handleDescribeMissing = async () => {
    setDescribing(true);
    try {
      const res = await fetch("/api/dev/edit-examples/describe", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "説明の作成に失敗しました");
      setExamples(data.examples as EditExampleListItem[]);
      if (data.failed > 0) alert(`${data.failed}件は説明を作れませんでした。時間をおいてもう一度お試しください`);
    } catch (error) {
      alert(toFriendlyErrorMessage(error, "説明の作成に失敗しました"));
    } finally {
      setDescribing(false);
    }
  };

  /** 正解動画の書き起こしを作り直す。裏で作るので、一覧を読み直して書き起こしが新しくなるのを待つ。 */
  const handleBreakdown = async (example: EditExampleListItem) => {
    setBreakingDownIds((prev) => [...prev, example.id]);
    const before = JSON.stringify(example.breakdown ?? null);
    try {
      const res = await fetch(`/api/dev/edit-examples/${example.id}/breakdown`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "書き起こしを始められませんでした");
      for (let waited = 0; waited < BREAKDOWN_POLL_LIMIT_MS; waited += BREAKDOWN_POLL_INTERVAL_MS) {
        await new Promise((resolve) => setTimeout(resolve, BREAKDOWN_POLL_INTERVAL_MS));
        const listRes = await fetch("/api/dev/edit-examples");
        const list = (await listRes.json()).examples as EditExampleListItem[];
        const updated = list.find((item) => item.id === example.id);
        if (updated && JSON.stringify(updated.breakdown ?? null) !== before) {
          setExamples(list);
          return;
        }
      }
      alert("書き起こしが時間内に終わりませんでした。サーバーのログを確認してください");
    } catch (error) {
      alert(toFriendlyErrorMessage(error, "書き起こしに失敗しました"));
    } finally {
      setBreakingDownIds((prev) => prev.filter((id) => id !== example.id));
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
      alert(toFriendlyErrorMessage(error, "削除に失敗しました"));
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
          {submitLabel}
        </button>
      </div>

      <div className="panel flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <span className="step-badge">{examples.length}</span>
          <h2 className="text-sm font-semibold">登録済みの編集例</h2>
          <span className="text-xs" style={{ color: "var(--muted-2)" }}>
            自動編集では、今回の動画に近いもの最大3件を、学習動画と正解動画のペアで手本として見せます
            (近さはAIが書いた「どんな動画か」の説明で判断します)
          </span>
          {examples.length > 0 ? (
            <a
              href="/api/dev/edit-examples/export"
              download="examples.json"
              className="badge-pill w-fit"
            >
              examples.jsonをダウンロード
            </a>
          ) : null}
        </div>
        {missingProfileCount > 0 ? (
          <button
            type="button"
            onClick={() => void handleDescribeMissing()}
            disabled={describing}
            className="btn-outline w-fit px-3 py-1 text-xs"
          >
            {describing
              ? "AIが動画の特徴を読み取っています..."
              : `説明が無い${missingProfileCount}件の説明を作る(近い手本を選ぶのに使います)`}
          </button>
        ) : null}
        <p className="text-xs" style={{ color: "var(--muted-2)" }}>
          本番(Render)で登録した場合、ここでの保存はデプロイのたびに消えます。残したい場合は
          「examples.jsonをダウンロード」と各動画の「ダウンロード」を取得し、ローカルの
          <code>data/edit-examples/</code>(examples.jsonと media/correct・media/raw)に
          同じファイル名で配置してgitコミットしてください。
        </p>

        {examples.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--muted-2)" }}>まだ登録がありません</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {examples.map((example) => (
              <li key={example.id} className="preset-card flex flex-col gap-2 p-3">
                <span className="font-semibold text-xs">{example.label}</span>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs" style={{ color: "var(--muted-2)" }}>正解動画</span>
                    <a
                      href={`/api/dev/edit-examples/${example.id}/media?which=correct`}
                      download={example.correctMediaFilename}
                      className="text-xs underline"
                    >
                      ダウンロード
                    </a>
                  </div>
                  <video
                    src={`/api/dev/edit-examples/${example.id}/media?which=correct`}
                    controls
                    className="h-32 w-full rounded-lg object-cover"
                  />
                </div>
                {example.rawMediaFilename ? (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs" style={{ color: "var(--muted-2)" }}>学習動画</span>
                      <a
                        href={`/api/dev/edit-examples/${example.id}/media?which=raw`}
                        download={example.rawMediaFilename}
                        className="text-xs underline"
                      >
                        ダウンロード
                      </a>
                    </div>
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
                <p className="text-xs" style={{ color: "var(--muted-2)" }}>
                  {example.profile ? `AIが読み取った特徴: ${example.profile}` : "特徴の説明: まだありません"}
                </p>
                {example.rawMediaFilename ? (
                  <div className="flex flex-col gap-1">
                    <p className="text-xs" style={{ color: "var(--muted-2)" }}>
                      {example.breakdown
                        ? `正解動画の書き起こし: あり(カット${example.breakdown.clips.length}個・文字${example.breakdown.clips.reduce(
                            (sum, clip) => sum + (clip.overlays?.length ?? 0),
                            0
                          )}個・寄り${example.breakdown.clips.filter((clip) => clip.zoom).length}か所・効果音${example.breakdown.clips.reduce(
                            (sum, clip) => sum + (clip.sfx?.length ?? 0),
                            0
                          )}個)${example.breakdown.referenceNotes ? ` / ${example.breakdown.referenceNotes}` : ""}`
                        : "正解動画の書き起こし: まだありません(次の自動編集のときに自動で作ります)"}
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleBreakdown(example)}
                      disabled={breakingDownIds.includes(example.id)}
                      className="btn-outline w-fit px-3 py-1 text-xs"
                    >
                      {breakingDownIds.includes(example.id)
                        ? "書き起こし中...(数分かかります)"
                        : example.breakdown
                          ? "書き起こしを作り直す"
                          : "書き起こしを今作る"}
                    </button>
                    <WaitTime task="example-breakdown" units={1} active={breakingDownIds.includes(example.id)} />
                  </div>
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
