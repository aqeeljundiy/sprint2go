import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Eye, Lock, Mail, PenLine, Plug, X } from 'lucide-react';
import { BrandMark } from './SignIn';
import { SmoothHeight, TabPane } from './ui/Smooth';
import { WorkspaceLogo } from './WorkspaceLogo';
import { EmptyState } from './ui/EmptyState';
import { Badge } from './ui/Person';
import { signOut } from '../sync';
import '../connector.css';
import { t } from '../i18n';
import { tj } from '../i18n/tj';

interface Company {
  id: string;
  name: string;
  color?: string;
  logo?: string;
  demo?: boolean;
  off?: boolean; // its admins switched AI apps off
}
interface Ask {
  app: { name: string; host: string };
  me: { name: string; email: string };
  companies: Company[];
}
type Step = 'loading' | 'ask' | 'error' | 'going';

/**
 * The consent screen at /oauth/authorize: an AI app (Claude, ChatGPT and others that speak MCP) asks to work in
 * sprint2go as this person. They're signed in already (with two-step sign-in when it's on); here they pick the company
 * it may reach, read in plain words what it can do, and Allow or Cancel. Either way the app hears back
 * (server/connector.ts, server/oauth.ts).
 */
export function ConnectApp({ actingAs }: { actingAs?: string }) {
  const query = useMemo(() => Object.fromEntries(new URLSearchParams(location.search)), []);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [step, setStep] = useState<Step>('loading');
  const [error, setError] = useState<{ text: string; redirect?: string } | null>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [going, setGoing] = useState<{ allowed: boolean; to: string } | null>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/oauth/request?${new URLSearchParams(query)}`)
      .then((r) => r.json())
      .then((d: Ask & { error?: string; redirect?: string }) => {
        if (d.error) return (setError({ text: d.error, redirect: d.redirect }), setStep('error'));
        setAsk(d);
        setPick(d.companies.find((c) => !c.off)?.id ?? '');
        setStep('ask');
      })
      .catch(() => (setError({ text: t('Couldn’t reach sprint2go. Check your connection, then reload this page.') }), setStep('error')));
  }, [query]);

  const answer = async (allow: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/oauth/consent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, workspaceId: pick, allow }) });
      const d = (await r.json().catch(() => ({}))) as { redirect?: string; error?: string };
      if (!d.redirect) throw new Error(d.error ?? t('That didn’t work. Try again.'));
      setGoing({ allowed: allow, to: d.redirect });
      setStep('going');
      // A moment to read "Connected" before the app takes over.
      setTimeout(() => location.assign(d.redirect!), 700);
    } catch (e) {
      setError({ text: (e as Error).message });
      setBusy(false);
    }
  };

  const open = ask?.companies.filter((c) => !c.off) ?? [];
  const company = ask?.companies.find((c) => c.id === pick);
  const app = ask?.app.name ?? t('The app');
  /** Up and down move through the companies that can be picked, like any list of choices. */
  const keys = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = open.findIndex((c) => c.id === pick);
    const next = open[(i + (e.key === 'ArrowDown' ? 1 : open.length - 1)) % open.length];
    if (!next) return;
    setPick(next.id);
    list.current?.querySelector<HTMLButtonElement>(`[data-id="${CSS.escape(next.id)}"]`)?.focus();
  };

  return (
    <div className="signin cn-page">
      <div className="signin-card cn-card">
        <BrandMark />
        <SmoothHeight className="cn-body">
          <TabPane key={step}>
            {step === 'loading' && <p className="cn-wait muted small">{t('Checking what the app asked for…')}</p>}

            {step === 'error' && (
              <div className="cn-center">
                <span className="cn-icon warn">
                  <X size={20} />
                </span>
                <h1>{t('This link can’t be used')}</h1>
                <p className="signin-sub">{error?.text}</p>
                {error?.redirect ? (
                  <button className="primary-btn signin-btn" onClick={() => location.assign(error.redirect!)}>
                    {t('Back to the app')}
                  </button>
                ) : (
                  <a className="primary-btn signin-btn" href="/">
                    {t('Open sprint2go')}
                  </a>
                )}
              </div>
            )}

            {step === 'going' && going && (
              <div className="cn-center">
                <span className={`cn-icon ${going.allowed ? 'good' : ''} cn-pop`}>{going.allowed ? <Check size={20} /> : <X size={20} />}</span>
                <h1>{going.allowed ? t('{app} is connected', { app }) : t('Cancelled')}</h1>
                <p className="signin-sub">{going.allowed ? (company ? t('Taking you back to {app}. It can now reach {company} as you.', { app, company: company.name }) : t('Taking you back to {app}. It can now reach your company as you.', { app })) : t('Nothing was shared. Taking you back to {app}.', { app })}</p>
                <button className="link-btn" onClick={() => location.assign(going.to)}>
                  {t('Go back now')}
                </button>
              </div>
            )}

            {step === 'ask' && ask && (
              <>
                <div className="cn-center">
                  <span className="cn-icon">
                    <Plug size={20} />
                  </span>
                  <h1>{t('Connect {app} to sprint2go', { app })}</h1>
                  <p className="signin-sub">{t('{app} wants to work in sprint2go as you. Nothing is shared until you allow it.', { app: ask.app.host ? `${app} (${ask.app.host})` : app })}</p>
                </div>

                {open.length === 0 && !ask.companies.length ? (
                  <EmptyState compact title={t('Nothing to connect yet')} text={t('AI apps connect to a company you’re on the team of. Guests of a project can’t connect them.')} />
                ) : (
                  <section className="cn-section">
                    <h2 id="cn-which">{t('Which company it can reach')}</h2>
                    <div className="cn-companies" role="radiogroup" aria-labelledby="cn-which" ref={list} onKeyDown={keys}>
                      {ask.companies.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          role="radio"
                          data-id={c.id}
                          aria-checked={pick === c.id}
                          tabIndex={pick === c.id || (!pick && c === open[0]) ? 0 : -1}
                          disabled={c.off}
                          className={`cn-company ${pick === c.id ? 'on' : ''}`}
                          onClick={() => setPick(c.id)}
                        >
                          <WorkspaceLogo ws={{ name: c.name, logo: c.logo, color: c.color ?? '#64748b' }} size={32} />
                          <span className="cn-company-text">
                            <strong>
                              {c.name} {c.demo && <Badge small>{t('Demo')}</Badge>}
                            </strong>
                            {c.off ? <small>{t('Its admins switched AI apps off')}</small> : c.demo ? <small>{t('Your private demo company: nothing in it is real')}</small> : null}
                          </span>
                          <span className="cn-radio" aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {company && (
                  <section className="cn-section">
                    <h2>{t('What it can do in {company}', { company: company.name })}</h2>
                    <ul className="cn-can">
                      <li>
                        <Eye size={16} />
                        <span>{t('Read what you can read: what needs you, your mail, tasks, chat, calendar, notes and tables.')}</span>
                      </li>
                      <li>
                        <PenLine size={16} />
                        <span>{t('Make and change tasks, notes and table rows, post in team channels and add events, all as you.')}</span>
                      </li>
                      <li>
                        <Mail size={16} />
                        <span>{t('Email and messages to guests stay drafts. You send them yourself, in sprint2go.')}</span>
                      </li>
                      <li>
                        <Lock size={16} />
                        <span>{t('It never sees more than you do. Disconnect it any time in Settings, Account.')}</span>
                      </li>
                    </ul>
                  </section>
                )}

                {actingAs && <p className="signin-error">{t('You’re signed in as this person from the operator console, so you can’t connect apps for them.')}</p>}
                {error && <p className="signin-error">{error.text}</p>}

                <div className="cn-actions">
                  <button className="ghost-btn" disabled={busy} onClick={() => void answer(false)}>
                    {t('Cancel')}
                  </button>
                  <button className="primary-btn" disabled={busy || !company || !!actingAs} onClick={() => void answer(true)}>
                    {busy ? t('Connecting…') : t('Allow')}
                  </button>
                </div>
                <p className="signin-switch cn-who">
                  {tj('Signed in as {email}. {notYou}', {
                    email: ask.me.email || ask.me.name,
                    notYou: (
                      <button type="button" className="link-btn" onClick={() => void signOut()}>
                        {t('Not you?')}
                      </button>
                    ),
                  })}
                </p>
              </>
            )}
          </TabPane>
        </SmoothHeight>
      </div>
    </div>
  );
}
