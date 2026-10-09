import { useEffect, useRef, useState } from 'react';
import { BellOff, BellRing, Monitor, Plus, Share, Smartphone, type LucideIcon } from 'lucide-react';
import { SmoothHeight, TabPane } from './ui/Smooth';
import { brand as product, term } from '../terms';
import type { Settings } from '../settings';
import { isIOS, pushState, sendTest, turnOff, turnOn, type PushState } from '../push';
import { Select } from './ui/Select';
import { server } from '../sync';
import { caps } from '../caps';
import { mark, t } from '../i18n';
import { tj } from '../i18n/tj';
import { fmtTime } from '../i18n/format';

type Kind = 'notifyMessages' | 'notifyNewMail' | 'notifyTasks' | 'notifyGuests' | 'notifyEvents' | 'notifyOther';

/** Settings, Notifications: this device (on, off, blocked, or what it needs first) and what to send. */
export function NotificationSettings({ s, update }: { s: Settings; update: (p: Partial<Settings>) => void }) {
  const [state, setState] = useState<PushState | null>(null); // null while checking
  const [busy, setBusy] = useState<'' | 'on' | 'off' | 'test'>('');
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null); // English, translated where it's shown
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
    setNote(err ? { text: err, error: true } : { text: mark('Sent. It arrives in a few seconds; if it doesn’t, check that notifications are allowed for this browser in your device’s settings.') });
  };

  // Teammates' away email (server/digest.ts) needs a server that can send mail; the demo shows the choice.
  const mailOn = !server.on || caps.demo || caps.emailNotes;
  const zoneName = (s.timeZone ?? '').split('/').pop()?.replace(/_/g, ' ') ?? '';
  const emailHint = !mailOn
    ? t('This server can’t send email yet, so this is off. Everything still shows in the bell.')
    : s.emailDigest === 'off'
      ? t('Off: only the bell, and notifications on your devices.')
      : s.emailDigest === 'hourly'
        ? t('When you haven’t opened {product} for an hour: one email with your unread messages and mentions, tasks given to you and replies to your email. Never anything you’ve already seen.', { product: product.name })
        : t('When you haven’t opened {product} for a while: one email with your unread messages and mentions, tasks given to you and replies to your email. Never anything you’ve already seen.', { product: product.name });

  const ios = isIOS();
  const android = /Android/i.test(navigator.userAgent);
  const card: Record<PushState | 'checking', { icon: LucideIcon; title: string; text: string; tone?: 'on' | 'warn' }> = {
    checking: { icon: BellRing, title: t('Checking this device…'), text: ' ' },
    demo: { icon: BellOff, title: t('Not available in this demo'), text: t('Notifications on phones and computers need the {product} server.', { product: product.name }) },
    desktop: { icon: Monitor, title: t('On while the desktop app is open'), text: t('You get a notification when something comes in and {product} isn’t the window in front. Your computer may ask you to allow them the first time.', { product: product.name }), tone: 'on' },
    unsupported: { icon: BellOff, title: t('This browser can’t show notifications'), text: ios ? t('Update to iOS 16.4 or later, then open {product} from your Home Screen.', { product: product.name }) : t('Open {product} in Chrome, Edge, Firefox or Safari to get them on this device.', { product: product.name }) },
    'ios-install': { icon: Smartphone, title: t('Add {product} to your Home Screen first', { product: product.name }), text: t('On iPhone and iPad, notifications only work in the app on your Home Screen, not in a Safari tab.') },
    blocked: {
      icon: BellOff,
      title: t('Blocked by this browser'),
      text: ios ? t('Allow them in your iPhone’s Settings, Notifications, {product}. Then come back here.', { product: product.name }) : android ? t('Allow them in your phone’s settings for this app or browser (Notifications). Then come back here.') : t('Allow them in this site’s settings: click the icon next to the address, then Notifications. Then come back here.'),
      tone: 'warn',
    },
    off: { icon: BellRing, title: t('Off on this device'), text: t('Get a notification here when someone messages you, gives you a task or emails you while you’re away.') },
    on: { icon: BellRing, title: t('On for this device'), text: t('You get notifications here when you’re away from {product}. Nothing buzzes while you’re using it.', { product: product.name }), tone: 'on' },
  };
  const c = card[state ?? 'checking'];

  const kinds: { key: Kind; label: string; hint: string }[] = [
    { key: 'notifyMessages', label: t('Messages and mentions'), hint: t('Direct messages, @mentions and replies to you.') },
    { key: 'notifyNewMail', label: t('Email'), hint: t('New mail in your inbox, and email assigned to you in a shared inbox. Never newsletters or spam.') },
    { key: 'notifyTasks', label: t('Tasks'), hint: t('Tasks given to you, reminders when they’re due, comments and reviews.') },
    { key: 'notifyGuests', label: term.Whos, hint: t('Messages, comments and approvals from {whos} on your {projects}.', { whos: term.whos, projects: term.many }) },
    { key: 'notifyEvents', label: t('Meetings and events'), hint: t('A reminder 10 minutes before each event on your calendar, and when meeting notes are ready.') },
    { key: 'notifyOther', label: t('Everything else'), hint: t('Finished work, team changes and other updates.') },
  ];

  return (
    <>
      <h2>{t('Notifications')}</h2>
      <p className="set-intro">{t('Everything shows in the bell. Choose what also reaches your phone and computer while you’re away from {product}.', { product: product.name })}</p>

      <h3>{t('This device')}</h3>
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
                    {tj('Tap {share} in Safari’s toolbar', {
                      share: (
                        <>
                          <Share size={15} aria-hidden="true" /> <b>{t('Share')}</b>
                        </>
                      ),
                    })}
                  </span>
                </li>
                <li>
                  <span className="push-step-n">2</span>
                  <span>
                    {tj('Choose {addToHome}, then {add}', {
                      addToHome: (
                        <>
                          <Plus size={15} aria-hidden="true" /> <b>{t('Add to Home Screen')}</b>
                        </>
                      ),
                      add: <b>{t('Add')}</b>,
                    })}
                  </span>
                </li>
                <li>
                  <span className="push-step-n">3</span>
                  <span>{t('Open {product} from your Home Screen and come back to this page', { product: product.name })}</span>
                </li>
              </ol>
            )}
            {(state === 'off' || state === 'on' || state === 'blocked') && (
              <div className="push-actions">
                {state === 'off' && (
                  <button className="primary-btn" disabled={!!busy} onClick={() => void on()}>
                    {busy === 'on' ? t('Turning on…') : t('Turn on notifications on this device')}
                  </button>
                )}
                {state === 'on' && (
                  <>
                    <button className="ghost-btn outline" disabled={!!busy} onClick={() => void test()}>
                      {busy === 'test' ? t('Sending…') : t('Send a test')}
                    </button>
                    <button className="ghost-btn" disabled={!!busy} onClick={() => void off()}>
                      {busy === 'off' ? t('Turning off…') : t('Turn off on this device')}
                    </button>
                  </>
                )}
                {state === 'blocked' && (
                  <button className="ghost-btn outline" onClick={() => void pushState().then(setState)}>
                    {t('Check again')}
                  </button>
                )}
              </div>
            )}
          </TabPane>
          <div className={`fold push-fold ${note ? 'open' : ''}`}>
            <div>
              <p key={lastNote.current?.text} className={`push-note ${lastNote.current?.error ? 'error' : ''}`}>
                {lastNote.current && t(lastNote.current.text)}
              </p>
            </div>
          </div>
        </div>
      </SmoothHeight>

      <h3>{t('What to send')}</h3>
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
      <small className="set-hint">{t('These apply to every device you turn notifications on for, to the desktop app, and to the email below.')}</small>

      <h3>{t('Email when you’re away')}</h3>
      <div className="set-row">
        <span>
          <strong>{t('What’s waiting, by email')}</strong>
          <small>{emailHint}</small>
        </span>
        <Select<Settings['emailDigest']>
          value={mailOn ? s.emailDigest : 'off'}
          onChange={(v) => update({ emailDigest: v })}
          label={t('Email when you’re away')}
          disabled={!mailOn}
          width={240}
          options={[
            { value: 'daily', label: t('Daily at {time}', { time: fmtTime(new Date(2000, 0, 1, 9)) }), hint: zoneName ? t('{zone} time', { zone: zoneName }) : undefined },
            { value: 'hourly', label: t('Every hour'), hint: t('After an hour away') },
            { value: 'off', label: t('Off'), hint: t('The bell and notifications only') },
          ]}
        />
      </div>
    </>
  );
}
