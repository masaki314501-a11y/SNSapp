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
