import { useEffect, useState, type ReactNode } from 'react';
import { Check, EyeOff, FlaskConical, Loader2, RotateCcw, X } from 'lucide-react';
import { server, setDemo } from '../sync';
import { TRY_THIS, type DemoState, type TryKey } from '../sandbox';
import { Layer } from './ui/Layer';
import { Badge } from './ui/Person';
import { t } from '../i18n';
import { tj } from '../i18n/tj';

/*
 * The demo company (src/sandbox.ts): the slim bar that sits on top of it, the "Try this" list on its Home, the Reset
 * question, and the calls that make, reset and hide it. The same bar says "You're trying sprint2go" on /try.
 */

/** Where this person's demo company stands (from /api/me), kept fresh when it's made, hidden or shown. */
export function useDemoState(): DemoState | null {
  const [state, setState] = useState(server.demo);
  useEffect(() => {
    const on = () => setState(server.demo);
    window.addEventListener('s2g:demo', on);
    on();
    return () => window.removeEventListener('s2g:demo', on);
  }, []);
  return state;
}

const post = (path: string, body?: object) =>
  fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-conn': server.conn }, body: JSON.stringify(body ?? {}) }).then(
    async (r) => ({ ok: r.ok, data: (await r.json().catch(() => ({}))) as { error?: string; demo?: DemoState; workspaceId?: string } }),
    () => ({ ok: false, data: { error: t('No connection. Try again.') } as { error?: string; demo?: DemoState; workspaceId?: string } }),
  );
const zone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

/** Opens their demo company: made the first time (with this week's dates in their time zone), shown again if hidden. */
export async function openDemoCompany(): Promise<{ workspaceId?: string; error?: string }> {
  const r = await post('/api/sandbox', { tz: zone() });
  if (!r.ok) return { error: r.data.error ? t(r.data.error) : t('The demo company couldn’t be opened. Try again.') };
  if (r.data.demo) setDemo(r.data.demo);
  return { workspaceId: r.data.workspaceId };
}
/** Makes it again from the start. */
export async function resetDemoCompany(): Promise<string | null> {
  const r = await post('/api/sandbox/reset', { tz: zone() });
  if (!r.ok) return r.data.error ? t(r.data.error) : t('The demo company couldn’t be reset. Try again.');
  if (r.data.demo) setDemo(r.data.demo);
  return null;
}
/** Out of the switcher; it stays as it is until it's shown again (or a month goes by unused). */
export async function hideDemoCompany(): Promise<string | null> {
  const r = await post('/api/sandbox/hide');
  if (!r.ok) return r.data.error ? t(r.data.error) : t('The demo company couldn’t be hidden. Try again.');
  if (r.data.demo) setDemo(r.data.demo);
  return null;
}
/** They're looking at it, so it isn't unused. */
export const demoCompanySeen = () => void post('/api/sandbox/seen');

/** The slim bar on top: what this is, and what you can do about it. Calm: it never moves by itself. */
export function DemoBar({ text, children }: { text: ReactNode; children?: ReactNode }) {
  return (
    <div className="demo-bar" role="status">
      <span className="demo-bar-text">
        <FlaskConical size={15} aria-hidden="true" />
        <span>{text}</span>
      </span>
      {children && <span className="demo-bar-actions">{children}</span>}
    </div>
  );
}

/** The demo company's bar: Reset (after a question) and Hide. */
export function DemoCompanyBar({ onReset, onHide, busy }: { onReset: () => void; onHide: () => void; busy?: boolean }) {
  return (
    <DemoBar
      text={tj('{demo} nothing here is real and nothing leaves it.', { demo: <strong>{t('Demo company:')}</strong> })}
    >
      <button type="button" className="ghost-btn sm" onClick={onReset} disabled={busy}>
        <RotateCcw size={13} /> {t('Reset')}
      </button>
      <button type="button" className="ghost-btn sm" onClick={onHide} disabled={busy}>
        <EyeOff size={13} /> {t('Hide')}
      </button>
    </DemoBar>
  );
}

/** "Start the demo company over?": everything done in it goes, and it comes back new. */
export function ResetDemoDialog({
  onReset,
  onClose,
  title = t('Start the demo company over?'),
  text = t('Everything you changed in it goes, and it comes back as new, with this week’s dates. Your real companies don’t change.'),
  confirm = t('Start over'),
}: {
  onReset: () => Promise<boolean>;
  onClose: () => void;
  title?: string;
  text?: string;
  confirm?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Layer>
      <div className="modal-scrim" onMouseDown={() => !busy && onClose()}>
        <div className="modal demo-reset" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !busy && onClose()}>
          <header className="modal-head">
            <span>{title}</span>
            <button className="icon-btn sm" onClick={onClose} disabled={busy} aria-label={t('Close')}>
              <X size={15} />
            </button>
          </header>
          <div className="modal-body">
            <p className="modal-intro">{text}</p>
          </div>
          <footer className="modal-foot">
            <button type="button" className="ghost-btn" onClick={onClose} disabled={busy}>
              {t('Cancel')}
            </button>
            <button
              type="button"
              className="primary-btn"
              autoFocus
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                if (!(await onReset())) setBusy(false);
              }}
            >
              {busy ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />} {busy ? t('Starting over…') : confirm}
            </button>
          </footer>
        </div>
      </div>
    </Layer>
  );
}

