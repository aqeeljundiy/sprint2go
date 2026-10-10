import { useMemo, useState, type RefObject } from 'react';
import { Folder, HardDrive, Search } from 'lucide-react';
import type { DriveItem } from '../../types';
import { Popover } from '../ui/Popover';
import { Sheet } from '../ui/Sheet';
import { usePhone } from '../../mobile/media';
import { useStored, session } from '../../store';
import { t, tn } from '../../i18n';

/**
 * Where to save in Drive: My Drive, then the company's folders as a tree (a search when there are many). A menu by
 * the button on desktop, a bottom sheet on phones.
 */
export function DriveFolderPicker({ open, onClose, anchor, count = 1, onPick }: { open: boolean; onClose: () => void; anchor?: RefObject<HTMLElement | null>; count?: number; onPick: (folderId: string | null, name: string) => void }) {
  const phone = usePhone();
  const [drive] = useStored('drive');
  const [q, setQ] = useState('');
  const folders = useMemo(() => {
    const all = (drive as DriveItem[]).filter((d) => d.kind === 'folder' && !d.trashed && (d.workspaceId ?? 'pnp') === session.wsId);
    const kids = new Map<string | null, DriveItem[]>();
    for (const f of all) {
      const parent = f.parentId && all.some((x) => x.id === f.parentId) ? f.parentId : null;
      kids.set(parent, [...(kids.get(parent) ?? []), f]);
    }
    const out: { f: DriveItem; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const f of (kids.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
        out.push({ f, depth });
        if (depth < 6) walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [drive]);
  if (!open) return null;
  const words = q.trim().toLowerCase();
  const shown = words ? folders.filter((x) => x.f.name.toLowerCase().includes(words)).map((x) => ({ ...x, depth: 0 })) : folders;
  const pick = (id: string | null, name: string) => {
    onClose();
    onPick(id, name);
  };
  const title = tn(count, 'Save {n} file to', 'Save {n} files to');
  const body = (
    <>
      {folders.length > 8 && (
        <label className="dfp-search">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Find a folder')} aria-label={t('Find a folder')} autoFocus={!phone} />
        </label>
      )}
      <div className="as-list dfp-list" role="menu">
        {!words && (
          <button type="button" role="menuitem" className="as-item" onClick={() => pick(null, t('My Drive'))}>
            <HardDrive size={18} className="as-icon" />
            <span className="as-label">{t('My Drive')}</span>
          </button>
        )}
        {shown.map(({ f, depth }) => (
          <button key={f.id} type="button" role="menuitem" className="as-item" style={{ paddingInlineStart: `calc(var(--dfp-pad, 12px) + ${depth * 16}px)` }} onClick={() => pick(f.id, f.name)}>
            <Folder size={18} className="as-icon" />
            <span className="as-label">{f.name}</span>
          </button>
        ))}
        {words && !shown.length && <p className="mp-none">{t('No folder by that name.')}</p>}
      </div>
    </>
  );
  if (phone || !anchor)
    return (
      <Sheet onClose={onClose} title={title} className="mail-pick dfp">
        {body}
      </Sheet>
    );
  return (
    <Popover anchor={anchor} open onClose={onClose} width={300} title={title} align="end">
      <div className="mail-pick in-pop dfp">
        <div className="mp-title">{title}</div>
        {body}
      </div>
    </Popover>
  );
}
