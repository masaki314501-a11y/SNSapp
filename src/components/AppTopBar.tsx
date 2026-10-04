import Link from "next/link";
import { BackIcon } from "./icons";

type AppTopBarProps = {
  backHref: string;
  backLabel?: string;
  title: string;
  /** 作成手順の画面だけ渡す。「ステップ N / M」と進み具合のバーを出す。 */
  step?: { current: number; total: number };
  /** 進み具合のバーを出さない(編集画面は縦の余裕が無いため、ステップの文字だけにする)。 */
  hideProgress?: boolean;
  /** 右側に並べるボタン類。 */
  actions?: React.ReactNode;
  /**
   * 戻る前に処理が要る画面(編集中の内容を保存してから離れる等)で渡す。
   * 渡した場合はリンクではなくボタンになり、移動はこの関数の中で行う。
   */
  onBack?: () => void;
  className?: string;
};

/**
 * 全画面共通の上部バー。以前は画面ごとに大きな見出し+説明文を置いていたが、スマホでは
 * それだけで画面の上1/4を使っていたため、戻る・画面名・操作を1行にまとめる。
 */
export const AppTopBar: React.FC<AppTopBarProps> = ({
  backHref,
  backLabel = "戻る",
  title,
  step,
  hideProgress,
  actions,
  onBack,
  className,
}) => (
  <header className={`app-topbar${className ? ` ${className}` : ""}`}>
    <div className="app-topbar-row">
      {onBack ? (
        <button type="button" onClick={onBack} aria-label={backLabel} className="app-topbar-back">
          <BackIcon size={22} />
        </button>
      ) : (
        <Link href={backHref} aria-label={backLabel} className="app-topbar-back">
          <BackIcon size={22} />
        </Link>
      )}
      <div className="app-topbar-title">
        {step ? (
          <span className="app-topbar-step">
            ステップ {step.current} / {step.total}
          </span>
        ) : null}
        <h1>{title}</h1>
      </div>
      {actions ? <div className="app-topbar-actions">{actions}</div> : null}
    </div>
    {step && !hideProgress ? (
      <div className="app-topbar-progress" aria-hidden="true">
        {Array.from({ length: step.total }, (_, i) => (
          <span key={i} className={i < step.current ? "done" : undefined} />
        ))}
      </div>
    ) : null}
  </header>
);
