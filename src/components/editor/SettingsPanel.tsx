import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "@/components/icons";

export type ClipNav = {
  /** 例: 「場面2 / 5」「場面を選んでいません」 */
  label: string;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
};

type SettingsPanelProps = {
  title: string;
  /** 対象の場面等(例: 「場面2」)。clipNavを渡した時は使わない。 */
  subtitle?: string;
  /** 場面ごとの設定(カット・字幕・演出)で、パネルを閉じずに前後の場面へ移るための切り替え。 */
  clipNav?: ClipNav;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
};

/**
 * 各タブの設定(既存のInspectorPanel)の入れ物。スマホでは画面下からせり上がるシート、
 * タブレット縦向きではタイムラインの下、1024px以上では右側に常に表示される
 * (出し分けはeditor-theme.cssの.editor-settings)。「閉じる」はシートの時だけ見える。
 */
export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  title,
  subtitle,
  clipNav,
  onClose,
  children,
  className,
}) => (
  <section aria-label={title} className={`editor-settings${className ? ` ${className}` : ""}`}>
    <div className="editor-settings-handle" aria-hidden="true" />
    <div className="editor-settings-header">
      <div className="editor-settings-title">
        <h2>{title}</h2>
        {!clipNav && subtitle ? <span>{subtitle}</span> : null}
      </div>
      {clipNav ? (
        <div className="clip-nav">
          <button type="button" onClick={clipNav.onPrev} disabled={!clipNav.canPrev} aria-label="前の場面">
            <ChevronLeftIcon size={18} />
          </button>
          <span>{clipNav.label}</span>
          <button type="button" onClick={clipNav.onNext} disabled={!clipNav.canNext} aria-label="次の場面">
            <ChevronRightIcon size={18} />
          </button>
        </div>
      ) : null}
      <button type="button" className="editor-settings-close" onClick={onClose}>
        <CloseIcon size={16} />
        閉じる
      </button>
    </div>
    <div className="editor-settings-body">{children}</div>
  </section>
);
