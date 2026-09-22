type IconProps = {
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

export const KeyIcon: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12 20 3" />
    <path d="M16 8l3 3" />
    <path d="M13 11l2.5 2.5" />
  </svg>
);
