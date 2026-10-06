import { useState } from 'react';
import { term } from '../terms';
import { ArrowLeft, CalendarDays, Check, Globe, Link2, Loader2, X } from 'lucide-react';
import type { CalendarDef, CalendarSource } from '../types';
import { Select } from './ui/Select';

export const SOURCE_NAME: Record<CalendarSource, string> = {
  sprint2go: 'Sprint2go',
  google: 'Google Calendar',
  microsoft: 'Outlook / Microsoft 365',
  icloud: 'iCloud',
  ics: 'Calendar link',
  holidays: 'Public holidays',
};

/** Small brand-neutral marks for each source (no logos, just colour and a letter). */
export function SourceMark({ source, size = 22 }: { source: CalendarSource; size?: number }) {
  const look: Record<CalendarSource, [string, string]> = {
    sprint2go: ['#2448ff', 'S'],
    google: ['#4285f4', 'G'],
    microsoft: ['#0078d4', 'O'],
    icloud: ['#6b7280', 'i'],
    ics: ['#0ea5e9', ''],
    holidays: ['#dc2626', ''],
  };
  const [bg, letter] = look[source];
  return (
    <span className="src-mark" style={{ background: bg, width: size, height: size, fontSize: size * 0.5 }}>
      {source === 'ics' ? <Link2 size={size * 0.55} /> : source === 'holidays' ? <Globe size={size * 0.55} /> : letter}
    </span>
  );
}

