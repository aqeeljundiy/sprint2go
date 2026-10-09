import { useState } from 'react';
import { SmoothHeight, TabPane } from './ui/Smooth';
import { term, brand as product } from '../terms';
import { AlertCircle, ArrowLeft, CalendarDays, Check, Globe, Info, Link2, Loader2, X } from 'lucide-react';
import type { CalendarDef, CalendarSource } from '../types';
import { Select } from './ui/Select';
import { HOLIDAY_COUNTRIES, holidayCountry } from '../data/holidays';
import { calendarLinkKey } from '../calendarLink';
import { HolidayCountries } from './HolidayCountries';

export const SOURCE_NAME: Record<CalendarSource, string> = {
  get sprint2go() {
    return product.name;
  },
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

const COLORS = ['#4285f4', '#0078d4', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#0ea5e9', '#dc2626'];

/** Where each calendar app keeps its private link. */
type HowTo = 'google' | 'outlook' | 'apple';
const HOW_TO: Record<HowTo, { name: string; steps: string[] }> = {
  google: {
    name: 'Google',
    steps: [
      'Open Google Calendar on a computer, then Settings (the gear).',
      'On the left, under “Settings for my calendars”, click the calendar.',
      'In “Integrate calendar”, copy “Secret address in iCal format”.',
    ],
  },
  outlook: {
    name: 'Outlook',
    steps: [
      'Open Outlook on the web, then Settings, Calendar, Shared calendars.',
      'Under “Publish a calendar”, pick the calendar and “Can view all details”, then Publish.',
      'Copy the ICS link it shows.',
    ],
  },
  apple: {
    name: 'Apple',
    steps: [
      'Open the Calendar app on your iPhone, or Calendar on iCloud.com.',
      'Tap the info button next to the calendar and turn on Public Calendar.',
      'Tap Share Link and copy the webcal:// address it shows.',
    ],
  },
};

interface Props {
  me: { id: string; email: string };
  existing: CalendarDef[];
  workspace: { id: string; name: string; holidays?: { country: string } };
  isAdmin: boolean;
  /** A real server reads calendar links. Without one (the standalone demo) links are pretend too. */
  live: boolean;
  /** Pretend connections are allowed (the demo). */
  demo: boolean;
  /** Real two-way sync with these is set up on this server. */
  google: boolean;
  microsoft: boolean;
  /** Open straight on this option. */
  start?: CalendarSource;
  onConnect: (cals: CalendarDef[]) => void; // demo: pretend connections, with sample events
  onLinked: (cal: CalendarDef, upcoming: number) => void; // a real calendar link was added; its events arrive from the server
  onHolidays: (country: string | null) => void;
  /** Whose public holidays this person sees (any of our countries; the company's until they choose). */
  holidayRegions?: string[];
  onHolidayRegions?: (codes: string[]) => void;
  onClose: () => void;
}

/** Add an outside calendar: a calendar link (works now), public holidays for the company, or Google, Outlook and iCloud. */
export function ConnectCalendar({ me, existing, workspace: ws, isAdmin, live, demo, google, microsoft, start, onConnect, onLinked, onHolidays, holidayRegions, onHolidayRegions, onClose }: Props) {
  const [source, setSource] = useState<CalendarSource | null>(start ?? null);
  const [step, setStep] = useState<'pick' | 'details' | 'connecting'>(start ? 'details' : 'pick');
  const [account, setAccount] = useState('');
  const [picked, setPicked] = useState<string[]>(['Personal']);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [country, setCountry] = useState(ws.holidays?.country ?? 'ID');
  const [share, setShare] = useState<'busy' | 'details' | 'private'>('busy');
  const [howTo, setHowTo] = useState<HowTo>('google');
  const [via, setVia] = useState<CalendarSource | null>(null); // came from Google, Outlook or iCloud, which aren't ready yet
  const [error, setError] = useState('');

  /** Two-way sync that really works here (or the demo, which pretends). */
  const ready = (s: CalendarSource) => (s === 'google' ? demo || google : s === 'microsoft' ? demo || microsoft : s === 'icloud' ? demo : true);
  const subCals: Record<string, string[]> = { google: ['Personal', 'Family', 'Birthdays'], microsoft: ['Calendar', 'Birthdays'], icloud: ['Home', 'Work'] };
  const choose = (s: CalendarSource) => {
    setError('');
    if (!ready(s)) {
      // Not ready yet: their calendar link works today.
      setVia(s);
      setHowTo(s === 'microsoft' ? 'outlook' : s === 'icloud' ? 'apple' : 'google');
      setSource('ics');
    } else {
      setVia(null);
      setSource(s);
    }
    setStep('details');
    setPicked(subCals[s]?.slice(0, 1) ?? []);
  };
  const linkOk = /^(https?|webcals?):\/\/[^\s/]+\.[^\s]+/i.test(url.trim());
  // The same link added before (webcal or https, a trailing slash, its query in another order): say so instead.
  const linkKey = source === 'ics' && linkOk ? calendarLinkKey(url) : null;
  const dup = linkKey ? existing.find((c) => c.source === 'ics' && !!c.url && calendarLinkKey(c.url) === linkKey) : undefined;
  const valid = source === 'ics' ? linkOk && !dup : source === 'holidays' ? isAdmin && (country || '') !== (ws.holidays?.country ?? '') : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.trim()) && picked.length > 0;
  const holidaysOn = holidayCountry(ws.holidays?.country);

  const connect = async () => {
    if (source === 'holidays' && isAdmin && (country || '') === (ws.holidays?.country ?? '')) return onClose(); // only their own countries changed
    if (!source || !valid) return;
    if (source === 'holidays') return onHolidays(country || null);
    setError('');
    if (source === 'ics' && live) {
      setStep('connecting');
      const r = await fetch('/api/calendars/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), name: name.trim(), share, color: COLORS[existing.length % COLORS.length] }),
      }).catch(() => null);
      const d = (await r?.json().catch(() => null)) as { calendar?: CalendarDef; upcoming?: number; error?: string } | null;
      if (r?.ok && d?.calendar) return onLinked(d.calendar, d.upcoming ?? 0);
      setError(d?.error ?? 'Couldn’t reach the server. Check your connection and try again.');
      setStep('details');
      return;
    }
    // The demo: nothing leaves the browser.
    setStep('connecting');
    setTimeout(() => {
      const base = existing.length;
      const make = (n: string, i: number): CalendarDef => ({
        id: `${source}-${Date.now().toString(36)}-${i}`,
        name: n,
        color: COLORS[(base + i) % COLORS.length],
        source,
        account: source === 'ics' ? undefined : account.trim().toLowerCase(),
        url: source === 'ics' ? url.trim() : undefined,
        ownerId: me.id,
        readOnly: source === 'ics',
        share,
        syncedAt: new Date().toISOString(),
      });
      onConnect(source === 'ics' ? [make(name.trim() || 'Bookings', 0)] : picked.map(make));
    }, 900);
  };

  const shareField = (
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
  );

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
          <SmoothHeight>
            {step === 'pick' && (
              <TabPane key="pick">
                <p className="modal-intro">Bring in the calendars you already use. They show next to your {product.name} calendar, and teammates only see “Busy” unless you choose otherwise.</p>
                <div className="source-grid">
                  {(['ics', 'holidays', 'google', 'microsoft', 'icloud'] as CalendarSource[]).map((s) => (
                    <button key={s} className={`source-card ${ready(s) ? '' : 'later'}`} onClick={() => choose(s)}>
                      <SourceMark source={s} size={30} />
                      <span>
                        <strong>{SOURCE_NAME[s]}</strong>
                        <small>
                          {s === 'ics' && `Paste a private .ics or webcal:// link from Google, Outlook, Apple or a booking tool. Read only, updated every 30 minutes.`}
                          {s === 'holidays' && (holidaysOn ? `${holidaysOn.name}, shown to everyone at ${ws.name}` : `For everyone at ${ws.name}. Pick your country.`)}
                          {s === 'google' && (ready(s) ? 'Two way: events you add here show in Google' : 'Two-way sync isn’t ready yet. Add it with its calendar link for now.')}
                          {s === 'microsoft' && (ready(s) ? 'Two way, for Outlook.com and Microsoft 365' : 'Two-way sync isn’t ready yet. Add it with its calendar link for now.')}
                          {s === 'icloud' && (ready(s) ? 'Two way, with an app-specific password' : 'Two-way sync isn’t ready yet. Add it with its calendar link for now.')}
                        </small>
                      </span>
                      {!ready(s) && <em className="source-tag">Link for now</em>}
                    </button>
                  ))}
                </div>
              </TabPane>
            )}

            {step === 'details' && source && (
              <TabPane key={`details-${source}`}>
                <div className="connect-form">
                  {(source === 'google' || source === 'microsoft') && (
                    <>
                      <p className="modal-intro">
                        You’ll sign in with {source === 'google' ? 'Google' : 'Microsoft'} in a new window. {product.name} only asks for calendar access, never your email or files.
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
                      {via && (
                        <p className="modal-note">
                          <Info size={14} />
                          <span>
                            Signing in with {via === 'google' ? 'Google' : via === 'microsoft' ? 'Microsoft' : 'Apple'} for two-way sync isn’t ready yet. Its calendar link works today: read only, updated every 30 minutes.
                          </span>
                        </p>
                      )}
                      <div className="howto">
                        <div className="howto-head">
                          <span>Where to find the link</span>
                          <div className="segmented sm" role="tablist" aria-label="Calendar app">
                            {(Object.keys(HOW_TO) as HowTo[]).map((h) => (
                              <button key={h} type="button" role="tab" aria-selected={howTo === h} className={howTo === h ? 'on' : ''} onClick={() => setHowTo(h)}>
                                {HOW_TO[h].name}
                              </button>
                            ))}
                          </div>
                        </div>
                        <TabPane key={howTo}>
                          <ol className="howto-steps">
                            {HOW_TO[howTo].steps.map((s) => (
                              <li key={s}>{s}</li>
                            ))}
                          </ol>
                        </TabPane>
                      </div>
                      <label className="field">
                        <span>Calendar link</span>
                        <input
                          autoFocus
                          type="url"
                          inputMode="url"
                          spellCheck={false}
                          autoComplete="off"
                          value={url}
                          onChange={(e) => (setUrl(e.target.value), setError(''))}
                          onKeyDown={(e) => e.key === 'Enter' && valid && void connect()}
                          placeholder="https://… .ics or webcal://…"
                          aria-invalid={!!error}
                        />
                        {error ? (
                          <small className="err link-err" role="alert">
                            <AlertCircle size={13} /> {error}
                          </small>
                        ) : dup ? (
                          <small className="link-dup" role="status">
                            <Info size={13} /> Already added, as “{dup.name}”. It updates by itself every 30 minutes.
                          </small>
                        ) : null}
                      </label>
                      <label className="field">
                        <span>Name</span>
                        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. Personal, or a ${term.one}’s bookings`} maxLength={80} />
                      </label>
                    </>
                  )}

                  {source === 'holidays' &&
                    (isAdmin ? (
                      <>
                        <p className="modal-intro">Public holidays show as all-day items in everyone’s calendar at {ws.name}, and tasks due on a holiday get a note.</p>
                        <div className="field">
                          <span>Country for everyone</span>
                          <Select
                            value={country}
                            onChange={setCountry}
                            label="Country"
                            searchable
                            options={[...HOLIDAY_COUNTRIES.map((c) => ({ value: c.code, label: c.name })), ...(ws.holidays ? [{ value: '', label: 'No public holidays', hint: 'Remove them for everyone' }] : [])]}
                          />
                        </div>
                      </>
                    ) : (
                      <p className="modal-intro">
                        {holidaysOn ? `${ws.name} shows public holidays in ${holidaysOn.name} to everyone. Only owners and admins can change the company’s country, in Settings, General.` : `${ws.name} doesn’t show public holidays yet. Ask an owner or admin to pick the country, in Settings, General.`}
                      </p>
                    ))}
                  {source === 'holidays' && holidayRegions && onHolidayRegions && (
                    <div className="field">
                      <span>Countries you see (just you)</span>
                      <HolidayCountries field regions={holidayRegions} company={ws.holidays?.country} companyName={ws.name} onChange={onHolidayRegions} />
                    </div>
                  )}

                  {source !== 'holidays' && shareField}
                  {source === 'ics' && <p className="muted small">The link stays private to you: teammates never see it. These events are read only here; change them in the calendar they come from.</p>}
                </div>
              </TabPane>
            )}

            {step === 'connecting' && (
              <TabPane key="connecting">
                <div className="connecting">
                  <Loader2 size={22} className="spin" />
                  {source === 'ics' && live ? (
                    <>
                      <strong>Reading the calendar…</strong>
                      <span className="muted small">This takes a few seconds.</span>
                    </>
                  ) : (
                    <>
                      <strong>Connecting and syncing…</strong>
                      <span className="muted small">Demo: no real account is contacted.</span>
                    </>
                  )}
                </div>
              </TabPane>
            )}
          </SmoothHeight>
        </div>

        {step === 'details' && (
          <footer className="modal-foot">
            {!start && (
              <button className="ghost-btn" onClick={() => (setStep('pick'), setError(''))}>
                <ArrowLeft size={14} /> Back
              </button>
            )}
            <span className="spacer" />
            {source === 'holidays' && !isAdmin ? (
              <button className="primary-btn" onClick={onClose}>
                Got it
              </button>
            ) : (
              <button className="primary-btn" onClick={() => void connect()} disabled={!valid && !(source === 'holidays' && isAdmin)}>
                <Check size={15} />{' '}
                {source === 'google'
                  ? 'Continue with Google'
                  : source === 'microsoft'
                    ? 'Continue with Microsoft'
                    : source === 'icloud'
                      ? 'Connect iCloud'
                      : source === 'holidays'
                        ? (country || '') === (ws.holidays?.country ?? '')
                          ? 'Done'
                          : !country
                            ? 'Remove holidays'
                            : ws.holidays
                              ? 'Change country'
                              : 'Show holidays'
                        : 'Add calendar'}
              </button>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}
