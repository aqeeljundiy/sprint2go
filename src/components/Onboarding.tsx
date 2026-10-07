import { useState } from 'react';
import { term } from '../terms';
import { Check, Cloud, MailX, Server, Shuffle, X, type LucideIcon } from 'lucide-react';
import type { Account, AppId, EmailSetup, MailProvider, MeetingSettings, User, Workspace } from '../types';
import { DEFAULT_MEETINGS, WORKSPACE_COLORS, defaultAI, trialPlan } from '../data/workspaces';
import { uid } from '../utils';
import { APPS } from './AppRail';
import { BrandFields } from './WorkspaceForms';
import { Select } from './ui/Select';
import { EmailSetupGuide } from './EmailSetupGuide';
import { TIER_NAME, options, rp } from '../data/pricing';
import { isFreemail } from '../clientView';

export const PROVIDERS: { id: MailProvider; name: string }[] = [
  { id: 'google', name: 'Google Workspace' },
  { id: 'microsoft', name: 'Microsoft 365' },
  { id: 'zoho', name: 'Zoho Mail' },
  { id: 'imap', name: 'Other (IMAP)' },
];
export const providerName = (p?: MailProvider) => (p === 'sprint2go' || !p ? 'Sprint2go' : PROVIDERS.find((x) => x.id === p)?.name ?? 'Other');

const SETUPS: { id: EmailSetup; icon: LucideIcon; title: string; body: string }[] = [
  { id: 'keep', icon: Cloud, title: 'Keep Gmail or Outlook, forward here', body: 'Mail stays where it is. A copy of everything comes to Sprint2go and you reply from here as yourself. Nothing moves.' },
  { id: 'hosted', icon: Server, title: 'Move our email to Sprint2go', body: 'We host your mail, so you can cancel Google or Microsoft. Cheapest per person. Old mail comes with you.' },
  { id: 'mix', icon: Shuffle, title: 'Some of each', body: 'Keep pricey licences for a few people and give everyone else a Sprint2go mailbox.' },
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
  /** Walk through the whole flow, sign-up included, without creating anything (Settings, Developer). */
  preview?: boolean;
}

const COLORS = ['#10b981', '#f59e0b', '#0ea5e9', '#d946ef', '#ef4444', '#14b8a6', '#8b5cf6'];

