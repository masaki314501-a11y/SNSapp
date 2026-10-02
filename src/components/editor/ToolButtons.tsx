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
