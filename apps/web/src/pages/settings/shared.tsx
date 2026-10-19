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
  /** Field effect badge; `restart` is kept for existing call sites. */
  readonly effect?: SettingsEffect;
  /** Amber field outline when this row has an unsaved draft value. */
  readonly dirty?: boolean;
}

export type SettingsEffect = 'live' | 'new_execution' | 'restart' | 'saved' | 'unavailable';

function EffectBadge({ effect }: { readonly effect: SettingsEffect }) {
  if (effect === 'new_execution') return <span className="eff now"><Icon name="check" size="sm" />新执行生效</span>;
  if (effect === 'restart') {
    return (
      <span className="eff restart">
        <Icon name="refresh" size="sm" />
        重启后生效
      </span>
    );
  }
  if (effect === 'saved') {
    return (
      <span className="eff saved">
        <Icon name="check" size="sm" />
        已提供 · 执行路径未读取
      </span>
    );
  }
  if (effect === 'unavailable') {
    return (
      <span className="eff unavailable">
        <Icon name="lock" size="sm" />
        当前未读取
      </span>
    );
  }
  return (
    <span className="eff now">
      <Icon name="check" size="sm" />
      立即生效
    </span>
  );
}

/** One label/control row of the design's settings form (.frow). */
export function SettingsRow({ label, hint, children, restart, effect, dirty }: SettingsRowProps) {
  const resolvedEffect = effect ?? (restart === true ? 'restart' : undefined);
  return (
    <div className={dirty === true ? 'frow field-dirty' : 'frow'}>
      <div className="l">
        {label}
        {hint === undefined ? null : <span className="hint">{hint}</span>}
        {resolvedEffect === undefined ? null : <EffectBadge effect={resolvedEffect} />}
      </div>
      <div className="v">{children}</div>
    </div>
  );
}

export function ReadOnlyValue({ children }: { readonly children: ReactNode }) {
  return <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>{children}</span>;
}
