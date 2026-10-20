import { useId, type ButtonHTMLAttributes, type MouseEventHandler } from 'react';
import { Icon, type IconName } from './Icon.tsx';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly icon: IconName;
  readonly label: string;
  readonly round?: boolean;
  readonly disabledReason?: string;
}

export function IconButton({ icon, label, round, disabledReason, className, disabled, title, onClick, ...rest }: IconButtonProps) {
  const blocked = disabled === true;
  const reasonId = useId();
  // Same aria-disabled pattern as Button (GLB-13): the reason must be reachable
  // for keyboard users, not only through the pointer-only title attribute.
  const explain = blocked && disabledReason !== undefined && disabledReason.length > 0;
  const handleClick: MouseEventHandler<HTMLButtonElement> = (event) => {
    if (blocked) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  };
  const classes = ['icon-btn', round === true ? 'round' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <>
      <button
        {...rest}
        type={rest.type ?? 'button'}
        className={classes}
        aria-label={label}
        title={blocked ? (disabledReason ?? title) : (title ?? label)}
        disabled={explain ? undefined : blocked}
        aria-disabled={blocked || undefined}
        aria-describedby={explain ? reasonId : rest['aria-describedby']}
        onClick={handleClick}
      >
        <Icon name={icon} />
      </button>
      {explain ? (
        <span id={reasonId} className="sr">
          {disabledReason}
        </span>
      ) : null}
    </>
  );
}
