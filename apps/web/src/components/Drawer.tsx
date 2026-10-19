import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './IconButton.tsx';

export type DrawerSize = 'sm' | 'md' | 'lg' | 'xl';

export interface DrawerProps {
  readonly open: boolean;
  readonly title: string;
  readonly side?: 'right' | 'left';
  readonly size?: DrawerSize;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly onClose: () => void;
}

/** Base drawer (design: .drawer, widths 400/480/520/600). */
export function Drawer({ open, title, side = 'right', size = 'sm', children, footer, onClose }: DrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    drawerRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      previousFocus.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  const classes = ['drawer', side === 'left' ? 'left' : '', size === 'sm' ? '' : size, 'open'].filter(Boolean).join(' ');

  return createPortal(
    <>
      <div className="scrim open" onClick={onClose} aria-hidden="true" />
      <aside className={classes} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={drawerRef}>
        <div className="drawer-head">
          <div className="drawer-title-row">
            <h2>{title}</h2>
          </div>
          <IconButton icon="x" label="关闭抽屉" onClick={onClose} />
        </div>
        <div className="drawer-body">{children}</div>
        {footer === undefined ? null : <div className="drawer-foot">{footer}</div>}
      </aside>
    </>,
    document.body,
  );
}
