"use client";

import { useEffect, useState } from "react";
import { KeyIcon } from "@/components/icons";
import { clearStoredGeminiApiKey, getStoredGeminiApiKey, setStoredGeminiApiKey } from "@/lib/geminiApiKeyClient";

/**
 * 各自の無料Geminiキーをブラウザに設定するための、全画面共通の設定パネル。
 * 未設定でも今までどおり共有の枠で動くため、右下の小さいボタンから任意に開く形にしている。
 */
export const GeminiApiKeySettings: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // localStorageはサーバーには存在しないため、初回描画(サーバー/クライアント共通)は
  // 必ずfalseにし、マウント後にここで読み込む(ClipEditor.tsxのプロジェクト読み込みと
  // 同じ理由で、遅延初期化ではなくuseEffectで行う)。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorageからの一度きりの初期ハイドレーション
    setHasStoredKey(Boolean(getStoredGeminiApiKey()));
  }, []);

  const handleOpen = () => {
    const stored = getStoredGeminiApiKey();
    setInputValue(stored);
    setHasStoredKey(Boolean(stored));
    setSavedMessage(null);
    setIsOpen(true);
  };

  const handleSave = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    setStoredGeminiApiKey(trimmed);
    setHasStoredKey(true);
    setSavedMessage("保存しました。次回のAI機能利用から、このキーが使われます");
  };

  const handleClear = () => {
    clearStoredGeminiApiKey();
    setInputValue("");
    setHasStoredKey(false);
    setSavedMessage("削除しました。以後は共有の枠を使います");
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="btn-outline fixed right-4 bottom-4 z-40 flex items-center gap-1.5 px-3 py-2 text-xs"
      >
        <KeyIcon size={14} />
        {hasStoredKey ? "自分のAPIキー設定済み" : "AIの無料枠について"}
      </button>

      {isOpen ? (
        <div className="modal-backdrop" onClick={() => setIsOpen(false)}>
          <div className="modal-panel flex flex-col gap-3 p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-semibold">自分のGemini APIキーを使う(任意)</h2>
            <p className="text-xs" style={{ color: "var(--muted-2)" }}>
              このアプリのAI機能は無料枠を使っており、みんなで共有している分すぐに上限に
              達することがあります。自分の無料キーを設定すると、その分は自分専用の枠で
              動くようになります。未設定でもこれまでどおり使えます。
            </p>
            <p className="text-xs" style={{ color: "var(--muted-2)" }}>
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Google AI Studio
              </a>
              で無料のAPIキーを取得できます(Googleアカウントのみで発行可能)。
            </p>
            <input
              type="password"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="AIza... から始まるキーを貼り付け"
              className="field-input"
              autoComplete="off"
              spellCheck={false}
            />
            {savedMessage ? (
              <p className="text-xs" style={{ color: "var(--success)" }}>
                {savedMessage}
              </p>
            ) : null}
            <p className="text-xs" style={{ color: "var(--muted-2)" }}>
              キーはこの端末のブラウザにのみ保存され、サーバーには保存されません。
            </p>
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={handleClear} disabled={!hasStoredKey} className="btn-ghost text-xs">
                削除して共有の枠に戻す
              </button>
              <button type="button" onClick={() => setIsOpen(false)} className="btn-ghost text-xs">
                閉じる
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!inputValue.trim()}
                className="btn-primary px-4 py-1.5 text-sm"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};
