import { ChevronDownIcon } from "@/components/icons";

/**
 * 設定パネル内の小見出し付きのまとまり。左の縦線と上の区切り線で、どこからどこまでが
 * 同じ設定かを分かりやすくする(以前は小さな太字だけで、まとまりの境目が見分けにくかった)。
 */
export const SettingsSection: React.FC<{
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, children }) => (
  <section className="settings-section">
    <h3 className="settings-section-title">
      {icon}
      {title}
    </h3>
    <div className="settings-section-body">{children}</div>
  </section>
);

/**
 * 押すと開く折りたたみ。強調テキスト・画像などを1つずつ畳んで並べ、見出しには中身(文言等)を出す。
 * 基本は閉じておき、追加した直後など開いて見せたい時だけ defaultOpen にする。
 */
export const Collapsible: React.FC<{
  summary: React.ReactNode;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ summary, icon, defaultOpen, children }) => (
  <details className="collapsible" open={defaultOpen}>
    <summary>
      {icon}
      <span className="collapsible-summary-text">{summary}</span>
      <ChevronDownIcon size={18} className="collapsible-chevron" />
    </summary>
    <div className="collapsible-body">{children}</div>
  </details>
);
