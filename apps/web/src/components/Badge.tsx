import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon.tsx';

/** Tone names map to the design-system status classes (.st-*) in ds.css. */
export type BadgeTone =
  | 'neutral'
  | 'run'
  | 'stall'
  | 'fail'
  | 'done'
  | 'ok'
  | 'wait'
  | 'idle'
  | 'danger'
  | 'unknown'
  | 'warn'
  | 'accent';

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: '',
  run: 'st-run',
  stall: 'st-stall',
  fail: 'st-fail',
  done: 'st-done',
  ok: 'st-ok',
  wait: 'st-wait',
  idle: 'st-idle',
  danger: 'st-danger',
  unknown: 'st-unknown',
  warn: 'st-fail',
  accent: 'st-accent',
};

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly icon?: IconName;
  readonly outline?: boolean;
  readonly className?: string;
  readonly title?: string;
  readonly children: ReactNode;
}

/** Status / meta pill. Status is always text + icon + colour (never colour alone). */
export function Badge({ tone = 'neutral', icon, outline, className, title, children }: BadgeProps) {
  const classes = ['badge', TONE_CLASS[tone], outline === true ? 'outline' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <span className={classes} title={title}>
      {icon === undefined ? null : <Icon name={icon} size="sm" />}
      {children}
    </span>
  );
}

export type StatusDotTone = 'ok' | 'warn' | 'danger' | 'muted' | 'run' | 'accent';

export interface StatusDotProps {
  readonly tone?: StatusDotTone;
  readonly pulse?: boolean;
  /** Accessible label; omit for purely decorative dots (aria-hidden). */
  readonly label?: string;
}

export function StatusDot({ tone = 'muted', pulse, label }: StatusDotProps) {
  const classes = ['dot', `status-dot-${tone}`, pulse === true ? 'pulse' : ''].filter(Boolean).join(' ');
  if (label === undefined) {
    return <span className={classes} aria-hidden="true" />;
  }
  return <span className={classes} role="img" aria-label={label} />;
}