/**
 * "Try this" on the demo company's Home: things to do there, ticked off when they're really done in it. Each row says
 * where to go; nothing advances by itself. Closing it keeps the ticks (Help & support shows it again).
 */
export function TryList({ tried, onGo, onClose, onDone }: { tried: TryKey[]; onGo: (key: TryKey) => void; onClose: () => void; onDone?: { label: string; run: () => void } }) {
  const all = TRY_THIS.every((x) => tried.includes(x.key));
  return (
    <section className="setup-card try-card" aria-label={t('Try this in the demo company')}>
      <header className="try-head">
        <h2>{all ? t('You’ve tried it all') : t('Try this')}</h2>
        <Badge tone="info" small>
          {t('Demo')}
        </Badge>
        <span className="spacer" />
        <button
          type="button"
          className="icon-btn sm"
          aria-label={t('Close the list')}
          title={t('Close the list')}
          onClick={(e) => {
            const card = (e.currentTarget as HTMLElement).closest('.try-card');
            if (!card || matchMedia('(prefers-reduced-motion: reduce)').matches) return onClose();
            card.classList.add('leaving');
            setTimeout(onClose, 200);
          }}
        >
          <X size={14} />
        </button>
      </header>
      {all ? (
        <div className="try-done">
          <p>{t('Everything here works the same in a real company, with your own people, email and clients.')}</p>
          {onDone && (
            <button type="button" className="primary-btn sm" onClick={onDone.run}>
              {onDone.label}
            </button>
          )}
        </div>
      ) : (
        <ul>
          {TRY_THIS.map((x) => {
            const done = tried.includes(x.key);
            return (
              <li key={x.key} className={done ? 'done' : ''}>
                <span className="setup-mark">{done ? <Check size={13} /> : null}</span>
                <button type="button" className="setup-text" onClick={() => onGo(x.key)}>
                  <strong>{t(x.label)}</strong>
                  <small>{done ? t('Done') : t(x.hint)}</small>
                </button>
                {!done && (
                  <button type="button" className="ghost-btn sm" onClick={() => onGo(x.key)}>
                    {t('Show me')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** An invitation to look around the demo company first (a new, still empty company's Home). */
export function DemoInvite({ onOpen, onClose, busy }: { onOpen: () => void; onClose: () => void; busy?: boolean }) {
  return (
    <div className="news-card demo-invite" role="note">
      <FlaskConical size={16} />
      <span>
        <strong>{t('Look around a demo company first.')}</strong> {t('A sample agency with mail, chat, tasks and projects to try things in. It’s yours alone, and nothing in it is real.')}
        <button type="button" className="link-btn" onClick={onOpen} disabled={busy}>
          {busy ? t('Opening…') : t('Open the demo company')}
        </button>
      </span>
      <button
        type="button"
        className="icon-btn sm"
        aria-label={t('Dismiss')}
        onClick={(e) => {
          const card = (e.currentTarget as HTMLElement).closest('.news-card');
          card?.classList.add('leaving');
          setTimeout(onClose, 180);
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** What Settings and Help & support need to show and bring back the demo company. */
export interface DemoSettings {
  inDemo: boolean; // the company on screen is the demo company
  allowed: boolean;
  state: 'none' | 'on' | 'hidden';
  listOff: boolean; // the "Try this" list was closed
  busy?: boolean;
  onOpen: () => void; // make it, show it again, or go to it
  onList: () => void; // the "Try this" list back on its Home
  realWorkspaceId?: string; // a real company of theirs (help requests and their files belong there)
}

/** Help & support and Settings, Your apps: the demo company, and the way back to it once it's hidden. */
export function DemoCompanyBlock({ d }: { d: DemoSettings }) {
  if (!d.allowed && d.state !== 'on') return null;
  return (
    <div className="set-block demo-block">
      <h3>{t('Demo company')}</h3>
      <p className="small muted">{d.allowed ? t('A sample agency with mail, chat, tasks and projects, just for you. Nothing in it is real and nothing leaves it.') : t('Your company switched the demo company off.')}</p>
      {d.allowed && (
        <div className="demo-block-actions">
          {d.state === 'on' ? (
            <>
              {!d.inDemo && (
                <button type="button" className="ghost-btn outline sm" onClick={d.onOpen}>
                  {t('Go to the demo company')}
                </button>
              )}
              <button type="button" className="ghost-btn outline sm" onClick={d.onList}>
                {d.listOff ? t('Show the Try this list') : t('Open the Try this list')}
              </button>
            </>
          ) : (
            <button type="button" className="ghost-btn outline sm" onClick={d.onOpen} disabled={d.busy}>
              {d.busy ? <Loader2 size={13} className="spin" /> : <FlaskConical size={13} />} {d.state === 'hidden' ? t('Show the demo company') : t('Open the demo company')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
