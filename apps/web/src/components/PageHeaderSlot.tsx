import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type HeaderSlotHost = 'pending' | 'attached' | 'detached';

/**
 * Route-owned controls in the shared page header, removed automatically on
 * navigation.
 *
 * The shell header only exists for routes whose design page has a header
 * (`header:''` routes omit it, GLB-05). When no host element is mounted the
 * children render inline instead of disappearing: that keeps the control
 * reachable on the design's header-less pages until the page owner moves it
 * into the content `page-head` (GLB-04).
 */
export function PageHeaderSlot({
  children,
  placement = 'context',
}: {
  readonly children: ReactNode;
  readonly placement?: 'context' | 'actions';
}) {
  const [host, setHost] = useState<HeaderSlotHost>('pending');
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const element = document.getElementById(`page-header-${placement}`);
    setTarget(element);
    setHost(element === null ? 'detached' : 'attached');
  }, [placement]);

  if (host === 'pending') return null;
  if (host === 'detached' || target === null) {
    return <div className="page-header-inline row wrap">{children}</div>;
  }
  return createPortal(children, target);
}
