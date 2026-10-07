"use client";

import { useState } from "react";
import { MoreIcon } from "@/components/icons";

export type MenuItem = {
  key: string;
  label: string;
  /** 何が起きるかの一行説明(選択肢の違いが分かるように)。 */
  description?: string;
  icon?: React.ReactNode;
  /** 取り消せない操作など、赤字で出す項目。 */
  danger?: boolean;
  onClick?: () => void;
  /** 指定するとファイル選択になる(「保存した編集データを開く」用)。 */
  onFile?: (file: File | null) => void;
  accept?: string;
  /** 押した後もメニューを開いたままにする(「コピーしました」等の結果をその場で見せる時)。 */
  keepOpen?: boolean;
};

/**
 * 上部バー右の「…」メニュー。以前は画面上部に並べていた、たまにしか使わない操作
 * (やり直し・編集データの保存/読み込み・自動編集を試す)と動画の情報をここにまとめる。
 * スマホでは画面の下からせり上がるシート、768px以上ではボタンの下に出る(editor-theme.css)。
 * 以前はボタンの右端に揃えて出していたため、スマホでは画面の左外にはみ出していた。
 */
export const EditorMenu: React.FC<{ items: MenuItem[]; footer?: React.ReactNode }> = ({ items, footer }) => {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const content = (item: MenuItem) => (
    <>
      {item.icon ? <span className="editor-menu-icon">{item.icon}</span> : null}
      <span className="editor-menu-text">
        <span className="editor-menu-label">{item.label}</span>
        {item.description ? <span className="editor-menu-description">{item.description}</span> : null}
      </span>
    </>
  );

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
            <div className="editor-menu-handle" aria-hidden="true" />
            {items.map((item) =>
              item.onFile ? (
                <label key={item.key} className={`editor-menu-item${item.danger ? " danger" : ""}`} role="menuitem">
                  {content(item)}
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
                  className={`editor-menu-item${item.danger ? " danger" : ""}`}
                  onClick={() => {
                    if (!item.keepOpen) close();
                    item.onClick?.();
                  }}
                >
                  {content(item)}
                </button>
              )
            )}
            {footer ? <div className="editor-menu-footer">{footer}</div> : null}
            <button type="button" className="editor-menu-cancel" onClick={close}>
              閉じる
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
};
