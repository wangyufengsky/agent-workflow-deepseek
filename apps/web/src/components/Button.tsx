import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { Icon, type IconName } from './Icon.tsx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'brand' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

function buttonClass(variant: ButtonVariant, size: ButtonSize, className?: string): string {
  return ['btn', variant, size === 'md' ? '' : size, className ?? ''].filter(Boolean).join(' ');
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: IconName;
  readonly iconAfter?: IconName;
  /** Why the button is disabled. Rendered as the native title/aria description. */
  readonly disabledReason?: string;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconAfter,
  disabledReason,
  className,
  children,
  disabled,
  title,
  ...rest
}: ButtonProps) {
  const blocked = disabled === true;
  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      className={buttonClass(variant, size, className)}
      disabled={blocked}
      title={blocked ? (disabledReason ?? title) : title}
      aria-disabled={blocked || undefined}
    >
      {icon === undefined ? null : <Icon name={icon} size="sm" />}
      {children}
      {iconAfter === undefined ? null : <Icon name={iconAfter} size="sm" />}
    </button>
  );
}

export interface LinkButtonProps extends Omit<LinkProps, 'className'> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: IconName;
  readonly iconAfter?: IconName;
  readonly className?: string;
  readonly children: ReactNode;
}

/** Router link that looks like a Button (the design uses <a class="btn">). */
export function LinkButton({ variant = 'secondary', size = 'md', icon, iconAfter, className, children, ...rest }: LinkButtonProps) {
  return (
    <Link {...rest} className={buttonClass(variant, size, className)}>
      {icon === undefined ? null : <Icon name={icon} size="sm" />}
      {children}
      {iconAfter === undefined ? null : <Icon name={iconAfter} size="sm" />}
    </Link>
  );
}
