import { useRef, useState } from 'react';
import { Menu as MenuIcon, type LucideIcon } from 'lucide-react';
import { useLongPress } from '../components/ui/useLongPress';
import { ActionSheet } from '../components/ui/ActionSheet';
import type { CreateAction } from './chrome';
import { t, tn } from '../i18n';

export interface BarApp {
  id: string;
  name: string;
  icon: LucideIcon;
  badge?: number;
}

const count = (n: number) => (n > 99 ? '99+' : String(n));

/**
 * The phone's bottom bar: four apps and More in a pill, always labelled, and the current app's create button docked
 * at the end of the same row (never over the content). Long-press the bar to edit it. The bar steps aside on focused
 * screens and while the keyboard is open (the `.bar-away` class on <html>, set by App).
 */
export function BottomBar({ apps, current, moreOn, onApp, onMore, onEdit, create }: { apps: BarApp[]; current: string; moreOn: boolean; onApp: (id: string) => void; onMore: () => void; onEdit: () => void; create: CreateAction | null }) {
  const edit = useLongPress(() => onEdit());
  // The last create action stays drawn while the button scales away, so it doesn't change icon on its way out.
  const last = useRef<CreateAction | null>(create);
  if (create) last.current = create;
  const shown = create ?? last.current;
  const [more, setMore] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const hold = useLongPress(() => create?.more?.length && setMore(true));
  const Icon = shown?.icon;
  return (
    <nav className={`tabbar${create ? ' has-create' : ''}`} aria-label={t('Apps')}>
      <div className="tabbar-pill lp" {...edit}>
        {apps.map(({ id, name, icon: AppIcon, badge }) => (
          <button key={id} type="button" className={current === id ? 'on' : ''} aria-current={current === id ? 'page' : undefined} onClick={() => onApp(id)}>
            <span className="tab-icon">
              <AppIcon size={21} />
              {badge ? <i aria-label={tn(badge, '{n} new', '{n} new')}>{count(badge)}</i> : null}
            </span>
            <span className="tab-label">{name}</span>
          </button>
        ))}
        <button type="button" className={moreOn ? 'on' : ''} onClick={onMore} aria-haspopup="dialog">
          <span className="tab-icon">
            <MenuIcon size={21} />
          </span>
          <span className="tab-label">{t('More')}</span>
        </button>
      </div>
      <button
        ref={moreBtn}
        type="button"
        className="tabbar-create lp"
        onClick={() => create?.run()}
        aria-label={shown?.label}
        title={shown?.label}
        tabIndex={create ? 0 : -1}
        aria-hidden={!create}
        {...hold}
        onContextMenu={(e) => {
          hold.onContextMenu(e);
          if (create?.more?.length) (e.preventDefault(), setMore(true));
        }}
      >
        {Icon && <Icon size={22} />}
      </button>
      {create?.more && <ActionSheet open={more} onClose={() => setMore(false)} title={create.label} anchor={moreBtn} actions={[{ label: create.label, icon: create.icon, run: create.run }, ...create.more]} />}
    </nav>
  );
}
