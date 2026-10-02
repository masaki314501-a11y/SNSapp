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
