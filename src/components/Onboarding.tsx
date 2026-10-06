import { useState } from 'react';
import { term } from '../terms';
import { Check, Cloud, Copy, Loader2, Mail, MailX, Server, Shuffle, X, type LucideIcon } from 'lucide-react';
import type { Account, AppId, EmailSetup, MailProvider, MeetingSettings, User, Workspace } from '../types';
import { DEFAULT_MEETINGS, WORKSPACE_COLORS, defaultAI, trialPlan } from '../data/workspaces';
import { uid } from '../utils';
import { APPS } from './AppRail';
import { BrandFields } from './WorkspaceForms';
import { Select } from './ui/Select';

export const PROVIDERS: { id: MailProvider; name: string }[] = [
  { id: 'google', name: 'Google Workspace' },
  { id: 'microsoft', name: 'Microsoft 365' },
  { id: 'zoho', name: 'Zoho Mail' },
  { id: 'imap', name: 'Other (IMAP)' },
];
export const providerName = (p?: MailProvider) => (p === 'sprint2go' || !p ? 'Sprint2go' : PROVIDERS.find((x) => x.id === p)?.name ?? 'Other');

const SETUPS: { id: EmailSetup; icon: LucideIcon; title: string; body: string }[] = [
  { id: 'keep', icon: Cloud, title: 'Keep our current email', body: 'Mail stays at Google, Microsoft or Zoho. Each person connects their account and sees it here too, in sync both ways.' },
  { id: 'mix', icon: Shuffle, title: 'Mix: some people on Sprint2go', body: 'Your domain stays where it is. Move the people who don’t need a pricey licence to Sprint2go mailboxes.' },
  { id: 'hosted', icon: Server, title: 'Move fully to Sprint2go', body: 'We host all your mail. Cheapest per person. We check your DNS records and can import old mail.' },
  { id: 'none', icon: MailX, title: 'We don’t need email here', body: 'Switch Mail off. Use Chat, Tasks, Calendar and the rest.' },
];

interface Invite {
  key: number;
  name: string;
  email: string;
  role: 'admin' | 'member';
  where: 'sprint2go' | 'existing';
}

interface Props {
  me: User;
  existingEmails: string[];
  onCreate: (w: Workspace, newUsers: User[]) => void;
  onClose: () => void;
}

const COLORS = ['#10b981', '#f59e0b', '#0ea5e9', '#d946ef', '#ef4444', '#14b8a6', '#8b5cf6'];

