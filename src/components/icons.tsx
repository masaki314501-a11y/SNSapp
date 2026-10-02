export type IconProps = {
  size?: number;
  className?: string;
};

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** 絵文字ではなく、ブランドの縁取りに馴染む線画アイコンとして使う最小限のアイコンセット。 */
export const MicIcon: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10a7 7 0 0 0 14 0" />
    <path d="M12 19v3" />
    <path d="M8 22h8" />
  </svg>
);

const Svg: React.FC<IconProps & { children: React.ReactNode; filled?: boolean }> = ({
  size = 20,
  className,
  children,
  filled,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    aria-hidden="true"
    {...(filled ? { fill: "currentColor" } : base)}
  >
    {children}
  </svg>
);

export const BackIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M15 18l-6-6 6-6" />
  </Svg>
);
export const ChevronRightIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);
export const MoreIcon: React.FC<IconProps> = (p) => (
  <Svg {...p} filled>
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </Svg>
);
export const SparkleIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
  </Svg>
);
export const PlayIcon: React.FC<IconProps> = (p) => (
  <Svg {...p} filled>
    <polygon points="7 4 20 12 7 20" />
  </Svg>
);
export const PauseIcon: React.FC<IconProps> = (p) => (
  <Svg {...p} filled>
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </Svg>
);
export const UndoIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
  </Svg>
);
export const RedoIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 000 11H13" />
  </Svg>
);
export const ScissorsIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M20 4L8.12 15.88" />
    <path d="M14.47 14.48L20 20" />
    <path d="M8.12 8.12L12 12" />
  </Svg>
);
export const TrimStartIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M6 4v16" />
    <path d="M10 12h10" />
    <path d="M16 8l4 4-4 4" />
  </Svg>
);
export const TrimEndIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M18 4v16" />
    <path d="M14 12H4" />
    <path d="M8 8l-4 4 4 4" />
  </Svg>
);
export const PlusIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Svg>
);
export const TrashIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="M6 7l1 13h10l1-13" />
  </Svg>
);
export const CaptionIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M7 11h10" />
    <path d="M7 15h6" />
  </Svg>
);
export const SpeakerIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M11 5L6 9H3v6h3l5 4z" />
    <path d="M15.5 8.5a5 5 0 010 7" />
    <path d="M18.5 5.5a9 9 0 010 13" />
  </Svg>
);
export const MusicIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M9 18V5l11-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="17" cy="16" r="3" />
  </Svg>
);
export const PaletteIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="8.5" cy="10" r="1.2" />
    <circle cx="12" cy="7.5" r="1.2" />
    <circle cx="15.5" cy="10" r="1.2" />
    <path d="M12 21a3 3 0 010-6h3" />
  </Svg>
);
export const SettingsIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M4 6h10" />
    <path d="M18 6h2" />
    <circle cx="16" cy="6" r="2" />
    <path d="M4 12h2" />
    <path d="M10 12h10" />
    <circle cx="8" cy="12" r="2" />
    <path d="M4 18h10" />
    <path d="M18 18h2" />
    <circle cx="16" cy="18" r="2" />
  </Svg>
);
export const UploadIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M12 16V4" />
    <path d="M7 9l5-5 5 5" />
    <path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
  </Svg>
);
export const InfoIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5" />
    <path d="M12 16.5v.01" />
  </Svg>
);
