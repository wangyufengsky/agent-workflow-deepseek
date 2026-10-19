import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon.tsx';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly icon: IconName;
  readonly label: string;
  readonly round?: boolean;
  readonly disabledReason?: string;
}

export function IconButton({ icon, label, round, disabledReason, className, disabled, title, ...rest }: IconButtonProps) {
  const blocked = disabled === true;
  const classes = ['icon-btn', round === true ? 'round' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      className={classes}
      aria-label={label}
      title={blocked ? (disabledReason ?? title) : (title ?? label)}
      disabled={blocked}
    >
      <Icon name={icon} />
    </button>
  );
}