/** New company: brand → apps → email setup → team. */
export function Onboarding({ me, existingEmails, onCreate, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [brand, setBrand] = useState<Pick<Workspace, 'name' | 'logo' | 'color'>>({ name: '', color: WORKSPACE_COLORS[0] });
  const [domain, setDomain] = useState('');
  const [apps, setApps] = useState<AppId[]>(APPS.map((a) => a.id));
  const [setup, setSetup] = useState<EmailSetup>('keep');
  const [provider, setProvider] = useState<MailProvider>('google');
  const [emailInput, setMyEmail] = useState('');
  const [keep, setKeep] = useState<MeetingSettings['keep']>('video');
  const [dns, setDns] = useState<'idle' | 'checking' | 'ok'>('idle');
  const [team, setTeam] = useState<Invite[]>([{ key: 1, name: '', email: '', role: 'member', where: 'sprint2go' }]);
  const [copied, setCopied] = useState<string | null>(null);

  const d = domain.trim().toLowerCase().replace(/^@/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  // The suggested address (firstname@domain) counts until the person types their own.
  const suggested = d ? `${me.name.split(' ')[0].toLowerCase()}@${d}` : '';
  const myEmail = emailInput.trim() || suggested;
  const mailOn = setup !== 'none';
  const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const steps = ['Company', 'Apps', 'Email', 'Team'];

  const canNext = [
    brand.name.trim().length > 1 && /\./.test(d) && emailOk(myEmail) && myEmail.toLowerCase().endsWith('@' + d),
    apps.length > 0,
    true,
    team.every((t) => (!t.email && !t.name) || (emailOk(t.email) && t.name.trim() && !existingEmails.includes(t.email.toLowerCase()))),
  ][step];

  const records = [
    { type: 'MX', host: '@', value: 'mx.sprint2go.com', note: 'Priority 10. Delivers your mail to Sprint2go' },
    { type: 'TXT', host: '@', value: 'v=spf1 include:amazonses.com include:spf.sprint2go.com ~all', note: 'Lets us send on your behalf' },
    { type: 'CNAME', host: 's2g._domainkey', value: `s2g.${d || 'yourdomain.com'}.dkim.sprint2go.com`, note: 'Signs your mail (DKIM)' },
    { type: 'TXT', host: '_dmarc', value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${d || 'yourdomain.com'}`, note: 'Protects your domain from spoofing' },
  ];

  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(v);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked: the value is selectable */
    }
  };

  const finish = () => {
    const wsId = uid();
    const people = team.filter((t) => t.email && t.name);
    const newUsers: User[] = people.map((t, i) => ({ id: uid(), name: t.name.trim(), email: t.email.trim().toLowerCase(), title: '', color: COLORS[i % COLORS.length] }));
    const providerFor = (where: Invite['where'] | 'me'): MailProvider => {
      if (setup === 'hosted') return 'sprint2go';
      if (setup === 'keep') return provider;
      return where === 'existing' ? provider : 'sprint2go';
    };
    const accounts: Account[] = mailOn
      ? [
          { id: uid(), email: myEmail.trim().toLowerCase(), name: me.name, kind: 'personal', connected: false, users: [me.id], provider: providerFor(setup === 'mix' ? 'existing' : 'me') },
          ...newUsers.map((u, i) => ({ id: uid(), email: u.email, name: u.name, kind: 'personal' as const, connected: false, users: [u.id], provider: providerFor(people[i].where) })),
        ]
      : [];
    onCreate(
      {
        id: wsId,
        name: brand.name.trim(),
        logo: brand.logo,
        color: brand.color,
        domains: d ? [d] : [],
        accounts,
        members: [{ userId: me.id, role: 'owner' }, ...newUsers.map((u, i) => ({ userId: u.id, role: people[i].role }))],
        apps: mailOn ? apps : apps.filter((a) => a !== 'mail'),
        emailSetup: setup,
        emailProvider: setup === 'hosted' || setup === 'none' ? undefined : provider,
        plan: trialPlan(brand.name.trim(), myEmail),
        ai: defaultAI(false),
        meetings: { ...DEFAULT_MEETINGS, keep, clientMeetings: keep, internalMeetings: keep === 'video' ? 'audio' : keep },
      },
      newUsers,
    );
  };

  return (
    <div className="onboard">
      <div className="onboard-card">
        <header className="onboard-head">
          <div className="ob-steps">
            {steps.map((s, i) => (
              <span key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>
                <b>{i < step ? <Check size={12} /> : i + 1}</b> {s}
              </span>
            ))}
          </div>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="onboard-body" key={step}>
          {step === 0 && (
            <>
              <h2>Set up your company</h2>
              <p className="set-intro">This becomes your workspace: your brand, your people, your {term.many}.</p>
              <div className="field">
                <label htmlFor="ob-name">Company name</label>
                <input id="ob-name" autoFocus value={brand.name} onChange={(e) => setBrand({ ...brand, name: e.target.value })} placeholder="e.g. Nusa Creative" />
              </div>
              <BrandFields value={brand} onChange={(p) => setBrand({ ...brand, ...p })} />
              <div className="field">
                <label htmlFor="ob-domain">Company domain</label>
                <input id="ob-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="nusacreative.com" />
              </div>
              <div className="field">
                <label htmlFor="ob-email">Your work email</label>
                <input id="ob-email" value={emailInput} onChange={(e) => setMyEmail(e.target.value)} placeholder={suggested || 'you@company.com'} />
                {emailInput && d && !myEmail.toLowerCase().endsWith('@' + d) && <small className="err">Use an address at @{d}.</small>}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h2>Which apps do you want?</h2>
              <p className="set-intro">Switch on what your team needs. You can change this any time.</p>
              <div className="ob-apps">
                {APPS.map(({ id, name, icon: Icon }) => {
                  const on = apps.includes(id);
                  const locked = id === 'home';
                  return (
                    <button key={id} className={`ob-app ${on ? 'on' : ''}`} disabled={locked} onClick={() => setApps((a) => (on ? a.filter((x) => x !== id) : [...a, id]))}>
                      <Icon size={20} />
                      <strong>{name}</strong>
                      <span className="ob-tick">{on && <Check size={12} />}</span>
                    </button>
                  );
                })}
              </div>
              {apps.includes('meet') && (
                <div className="ob-keep">
                  <strong>What should meetings keep by default?</strong>
                  <p className="muted small">The notetaker records the whole meeting for accurate notes, then keeps only this. People can change it per meeting.</p>
                  <div className="cat-pick three">
                    {(
                      [
                        ['video', 'Video, audio and notes', 'About 1.1 GB per hour'],
                        ['audio', 'Audio and notes', 'About 50 MB per hour'],
                        ['notes', 'Notes and transcript only', 'Almost no space'],
                      ] as const
                    ).map(([v, l, h]) => (
                      <button key={v} type="button" className={keep === v ? 'on' : ''} onClick={() => setKeep(v)}>
                        <strong>{l}</strong>
                        <small>{h}</small>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <p className="trial-note">Your first 14 days are on Studio AI with every feature. No card needed.</p>
            </>
          )}

          {step === 2 && (
            <>
              <h2>Where does your company’s email live?</h2>
              <p className="set-intro">Sprint2go works with any of these. You can move people later.</p>
              <div className="ob-setups">
                {SETUPS.map(({ id, icon: Icon, title, body }) => (
                  <button key={id} className={`ob-setup ${setup === id ? 'on' : ''}`} onClick={() => setSetup(id)}>
                    <Icon size={20} />
                    <span>
                      <strong>{title}</strong>
                      <small>{body}</small>
                    </span>
                  </button>
                ))}
              </div>

              {(setup === 'keep' || setup === 'mix') && (
                <div className="field ob-provider">
                  <label>Where is it today?</label>
                  <div className="aw-tones">
                    {PROVIDERS.map((p) => (
                      <button key={p.id} className={provider === p.id ? 'on' : ''} onClick={() => setProvider(p.id)}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                  <small>
                    {setup === 'keep'
                      ? `After setup, each person clicks “Connect ${providerName(provider)}” once. Their mail stays at ${providerName(provider)} and appears here in sync.`
                      : `We’ll guide your admin through one routing rule in ${providerName(provider)} so Sprint2go people get their mail here. Nothing changes for everyone else.`}
                  </small>
                </div>
              )}

              {setup === 'hosted' && (
                <div className="ob-dns">
                  <p>
                    Add these records at your domain registrar for <b>{d || 'your domain'}</b>:
                  </p>
                  <div className="table">
                    <table>
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Name</th>
                          <th>Value</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {records.map((r) => (
                          <tr key={r.host + r.type}>
                            <td className="mono">{r.type}</td>
                            <td className="mono">{r.host}</td>
                            <td>
                              <span className="mono sel">{r.value}</span>
                              <small>{r.note}</small>
                            </td>
                            <td>
                              {dns === 'ok' ? (
                                <span className="te-status seen">
                                  <Check size={12} />
                                </span>
                              ) : (
                                <button className="icon-btn sm" title="Copy" onClick={() => copy(r.value)}>
                                  {copied === r.value ? <Check size={14} /> : <Copy size={14} />}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button
                    className="ghost-btn outline sm"
                    disabled={dns === 'checking'}
                    onClick={() => {
                      setDns('checking');
                      setTimeout(() => setDns('ok'), 1600); // DEMO: the real check queries public DNS
                    }}
                  >
                    {dns === 'checking' ? <Loader2 size={14} className="spin" /> : <Mail size={14} />} {dns === 'ok' ? 'All records found' : dns === 'checking' ? 'Checking…' : 'Check my records'}
                  </button>
                  <small className="set-hint">You can finish now and add the records later. Mail starts arriving once they’re in place.</small>
                </div>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <h2>Invite your team</h2>
              <p className="set-intro">They’ll get an email to set their own password. You can skip this and invite people later.</p>
              <div className="ob-team">
                {team.map((t) => (
                  <div key={t.key} className="ob-person">
                    <input value={t.name} onChange={(e) => setTeam((ts) => ts.map((x) => (x.key === t.key ? { ...x, name: e.target.value } : x)))} placeholder="Full name" aria-label="Full name" />
                    <input
                      value={t.email}
                      onChange={(e) => setTeam((ts) => ts.map((x) => (x.key === t.key ? { ...x, email: e.target.value } : x)))}
                      placeholder={d ? `name@${d}` : 'name@company.com'}
                      aria-label="Email"
                    />
                    <Select<Invite['role']>
                      value={t.role}
                      onChange={(v) => setTeam((ts) => ts.map((x) => (x.key === t.key ? { ...x, role: v } : x)))}
                      label="Role"
                      options={[
                        { value: 'member', label: 'Member' },
                        { value: 'admin', label: 'Admin' },
                      ]}
                    />
                    {setup === 'mix' && (
                      <Select<Invite['where']>
                        value={t.where}
                        onChange={(v) => setTeam((ts) => ts.map((x) => (x.key === t.key ? { ...x, where: v } : x)))}
                        label="Mailbox"
                        options={[
                          { value: 'sprint2go', label: 'Mailbox on Sprint2go' },
                          { value: 'existing', label: `Stays on ${providerName(provider)}` },
                        ]}
                      />
                    )}
                    <button className="icon-btn sm" onClick={() => setTeam((ts) => (ts.length > 1 ? ts.filter((x) => x.key !== t.key) : [{ ...ts[0], name: '', email: '' }]))} aria-label="Remove">
                      <X size={14} />
                    </button>
                    {t.email && existingEmails.includes(t.email.toLowerCase()) && <small className="err">Already has an account.</small>}
                  </div>
                ))}
                <button className="ghost-btn sm" onClick={() => setTeam((ts) => [...ts, { key: Date.now(), name: '', email: '', role: 'member', where: 'sprint2go' }])}>
                  + Add another person
                </button>
              </div>
            </>
          )}
        </div>

        <footer className="modal-foot">
          {step > 0 && (
            <button className="ghost-btn" onClick={() => setStep((s) => s - 1)}>
              Back
            </button>
          )}
          <span className="spacer" />
          {step < 3 ? (
            <button className="primary-btn" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
              Continue
            </button>
          ) : (
            <button className="primary-btn" disabled={!canNext} onClick={finish}>
              Create {brand.name.trim() || 'company'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
