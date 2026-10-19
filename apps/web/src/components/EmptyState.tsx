import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon.tsx';

export interface EmptyStateProps {
  readonly icon?: IconName;
  readonly title: string;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
  readonly compact?: boolean;
}

export function EmptyState({ icon = 'info', title, description, action, className, compact }: EmptyStateProps) {
  const classes = ['empty', className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={classes} style={compact === true ? { padding: '28px 16px' } : undefined}>
      <span className="tile">
        <Icon name={icon} size="lg" />
      </span>
      <h3>{title}</h3>
      {description === undefined ? null : <p>{description}</p>}
      {action === undefined ? null : <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

export interface SkeletonProps {
  readonly width?: number | string;
  readonly height?: number | string;
  readonly radius?: number | string;
  readonly className?: string;
}

export function Skeleton({ width = '100%', height = 12, radius = 8, className }: SkeletonProps) {
  return <span className={['skel', className ?? ''].filter(Boolean).join(' ')} style={{ display: 'block', width, height, borderRadius: radius }} />;
}

export function SkeletonText({ lines = 2 }: { readonly lines?: number }) {
  return (
    <div className="stack-sm">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} width={index === 0 ? '72%' : '46%'} height={11} />
      ))}
    </div>
  );
}