/** New company: brand → apps → email setup → team. */
export function Onboarding({ me, existingEmails, onCreate, onClose, preview }: Props) {
  const [step, setStep] = useState(preview ? -1 : 0); // -1: the sign-up screen, shown in the preview only
  const [previewDone, setPreviewDone] = useState(false);
  const [brand, setBrand] = useState<Pick<Workspace, 'name' | 'logo' | 'color'>>({ name: '', color: WORKSPACE_COLORS[0] });
  // A work address (not gmail and the like) already tells us the company's domain.
  const [domain, setDomain] = useState(() => (preview ? '' : ((d) => (d && !isFreemail(d) ? d : ''))(me.email.split('@')[1] ?? '')));
  const [apps, setApps] = useState<AppId[]>(APPS.map((a) => a.id));
  const [setup, setSetup] = useState<EmailSetup>('keep');
  const [provider, setProvider] = useState<MailProvider>('google');
  const [emailInput, setMyEmail] = useState('');
  const [keep, setKeep] = useState<MeetingSettings['keep']>('video');
  const [team, setTeam] = useState<Invite[]>([{ key: 1, name: '', email: '', role: 'member', where: 'sprint2go' }]);

  const d = domain.trim().toLowerCase().replace(/^@/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  // The suggested address (firstname@domain) counts until the person types their own.
  const suggested = d ? `${me.name.split(' ')[0].toLowerCase()}@${d}` : '';
  const myEmail = emailInput.trim() || suggested;
  const mailOn = setup !== 'none';
  const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const steps = ['Company', 'Apps', 'Email', 'Team'];

  const canNext = step === -1 ? true : [
    brand.name.trim().length > 1 && /\./.test(d) && emailOk(myEmail) && myEmail.toLowerCase().endsWith('@' + d),
    apps.length > 0,
    true,
    team.every((t) => (!t.email && !t.name) || (emailOk(t.email) && t.name.trim() && !existingEmails.includes(t.email.toLowerCase()))),
  ][step];

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
            {(preview ? ['Account', ...steps] : steps).map((s, j) => {
              const i = preview ? j - 1 : j;
              return (
                <span key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>
                  <b>{i < step ? <Check size={12} /> : j + 1}</b> {s}
                </span>
              );
            })}
          </div>
          {preview && <span className="ob-preview-tag">Preview · nothing is saved</span>}
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        {previewDone ? (
          <div className="onboard-body ob-done">
            <span className="ob-done-mark">
              <Check size={22} />
            </span>
            <h2>That’s the whole flow</h2>
            <p className="set-intro">
              A real sign-up would now create {brand.name.trim() || 'the company'}, send the team’s invites and open Home with a short checklist: {setup === 'hosted' ? 'finish the email move' : setup === 'none' ? 'invite the team' : 'set up forwarding'}, add a first project, invite the team.
            </p>
            <button className="primary-btn" onClick={onClose}>
              Close preview
            </button>
          </div>
        ) : (
        <div className="onboard-body" key={step}>
          {step === -1 && (
            <>
              <h2>Create your account</h2>
              <p className="set-intro">Free to start. No card needed.</p>
              <button className="ghost-btn outline ob-google" type="button">
                <span className="g-mark">G</span> Continue with Google
              </button>
              <div className="ob-or">
                <span>or</span>
              </div>
              <div className="field">
                <label>Your name</label>
                <input defaultValue={me.name} />
              </div>
              <div className="field">
                <label>Work email</label>
                <input defaultValue={me.email} />
                <small>We send a 6-digit code to check it’s yours.</small>
              </div>
              <div className="field">
                <label>Password</label>
                <input type="password" placeholder="At least 8 characters" autoComplete="new-password" />
              </div>
            </>
          )}

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
              <p className="set-intro">Every app is included in every plan, Free too. There are no add-ons per app. Switch off what your team doesn’t need; you can change it any time.</p>
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
              <p className="trial-note">
                Your first 14 days are on Studio AI with everything switched on. After that you stay on <b>Free</b> (up to 5 people) unless you pick a plan. No card, no surprise charges.
              </p>
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

              {setup !== 'none' && (
                <div className="field ob-provider">
                  <label>{setup === 'hosted' ? 'Where is your email today? (to bring your old mail)' : 'Where is your email today?'}</label>
                  <div className="aw-tones">
                    {PROVIDERS.map((p) => (
                      <button key={p.id} className={provider === p.id ? 'on' : ''} onClick={() => setProvider(p.id)}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {setup !== 'none' && (
                <>
                  <h3 className="esg-title">{setup === 'hosted' ? 'How the move works' : setup === 'mix' ? 'For people who keep their mailbox' : 'How forwarding works'}</h3>
                  <EmailSetupGuide mode={setup === 'hosted' ? 'move' : 'forward'} provider={provider} domain={d} first={me.name.split(' ')[0].toLowerCase()} />
                  <small className="set-hint">You can finish now and do this later from Settings, Mail. {preview ? 'In this preview the waits are simulated.' : ''}</small>
                </>
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
                {(() => {
                  const n = 1 + team.filter((t) => t.email.trim()).length;
                  const price = options('own', n)[0];
                  return (
                    <p className="trial-note">
                      {n <= 5
                        ? `${n} ${n === 1 ? 'person' : 'people'}: free after the trial. Up to 5 people never pay.`
                        : `${n} people: after the 14-day trial, about ${rp(price?.price ?? 0)} a month on ${TIER_NAME[price?.tier ?? 'small']}, with your own AI keys. You choose before anything is charged.`}
                    </p>
                  );
                })()}
              </div>
            </>
          )}
        </div>
        )}

        {!previewDone && (
        <footer className="modal-foot">
          {step > (preview ? -1 : 0) && (
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
            <button className="primary-btn" disabled={!canNext} onClick={preview ? () => setPreviewDone(true) : finish}>
              {preview ? 'Finish preview' : `Create ${brand.name.trim() || 'company'}`}
            </button>
          )}
        </footer>
        )}
      </div>
    </div>
  );
}
