import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './IconButton.tsx';
import { trapTabKey } from './focusTrap.ts';

export interface ModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly onClose: () => void;
  readonly className?: string;
}

/** Base dialog (design: .dialog / .scrim) with Esc close, Tab trap and focus restore. */
export function Modal({ open, title, children, footer, onClose, className }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  // `onClose` is usually an inline callback; keep it in a ref so parent
  // re-renders cannot re-run the focus effect and steal focus.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (dialogRef.current !== null) trapTabKey(event, dialogRef.current);
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      previousFocus.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <>
      <div className="scrim open" onClick={onClose} aria-hidden="true" />
      <div
        className={['dialog', 'open', className ?? ''].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="dialog-body">
          <div className="dialog-title-row">
            <h2 className="grow" id={titleId}>
              {title}
            </h2>
            <IconButton icon="x" label="关闭对话框" className="close-btn" onClick={onClose} />
          </div>
          <div>{children}</div>
        </div>
        {footer === undefined ? null : <div className="dialog-foot">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}
