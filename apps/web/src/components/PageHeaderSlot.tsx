import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Route-owned controls in the shared page header, removed automatically on navigation. */
export function PageHeaderSlot({ children, placement = 'context' }: { readonly children: ReactNode; readonly placement?: 'context' | 'actions' }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => { setTarget(document.getElementById(`page-header-${placement}`)); }, [placement]);
  return target === null ? null : createPortal(children, target);
}
