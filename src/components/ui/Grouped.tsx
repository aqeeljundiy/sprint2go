import { useMemo, useState, type HTMLInputTypeAttribute, type ReactNode } from 'react';
import { Check, ChevronRight, Search, type LucideIcon } from 'lucide-react';
import { PushScreen } from './PushScreen';
import { Sheet } from './Sheet';
import { t } from '../../i18n';
import { IconTile } from './IconTile';

/** The row icons' colours: the launcher's tile family (IconTile), a pale tint with the icon in the colour (D7). */
const G_COLORS: Record<string, string> = { blue: '#0a84ff', green: '#30b158', orange: '#ff9500', red: '#ff3b30', purple: '#af52de', teal: '#12a8c7', grey: '#8e8e93', pink: '#ff2d55', indigo: '#5856d6', yellow: '#f2b600' };

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
  pic,
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
  pic?: ReactNode; // a picture instead of an icon (an avatar, a stage's dot)
}) {
  const showChev = chevron ?? (!!onClick && !accessory && !danger && !action);
  const cls = `g-row${Icon ? ' has-icon' : ''}${danger ? ' danger' : ''}${action ? ' action' : ''}${sub ? ' two' : ''}${pic ? ' has-pic' : ''} ${className}`;
  const inner = (
    <>
      {pic && <span className="g-pic" aria-hidden>{pic}</span>}
      {Icon && (plainIcon ? <Icon size={20} className="g-plain-icon" aria-hidden /> : <IconTile icon={Icon} color={G_COLORS[color ?? 'grey'] ?? G_COLORS.grey} size={32} className="g-icon" />)}
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

/* ---------- iOS Settings' editing pattern on phones: a row shows the value, tapping it opens the value's own screen ---------- */

type SaveResult = void | string | null | undefined;

/**
 * A screen for changing something (iOS: Settings, General, About, Name): Cancel on the left, Save on the right, the
 * fields as grouped rows on the grey. Leaving any other way (Back, Escape, the edge swipe) doesn't save. `onSave` may
 * return an error to show (the screen stays) or a promise of one; nothing returned closes it.
 */
export function EditScreen({
  title,
  onBack,
  onSave,
  canSave = true,
  saveLabel,
  danger,
  children,
  className = '',
}: {
  title: string;
  onBack: () => void;
  onSave: () => SaveResult | Promise<SaveResult>;
  canSave?: boolean;
  saveLabel?: string;
  danger?: boolean; // the action deletes something: the word is red
  children: ReactNode;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    const r = await onSave();
    setBusy(false);
    if (r) setErr(r);
    else onBack();
  };
  return (
    <PushScreen
      title={title}
      cancel
      onBack={onBack}
      className={`g-page g-edit ${className}`}
      actions={
        <button type="button" className={`g-save${danger ? ' danger' : ''}`} disabled={!canSave || busy} onClick={() => void save()}>
          {saveLabel ?? t('Save')}
        </button>
      }
    >
      <form
        className="g-edit-body"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {children}
        {err && (
          <p className="g-foot g-err" role="alert">
            {t(err)}
          </p>
        )}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </PushScreen>
  );
}

type InputMode = 'text' | 'email' | 'numeric' | 'decimal' | 'tel' | 'url';

/** A field as a row of its own inside an EditScreen's group (iOS: the text fills the row, 16 px so phones don't zoom). */
export function GField({
  value,
  onChange,
  label,
  placeholder,
  type = 'text',
  multiline,
  autoFocus,
  autoComplete,
  inputMode,
  maxLength,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string; // read out to screen readers
  placeholder?: string;
  type?: HTMLInputTypeAttribute;
  multiline?: boolean;
  autoFocus?: boolean;
  autoComplete?: string;
  inputMode?: InputMode;
  maxLength?: number;
  mono?: boolean; // keys and codes
}) {
  const cls = `g-input${mono ? ' mono' : ''}`;
  return (
    <div className={`g-row g-field-row${multiline ? ' multi' : ''}`}>
      {multiline ? (
        <textarea className={cls} rows={4} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} autoFocus={autoFocus} maxLength={maxLength} />
      ) : (
        <input className={cls} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} autoFocus={autoFocus} autoComplete={autoComplete} inputMode={inputMode} maxLength={maxLength} spellCheck={mono ? false : undefined} />
      )}
    </div>
  );
}

interface TextEditProps {
  placeholder?: string;
  maxLength?: number;
  footer?: ReactNode;
  allowEmpty?: boolean;
  multiline?: boolean;
  type?: HTMLInputTypeAttribute;
  inputMode?: InputMode;
  autoComplete?: string;
  mono?: boolean;
  validate?: (v: string) => string | null; // why Save can't be pressed yet, shown under the field instead of the footer
  saveLabel?: string;
}

