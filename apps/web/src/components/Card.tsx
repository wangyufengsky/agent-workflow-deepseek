import type { ReactNode } from 'react';
import { Badge } from './Badge.tsx';

export interface CardProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly hoverable?: boolean;
  readonly solid?: boolean;
  readonly pad?: boolean;
}

export function Card({ children, className, hoverable, solid, pad }: CardProps) {
  const classes = ['card', pad === true ? 'pad' : '', solid === true ? 'solid' : '', hoverable === true ? 'hoverable' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return <div className={classes}>{children}</div>;
}

export function CardHead({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return <div className={['card-head', className ?? ''].filter(Boolean).join(' ')}>{children}</div>;
}

export function CardBody({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return <div className={['card-body', className ?? ''].filter(Boolean).join(' ')}>{children}</div>;
}

export function CardFoot({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return <div className={['card-foot', className ?? ''].filter(Boolean).join(' ')}>{children}</div>;
}

export interface PageHeaderProps {
  readonly title: ReactNode;
  readonly lede?: ReactNode;
  readonly eyebrow?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}

export function PageHeader({ title, lede, eyebrow, actions, className }: PageHeaderProps) {
  return (
    <div className={['page-head', className ?? ''].filter(Boolean).join(' ')}>
      <div className="grow">
        {eyebrow === undefined ? null : <span className="eyebrow">{eyebrow}</span>}
        <h2 className="title">{title}</h2>
        {lede === undefined ? null : <p className="lede">{lede}</p>}
      </div>
      {actions === undefined ? null : <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function CountBadge({ children, tone = 'neutral' }: { readonly children: ReactNode; readonly tone?: 'neutral' | 'accent' | 'wait' }) {
  return <Badge tone={tone}>{children}</Badge>;
}
