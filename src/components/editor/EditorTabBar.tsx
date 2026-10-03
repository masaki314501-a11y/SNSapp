import {
  CaptionIcon,
  MicIcon,
  MusicIcon,
  PaletteIcon,
  ScissorsIcon,
  SparkleIcon,
  SpeakerIcon,
  type IconProps,
} from "@/components/icons";

export type EditorTab = "cut" | "caption" | "effects" | "se" | "narration" | "bgm" | "style";

export const EDITOR_TAB_LABELS: Record<EditorTab, string> = {
  cut: "カット",
  caption: "字幕",
  effects: "演出",
  se: "効果音",
  narration: "AI音声",
  bgm: "BGM",
  style: "見た目",
};

const TABS: { id: EditorTab; Icon: React.FC<IconProps> }[] = [
  { id: "cut", Icon: ScissorsIcon },
  { id: "caption", Icon: CaptionIcon },
  { id: "effects", Icon: SparkleIcon },
  { id: "se", Icon: SpeakerIcon },
  { id: "narration", Icon: MicIcon },
  { id: "bgm", Icon: MusicIcon },
  { id: "style", Icon: PaletteIcon },
];

/**
 * 編集画面のタブ。スマホ・タブレット縦向きでは画面下端に7等分で、1024px以上では左端に縦に並ぶ
 * (並び方はeditor-theme.cssの.editor-tabbarで切り替える)。以前の横並びの文字タブは
 * スマホ幅からはみ出し、横スクロールしないと「AI音声」以降が見えなかった。
 */
export const EditorTabBar: React.FC<{
  active: EditorTab;
  onSelect: (tab: EditorTab) => void;
  className?: string;
}> = ({ active, onSelect, className }) => (
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
  </nav>
);
