import { useEffect, useRef, useState } from 'react';
import { BellOff, BellRing, Monitor, Plus, Share, Smartphone, type LucideIcon } from 'lucide-react';
import { SmoothHeight, TabPane } from './ui/Smooth';
import { brand as product, term } from '../terms';
import type { Settings } from '../settings';
import { isIOS, pushState, sendTest, turnOff, turnOn, type PushState } from '../push';
import { Select } from './ui/Select';
import { server } from '../sync';
import { caps } from '../caps';

type Kind = 'notifyMessages' | 'notifyNewMail' | 'notifyTasks' | 'notifyGuests' | 'notifyEvents' | 'notifyOther';

/** Settings, Notifications: this device (on, off, blocked, or what it needs first) and what to send. */
export function NotificationSettings({ s, update }: { s: Settings; update: (p: Partial<Settings>) => void }) {
  const [state, setState] = useState<PushState | null>(null); // null while checking
  const [busy, setBusy] = useState<'' | 'on' | 'off' | 'test'>('');
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const lastNote = useRef(note); // kept while the note folds away
  if (note) lastNote.current = note;

  useEffect(() => {
    let live = true;
    const check = () => void pushState().then((x) => live && setState(x));
    check();
    // Back from the browser's or the phone's settings (allowed them there): look again.
    const again = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', again);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', again);
    };
  }, []);

  const on = async () => {
    setBusy('on');
    setNote(null);
    const r = await turnOn();
    setBusy('');
    setState(r.state);
    if (r.error) setNote({ text: r.error, error: true });
  };
  const off = async () => {
    setBusy('off');
    setNote(null);
    setState(await turnOff());
    setBusy('');
  };
  const test = async () => {
    setBusy('test');
    const err = await sendTest();
    setBusy('');
    setNote(err ? { text: err, error: true } : { text: 'Sent. It arrives in a few seconds; if it doesn’t, check that notifications are allowed for this browser in your device’s settings.' });
  };

  // Teammates' away email (server/digest.ts) needs a server that can send mail; the demo shows the choice.
  const mailOn = !server.on || caps.demo || caps.emailNotes;
  const zoneName = (s.timeZone ?? '').split('/').pop()?.replace(/_/g, ' ') ?? '';
  const emailHint = !mailOn
    ? 'This server can’t send email yet, so this is off. Everything still shows in the bell.'
    : s.emailDigest === 'off'
      ? 'Off: only the bell, and notifications on your devices.'
      : `When you haven’t opened ${product.name} for ${s.emailDigest === 'hourly' ? 'an hour' : 'a while'}: one email with your unread messages and mentions, tasks given to you and replies to your email. Never anything you’ve already seen.`;

  const ios = isIOS();
  const android = /Android/i.test(navigator.userAgent);
  const card: Record<PushState | 'checking', { icon: LucideIcon; title: string; text: string; tone?: 'on' | 'warn' }> = {
    checking: { icon: BellRing, title: 'Checking this device…', text: ' ' },
    demo: { icon: BellOff, title: 'Not available in this demo', text: `Notifications on phones and computers need the ${product.name} server.` },
    desktop: { icon: Monitor, title: 'On while the desktop app is open', text: `You get a notification when something comes in and ${product.name} isn’t the window in front. Your computer may ask you to allow them the first time.`, tone: 'on' },
    unsupported: { icon: BellOff, title: 'This browser can’t show notifications', text: ios ? `Update to iOS 16.4 or later, then open ${product.name} from your Home Screen.` : `Open ${product.name} in Chrome, Edge, Firefox or Safari to get them on this device.` },
    'ios-install': { icon: Smartphone, title: `Add ${product.name} to your Home Screen first`, text: 'On iPhone and iPad, notifications only work in the app on your Home Screen, not in a Safari tab.' },
    blocked: {
      icon: BellOff,
      title: 'Blocked by this browser',
      text: ios ? `Allow them in your iPhone’s Settings, Notifications, ${product.name}. Then come back here.` : android ? 'Allow them in your phone’s settings for this app or browser (Notifications). Then come back here.' : 'Allow them in this site’s settings: click the icon next to the address, then Notifications. Then come back here.',
      tone: 'warn',
    },
    off: { icon: BellRing, title: 'Off on this device', text: 'Get a notification here when someone messages you, gives you a task or emails you while you’re away.' },
    on: { icon: BellRing, title: 'On for this device', text: `You get notifications here when you’re away from ${product.name}. Nothing buzzes while you’re using it.`, tone: 'on' },
  };
  const c = card[state ?? 'checking'];

  const kinds: { key: Kind; label: string; hint: string }[] = [
    { key: 'notifyMessages', label: 'Messages and mentions', hint: 'Direct messages, @mentions and replies to you.' },
    { key: 'notifyNewMail', label: 'Email', hint: 'New mail in your inbox, and email assigned to you in a shared inbox. Never newsletters or spam.' },
    { key: 'notifyTasks', label: 'Tasks', hint: 'Tasks given to you, reminders when they’re due, comments and reviews.' },
    { key: 'notifyGuests', label: `${term.Whos}`, hint: `Messages, comments and approvals from ${term.whos} on your ${term.many}.` },
    { key: 'notifyEvents', label: 'Meetings and events', hint: 'A reminder 10 minutes before each event on your calendar, and when meeting notes are ready.' },
    { key: 'notifyOther', label: 'Everything else', hint: 'Finished work, team changes and other updates.' },
  ];

  return (
    <>
      <h2>Notifications</h2>
      <p className="set-intro">Everything shows in the bell. Choose what also reaches your phone and computer while you’re away from {product.name}.</p>

      <h3>This device</h3>
      <SmoothHeight>
        <div className={`push-card ${c.tone ?? ''}`} aria-live="polite">
          <TabPane key={state ?? 'checking'}>
            <div className="push-card-top">
              <span className="push-icon" aria-hidden="true">
                <c.icon size={18} />
              </span>
              <span className="push-text">
                <strong>{c.title}</strong>
                <small>{c.text}</small>
              </span>
            </div>
            {state === 'ios-install' && (
              <ol className="push-steps">
                <li>
                  <span className="push-step-n">1</span>
                  <span>
                    Tap <Share size={15} aria-hidden="true" /> <b>Share</b> in Safari’s toolbar
                  </span>
                </li>
                <li>
                  <span className="push-step-n">2</span>
                  <span>
                    Choose <Plus size={15} aria-hidden="true" /> <b>Add to Home Screen</b>, then <b>Add</b>
                  </span>
                </li>
                <li>
                  <span className="push-step-n">3</span>
                  <span>Open {product.name} from your Home Screen and come back to this page</span>
                </li>
              </ol>
            )}
            {(state === 'off' || state === 'on' || state === 'blocked') && (
              <div className="push-actions">
                {state === 'off' && (
                  <button className="primary-btn" disabled={!!busy} onClick={() => void on()}>
                    {busy === 'on' ? 'Turning on…' : 'Turn on notifications on this device'}
                  </button>
                )}
                {state === 'on' && (
                  <>
                    <button className="ghost-btn outline" disabled={!!busy} onClick={() => void test()}>
                      {busy === 'test' ? 'Sending…' : 'Send a test'}
                    </button>
                    <button className="ghost-btn" disabled={!!busy} onClick={() => void off()}>
                      {busy === 'off' ? 'Turning off…' : 'Turn off on this device'}
                    </button>
                  </>
                )}
                {state === 'blocked' && (
                  <button className="ghost-btn outline" onClick={() => void pushState().then(setState)}>
                    Check again
                  </button>
                )}
              </div>
            )}
          </TabPane>
          <div className={`fold push-fold ${note ? 'open' : ''}`}>
            <div>
              <p key={lastNote.current?.text} className={`push-note ${lastNote.current?.error ? 'error' : ''}`}>
                {lastNote.current?.text}
              </p>
            </div>
          </div>
        </div>
      </SmoothHeight>

      <h3>What to send</h3>
      {kinds.map((k) => (
        <label key={k.key} className="set-row toggle-row">
          <span>
            <strong>{k.label}</strong>
            <small>{k.hint}</small>
          </span>
          <button role="switch" aria-checked={s[k.key]} className={`switch ${s[k.key] ? 'on' : ''}`} onClick={() => update({ [k.key]: !s[k.key] } as Partial<Settings>)}>
            <span />
          </button>
        </label>
      ))}
      <small className="set-hint">These apply to every device you turn notifications on for, to the desktop app, and to the email below.</small>

      <h3>Email when you’re away</h3>
      <div className="set-row">
        <span>
          <strong>What’s waiting, by email</strong>
          <small>{emailHint}</small>
        </span>
        <Select<Settings['emailDigest']>
          value={mailOn ? s.emailDigest : 'off'}
          onChange={(v) => update({ emailDigest: v })}
          label="Email when you’re away"
          disabled={!mailOn}
          width={240}
          options={[
            { value: 'daily', label: 'Daily at 9:00', hint: zoneName ? `${zoneName} time` : undefined },
            { value: 'hourly', label: 'Every hour', hint: 'After an hour away' },
            { value: 'off', label: 'Off', hint: 'The bell and notifications only' },
          ]}
        />
      </div>
    </>
  );
}
