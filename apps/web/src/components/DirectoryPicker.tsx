import { useEffect, useState } from 'react';
import { ROUTES, type DirectoryListingResponse } from '@agent-workflow/shared';
import { apiGet, errorMessage } from '../api/client.ts';
import { Button } from './Button.tsx';
import { Icon } from './Icon.tsx';
import { Modal } from './Modal.tsx';

export interface DirectoryPickerProps {
  readonly open: boolean;
  readonly initialPath?: string;
  readonly onClose: () => void;
  readonly onSelect: (path: string) => void;
}

/** Server-backed folder browser (browser mode); Electron uses the native dialog. */
export function DirectoryPicker({ open, initialPath, onClose, onSelect }: DirectoryPickerProps) {
  const [path, setPath] = useState<string | undefined>(initialPath);
  const [listing, setListing] = useState<DirectoryListingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (open) {
      setPath(initialPath);
      setError(undefined);
    }
  }, [open, initialPath]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    void apiGet<DirectoryListingResponse>(ROUTES.fsDirectories(path))
      .then((response) => {
        if (cancelled) return;
        setListing(response.data);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setListing(null);
        setError(errorMessage(failure));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, path, refreshToken]);

  const selectCurrent = () => {
    if (listing === null) return;
    onSelect(listing.path);
    onClose();
  };

  return (
    <Modal
      open={open}
      title="选择项目文件夹"
      onClose={onClose}
      footer={
        <>
          <span className="hint grow">{listing === null ? '选择一个目录' : `将登记：${listing.path}`}</span>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" icon="check" disabled={listing === null} disabledReason={listing === null ? '先进入一个可读取的目录' : undefined} onClick={selectCurrent}>
            选择此文件夹
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <Button variant="ghost" size="sm" icon="arrowLeft" disabled={listing?.parent === undefined} onClick={() => { if (listing?.parent !== undefined) setPath(listing.parent); }}>上一级</Button>
          <Button variant="ghost" size="sm" icon="home" disabled={listing?.home === undefined} onClick={() => { if (listing?.home !== undefined) setPath(listing.home); }}>主目录</Button>
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => { setRefreshToken((value) => value + 1); }}>刷新</Button>
        </div>
        <div className="mono" style={{ fontSize: 12.5, overflowWrap: 'anywhere', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--fill-1)' }}>
          {loading ? '读取目录…' : listing?.path ?? path ?? '—'}
        </div>
        {error === undefined ? null : (
          <div className="banner danger">
            <Icon name="alert" />
            <span>{error}</span>
          </div>
        )}
        <div style={{ maxHeight: 380, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
          {loading ? <p className="hint" style={{ padding: 14 }}>正在读取目录…</p>
            : listing === null ? <p className="hint" style={{ padding: 14 }}>当前目录不可读；可点「主目录」重新开始。</p>
              : listing.entries.length === 0 ? <p className="hint" style={{ padding: 14 }}>这个目录下没有子文件夹，可以直接选择当前文件夹。</p>
                : listing.entries.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    className="list-row"
                    style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
                    onClick={() => { setPath(entry.path); }}
                  >
                    <span className="tile"><Icon name={entry.isGit ? 'git' : 'folder'} size="sm" /></span>
                    <span className="grow mono" style={{ fontSize: 12.5, overflowWrap: 'anywhere' }}>{entry.name}</span>
                    {entry.isGit ? <span className="chip"><Icon name="git" size="sm" /> Git</span> : null}
                    <Icon name="chevRight" size="sm" />
                  </button>
                ))}
        </div>
        <p className="hint">只读取目录名称，不读取文件内容。进入目标目录后点「选择此文件夹」。</p>
      </div>
    </Modal>
  );
}
