import {
  CaptionIcon,
  CheckCircleIcon,
  MusicIcon,
  ScissorsIcon,
  SparkleIcon,
  SpeakerIcon,
  type IconProps,
} from "@/components/icons";

// 「AI音声」は字幕タブに、「見た目」は字幕タブ(字幕の見た目)と演出タブ(全体のフェード)にまとめた。
export type EditorTab = "cut" | "caption" | "effects" | "se" | "bgm";

export const EDITOR_TAB_LABELS: Record<EditorTab, string> = {
  cut: "カット",
  caption: "字幕",
  effects: "演出",
  se: "効果音",
  bgm: "BGM",
};

const TABS: { id: EditorTab; Icon: React.FC<IconProps> }[] = [
  { id: "cut", Icon: ScissorsIcon },
  { id: "caption", Icon: CaptionIcon },
  { id: "effects", Icon: SparkleIcon },
  { id: "se", Icon: SpeakerIcon },
  { id: "bgm", Icon: MusicIcon },
];

/**
 * 編集画面のタブ。末尾に、編集を終えて書き出し画面へ進む赤い「編集完了」を置く
 * (以前は上部バーの「書き出す」だったが、最後に押すボタンだと気付きにくかった)。スマホ・タブレット縦向きでは画面下端に等分で、1024px以上では左端に縦に並ぶ
 * (並び方はeditor-theme.cssの.editor-tabbarで切り替える)。以前の横並びの文字タブは
 * スマホ幅からはみ出し、横スクロールしないと「AI音声」以降が見えなかった。
 */
export const EditorTabBar: React.FC<{
  active: EditorTab;
  onSelect: (tab: EditorTab) => void;
  /** 「編集完了」を押した時(書き出し画面へ進む)。 */
  onFinish: () => void;
  canFinish: boolean;
  className?: string;
}> = ({ active, onSelect, onFinish, canFinish, className }) => (
  <nav aria-label="編集メニュー" className={`editor-tabbar${className ? ` ${className}` : ""}`}>
    {TABS.map(({ id, Icon }) => (
      <button
        key={id}
        type="button"
        className={`editor-tabbar-btn${active === id ? " active" : ""}`}
        aria-current={active === id ? "page" : undefined}
        onClick={() => onSelect(id)}
      >
        <Icon size={22} />
        <span>{EDITOR_TAB_LABELS[id]}</span>
      </button>
    ))}
    <button
      type="button"
      className="editor-tabbar-btn finish"
      onClick={onFinish}
      disabled={!canFinish}
      title="編集を終えて、書き出し画面へ進みます"
    >
      <CheckCircleIcon size={22} />
      <span>編集完了</span>
    </button>
  </nav>
);