/** One value on a screen of its own: the field, an explanation under it, Cancel and Save. */
export function TextEditScreen({ title, value, onSave, onBack, footer, allowEmpty = true, validate, saveLabel, ...field }: TextEditProps & { title: string; value: string; onSave: (v: string) => SaveResult | Promise<SaveResult>; onBack: () => void }) {
  const [v, setV] = useState(value);
  const problem = v.trim() && validate ? validate(v.trim()) : null;
  const can = v.trim() !== value.trim() && (allowEmpty || !!v.trim()) && !problem;
  return (
    <EditScreen title={title} onBack={onBack} canSave={can} saveLabel={saveLabel} onSave={() => onSave(field.multiline ? v : v.trim())}>
      <Group footer={problem ?? footer}>
        <GField value={v} onChange={setV} label={title} autoFocus {...field} />
      </Group>
    </EditScreen>
  );
}

/**
 * A text setting as a row: its value on the right (or `empty` in grey) with a chevron; tapping opens TextEditScreen.
 * Read-only (no chevron) without `onSave` or when `disabled`.
 */
export function TextRow({
  label,
  value,
  shown,
  empty,
  icon,
  color,
  sub,
  disabled,
  title,
  onSave,
  ...edit
}: TextEditProps & {
  label: string;
  value: string;
  shown?: ReactNode; // what the row shows, when it isn't the value itself (a short form, a masked key)
  empty?: string; // what an empty value shows (default "Not set")
  icon?: LucideIcon;
  color?: GColor;
  sub?: ReactNode;
  disabled?: boolean;
  title?: string; // the screen's title, when it isn't the label
  onSave?: (v: string) => SaveResult | Promise<SaveResult>;
}) {
  const [open, setOpen] = useState(false);
  const can = !!onSave && !disabled;
  return (
    <>
      <GRow icon={icon} color={color} label={label} sub={sub} value={shown ?? (value || empty || t('Not set'))} onClick={can ? () => setOpen(true) : undefined} />
      {open && onSave && <TextEditScreen title={title ?? label} value={value} {...edit} onSave={onSave} onBack={() => setOpen(false)} />}
    </>
  );
}

export interface GOption<V extends string = string> {
  value: V;
  label: string;
  hint?: string;
  icon?: ReactNode;
  group?: string;
  disabled?: boolean;
}

/** A sheet of choices with a tick on the current one (iOS's menus); more than ten get a search field. */
export function ChoiceSheet<V extends string>({ title, value, options, onPick, onClose }: { title: string; value: V | V[]; options: GOption<V>[]; onPick: (v: V) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const many = options.length > 10;
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => s.split(/\s+/).every((w) => `${o.label} ${o.hint ?? ''} ${o.group ?? ''}`.toLowerCase().includes(w))) : options;
  }, [options, q]);
  const on = (v: V) => (Array.isArray(value) ? value.includes(v) : value === v);
  let lastGroup: string | undefined;
  return (
    <Sheet onClose={onClose} title={title} size={many ? 'tall' : 'auto'} className="g-choices">
      {many && (
        <label className="sheet-search">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Find…')} aria-label={t('Find…')} />
        </label>
      )}
      <div className="as-list" role="listbox" aria-label={title} aria-multiselectable={Array.isArray(value) || undefined}>
        {shown.length === 0 && <p className="sheet-empty">{t('No matches')}</p>}
        {shown.map((o) => {
          const head = o.group && o.group !== lastGroup ? o.group : null;
          lastGroup = o.group;
          return (
            <div key={o.value} role="presentation">
              {head && <div className="as-group">{head}</div>}
              <button type="button" role="option" aria-selected={on(o.value)} disabled={o.disabled} className={`as-item${on(o.value) ? ' on' : ''}`} onClick={() => onPick(o.value)}>
                {o.icon && <span className="as-icon">{o.icon}</span>}
                <span className="as-label">
                  <span>{o.label}</span>
                  {o.hint && <small>{o.hint}</small>}
                </span>
                {on(o.value) && <Check size={16} className="as-check" />}
              </button>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

/** A choice as a row: the current one on the right with a chevron; tapping opens a sheet with a tick. */
export function ChoiceRow<V extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  title,
  sub,
  icon,
  color,
  shown,
}: {
  label: ReactNode;
  value: V;
  options: GOption<V>[];
  onChange: (v: V) => void;
  disabled?: boolean;
  title?: string; // the sheet's title, when the label isn't plain text
  sub?: ReactNode;
  icon?: LucideIcon;
  color?: GColor;
  shown?: ReactNode; // what the row shows, when it isn't the option's label
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <GRow icon={icon} color={color} label={label} sub={sub} value={shown ?? current?.label ?? ''} onClick={disabled ? undefined : () => setOpen(true)} />
      {open && <ChoiceSheet title={title ?? (typeof label === 'string' ? label : '')} value={value} options={options} onClose={() => setOpen(false)} onPick={(v) => (setOpen(false), v !== value && onChange(v))} />}
    </>
  );
}

/** An on/off setting as a row: the switch on the right. */
export function SwitchRow({ label, sub, on, onChange, disabled, icon, color }: { label: ReactNode; sub?: ReactNode; on: boolean; onChange: (v: boolean) => void; disabled?: boolean; icon?: LucideIcon; color?: GColor }) {
  return (
    <GRow
      icon={icon}
      color={color}
      label={label}
      sub={sub}
      className="g-switch-row"
      accessory={
        <button type="button" role="switch" aria-checked={on} disabled={disabled} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-label={typeof label === 'string' ? label : undefined}>
          <span />
        </button>
      }
    />
  );
}
