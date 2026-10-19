import type { ReactNode } from 'react';
import { Badge } from '../../components/Badge.tsx';
import { Icon } from '../../components/Icon.tsx';

export interface SettingsHeadingProps {
  readonly title: string;
  readonly lede: string;
  readonly readOnly?: boolean;
}

export function SettingsHeading({ title, lede, readOnly }: SettingsHeadingProps) {
  return (
    <div className="row between" style={{ alignItems: 'flex-start', gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <h2>{title}</h2>
        <p className="lede">{lede}</p>
      </div>
      {readOnly === true ? <ReadOnlyBadge /> : null}
    </div>
  );
}

export function ReadOnlyBadge() {
  return (
    <Badge tone="neutral" outline icon="lock">
      只读
    </Badge>
  );
}

export interface SettingsRowProps {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly children: ReactNode;
  readonly restart?: boolean;
}

/** One label/control row of the design's settings form (.frow). */
export function SettingsRow({ label, hint, children, restart }: SettingsRowProps) {
  return (
    <div className="frow">
      <div className="l">
        {label}
        {hint === undefined ? null : <span className="hint">{hint}</span>}
        {restart === true ? (
          <span className="eff restart">
            <Icon name="refresh" size="sm" />
            重启后生效
          </span>
        ) : null}
      </div>
      <div className="v">{children}</div>
    </div>
  );
}

export function ReadOnlyValue({ children }: { readonly children: ReactNode }) {
  return <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>{children}</span>;
}