const COUNTRIES = [
  { value: 'id', label: 'Indonesia' },
  { value: 'sg', label: 'Singapore' },
  { value: 'my', label: 'Malaysia' },
  { value: 'au', label: 'Australia' },
];
const COLORS = ['#4285f4', '#0078d4', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#0ea5e9', '#dc2626'];

interface Props {
  me: { id: string; email: string };
  existing: CalendarDef[];
  onConnect: (cals: CalendarDef[]) => void;
  onClose: () => void;
}

/** Connect an outside calendar. In the prototype nothing leaves the browser; the backend does the real sign-in and sync. */
export function ConnectCalendar({ me, existing, onConnect, onClose }: Props) {
  const [source, setSource] = useState<CalendarSource | null>(null);
  const [step, setStep] = useState<'pick' | 'details' | 'connecting'>('pick');
  const [account, setAccount] = useState('');
  const [picked, setPicked] = useState<string[]>(['Personal']);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [country, setCountry] = useState('id');
  const [share, setShare] = useState<'busy' | 'details' | 'private'>('busy');

  const subCals: Record<string, string[]> = { google: ['Personal', 'Family', 'Birthdays'], microsoft: ['Calendar', 'Birthdays'], icloud: ['Home', 'Work'] };
  const choose = (s: CalendarSource) => {
    setSource(s);
    setStep('details');
    setPicked(subCals[s]?.slice(0, 1) ?? []);
    setShare(s === 'holidays' ? 'details' : 'busy');
  };
  const valid =
    source === 'ics'
      ? /^(https?|webcal):\/\/\S+\.\S+/.test(url.trim())
      : source === 'holidays'
        ? true
        : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.trim()) && picked.length > 0;

  const connect = () => {
    if (!source || !valid) return;
    setStep('connecting');
    setTimeout(() => {
      const base = existing.length;
      const make = (n: string, i: number): CalendarDef => ({
        id: `${source}-${Date.now().toString(36)}-${i}`,
        name: n,
        color: COLORS[(base + i) % COLORS.length],
        source,
        account: source === 'ics' || source === 'holidays' ? undefined : account.trim().toLowerCase(),
        url: source === 'ics' ? url.trim() : undefined,
        ownerId: me.id,
        readOnly: source === 'ics' || source === 'holidays',
        share,
        syncedAt: new Date().toISOString(),
      });
      const cals =
        source === 'ics'
          ? [make(name.trim() || 'Bookings', 0)]
          : source === 'holidays'
            ? [make(`${COUNTRIES.find((c) => c.value === country)!.label} holidays`, 0)]
            : picked.map(make);
      onConnect(cals);
    }, 900);
  };

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal connect-modal" role="dialog" aria-label="Add a calendar" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <CalendarDays size={15} /> {step === 'pick' ? 'Add a calendar' : SOURCE_NAME[source!]}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>

        <div className="modal-body">
          {step === 'pick' && (
            <>
              <p className="modal-intro">Bring in the calendars you already use. They show next to your Sprint2go calendar, and teammates only see “Busy” unless you choose otherwise.</p>
              <div className="source-grid">
                {(['google', 'microsoft', 'icloud', 'ics', 'holidays'] as CalendarSource[]).map((s) => (
                  <button key={s} className="source-card" onClick={() => choose(s)}>
                    <SourceMark source={s} size={30} />
                    <span>
                      <strong>{SOURCE_NAME[s]}</strong>
                      <small>
                        {s === 'google' && 'Two way: events you add here show in Google'}
                        {s === 'microsoft' && 'Two way, for Outlook.com and Microsoft 365'}
                        {s === 'icloud' && 'Two way, with an app-specific password'}
                        {s === 'ics' && `Read only: paste an .ics link (bookings, a ${term.one}’s calendar)`}
                        {s === 'holidays' && 'Read only: public holidays for your country'}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 'details' && source && (
            <div className="connect-form">
              {(source === 'google' || source === 'microsoft') && (
                <>
                  <p className="modal-intro">
                    You’ll sign in with {source === 'google' ? 'Google' : 'Microsoft'} in a new window. Sprint2go only asks for calendar access, never your email or files.
                  </p>
                  <label className="field">
                    <span>Account</span>
                    <input autoFocus value={account} onChange={(e) => setAccount(e.target.value)} placeholder={source === 'google' ? 'you@gmail.com' : 'you@outlook.com'} />
                  </label>
                </>
              )}
              {source === 'icloud' && (
                <>
                  <p className="modal-intro">Apple asks for an app-specific password: make one at appleid.apple.com under Sign-In and Security, then paste it here. Your normal Apple ID password won’t work, and that’s on purpose.</p>
                  <label className="field">
                    <span>Apple ID</span>
                    <input autoFocus value={account} onChange={(e) => setAccount(e.target.value)} placeholder="you@icloud.com" />
                  </label>
                  <p className="muted small">The app-specific password is entered on the real connection screen once the backend is live. This prototype doesn’t ask for it.</p>
                </>
              )}
              {subCals[source] && (
                <div className="field">
                  <span>Calendars to show</span>
                  <div className="sub-cals">
                    {subCals[source].map((c) => (
                      <label key={c} className="check-row">
                        <input type="checkbox" checked={picked.includes(c)} onChange={() => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]))} /> {c}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {source === 'ics' && (
                <>
                  <label className="field">
                    <span>Calendar link</span>
                    <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… .ics or webcal://…" />
                  </label>
                  <label className="field">
                    <span>Name</span>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Calendly bookings" />
                  </label>
                  <p className="muted small">Refreshed every 15 minutes. You can’t edit events from a link.</p>
                </>
              )}
              {source === 'holidays' && (
                <div className="field">
                  <span>Country</span>
                  <Select value={country} onChange={setCountry} options={COUNTRIES} label="Country" />
                </div>
              )}
              {source !== 'holidays' && (
                <div className="field">
                  <span>What teammates see</span>
                  <Select<'busy' | 'details' | 'private'>
                    value={share}
                    onChange={setShare}
                    label="What teammates see"
                    options={[
                      { value: 'busy', label: 'Busy only (recommended)', hint: 'They see a busy block, never the title' },
                      { value: 'details', label: 'Full details', hint: 'Titles and places' },
                      { value: 'private', label: 'Nothing', hint: 'Only you see these events' },
                    ]}
                  />
                </div>
              )}
            </div>
          )}

          {step === 'connecting' && (
            <div className="connecting">
              <Loader2 size={22} className="spin" />
              <strong>Connecting and syncing…</strong>
              <span className="muted small">Demo: no real account is contacted.</span>
            </div>
          )}
        </div>

        {step === 'details' && (
          <footer className="modal-foot">
            <button className="ghost-btn" onClick={() => setStep('pick')}>
              <ArrowLeft size={14} /> Back
            </button>
            <span className="spacer" />
            <button className="primary-btn" onClick={connect} disabled={!valid}>
              <Check size={15} /> {source === 'google' ? 'Continue with Google' : source === 'microsoft' ? 'Continue with Microsoft' : source === 'icloud' ? 'Connect iCloud' : 'Add calendar'}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
