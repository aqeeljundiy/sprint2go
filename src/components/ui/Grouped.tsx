import type { ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';

/**
 * iOS's inset grouped list, for phone screens (Settings, a Vault login, Teams): a header, one borderless card of rows,
 * a footer that explains it. Styles in src/mobile/grouped.css; put the screen on `.g-page` for the grouped grey.
 *
 *   <Group title="You" footer="Shown to your team.">
 *     <GRow icon={Bell} color="red" label="Notifications" value="On" onClick={open} />
 *     <GRow label="Delete" danger onClick={remove} />
 *   </Group>
 */
export function Group({ title, footer, children, className = '' }: { title?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`g-group ${className}`}>
      {title && <h2 className="g-head">{title}</h2>}
      <div className="g-card">{children}</div>
      {footer && <p className="g-foot">{footer}</p>}
    </section>
  );
}

/** The fixed set of tile colours (iOS Settings' icons). */
export type GColor = 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'teal' | 'grey' | 'pink' | 'indigo' | 'yellow';

/**
 * One row: an optional coloured icon tile, the label, a value on the right and a chevron when it opens something.
 * `accessory` replaces the value and chevron (a switch, a copy button). `danger` or `action` make it a text button row.
 */
export function GRow({
  icon: Icon,
  color = 'grey',
  label,
  sub,
  value,
  onClick,
  chevron,
  accessory,
  danger,
  action,
  className = '',
  plainIcon,
}: {
  icon?: LucideIcon;
  color?: GColor;
  label: ReactNode;
  sub?: ReactNode; // a second line under the label
  value?: ReactNode;
  onClick?: () => void;
  chevron?: boolean; // defaults to on when the row opens something and has no accessory
  accessory?: ReactNode;
  danger?: boolean;
  action?: boolean; // a blue text row ("Send a reminder")
  className?: string;
  plainIcon?: boolean; // the icon without a coloured tile (secondary colour)
}) {
  const showChev = chevron ?? (!!onClick && !accessory && !danger && !action);
  const cls = `g-row${Icon ? ' has-icon' : ''}${danger ? ' danger' : ''}${action ? ' action' : ''}${sub ? ' two' : ''} ${className}`;
  const inner = (
    <>
      {Icon && (plainIcon ? <Icon size={20} className="g-plain-icon" aria-hidden /> : <span className={`g-icon g-${color}`} aria-hidden><Icon size={18} strokeWidth={2.2} /></span>)}
      <span className="g-label">
        <span className="g-text">{label}</span>
        {sub && <small className="g-sub">{sub}</small>}
      </span>
      {value != null && value !== '' && <span className="g-val">{value}</span>}
      {accessory}
      {showChev && <ChevronRight size={18} className="g-chev" aria-hidden />}
    </>
  );
  return onClick ? (
    <button type="button" className={cls} onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
