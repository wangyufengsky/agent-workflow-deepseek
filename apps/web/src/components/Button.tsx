import { useId, type ButtonHTMLAttributes, type MouseEventHandler, type ReactNode } from 'react';
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
  /** Why the button is disabled. Rendered as an aria-describedby text (readable by keyboard/screen readers). */
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
  onClick,
  ...rest
}: ButtonProps) {
  const blocked = disabled === true;
  const reasonId = useId();
  // GLB-13: keep a reason-bearing disabled button focusable (aria-disabled
  // pattern, which ds.css already styles) so keyboard users can read why it is
  // blocked through aria-describedby instead of the pointer-only title.
  const explain = blocked && disabledReason !== undefined && disabledReason.length > 0;
  const handleClick: MouseEventHandler<HTMLButtonElement> = (event) => {
    if (blocked) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  };
  return (
    <>
      <button
        {...rest}
        type={rest.type ?? 'button'}
        className={buttonClass(variant, size, className)}
        disabled={explain ? undefined : blocked}
        title={blocked ? (disabledReason ?? title) : title}
        aria-disabled={blocked || undefined}
        aria-describedby={explain ? reasonId : rest['aria-describedby']}
        onClick={handleClick}
      >
        {icon === undefined ? null : <Icon name={icon} size="sm" />}
        {children}
        {iconAfter === undefined ? null : <Icon name={iconAfter} size="sm" />}
      </button>
      {explain ? (
        <span id={reasonId} className="sr">
          {disabledReason}
        </span>
      ) : null}
    </>
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
