import { LanguagePicker } from './LanguagePicker';
import { MEETING_LANGUAGES } from '../data/languages';
import { useEffect, useState } from 'react';
import { term, brand as product } from '../terms';
import { Check, Cloud, MailX, Server, Shuffle, X, type LucideIcon, Zap } from 'lucide-react';
import { INDUSTRIES, type Industry } from '../types';
import type { Account, AppId, EmailSetup, MailProvider, MeetingSettings, User, Workspace } from '../types';
import { DEFAULT_MEETINGS, WORKSPACE_COLORS, defaultAI, trialPlan } from '../data/workspaces';
import { uid } from '../utils';
import { APPS } from './AppRail';
import { BrandFields } from './WorkspaceForms';
import { Select } from './ui/Select';
import { EmailSetupGuide, providerLabel } from './EmailSetupGuide';
import { server } from '../sync';
import { caps } from '../caps';
import { SmoothHeight, TabPane } from './ui/Smooth';
import { TIER_NAME, options, rp } from '../data/pricing';
import { isFreemail } from '../clientView';
import { deviceTz } from '../jobTimes';

export const PROVIDERS: { id: MailProvider; name: string }[] = [
  { id: 'google', name: 'Google Workspace' },
  { id: 'microsoft', name: 'Microsoft 365' },
  { id: 'zoho', name: 'Zoho Mail' },
  { id: 'imap', name: 'Other (IMAP)' },
];
export const providerName = (p?: MailProvider) => (p === 'sprint2go' || !p ? `${product.name}` : PROVIDERS.find((x) => x.id === p)?.name ?? 'Other');

// A function, so the product name (an agency's own, when white-labelled) and the provider picked are read when shown.
const setups = (provider: MailProvider): { id: EmailSetup; icon: LucideIcon; title: string; body: string }[] => [
  { id: 'keep', icon: Cloud, title: 'Keep Gmail or Outlook, forward here', body: `Mail stays where it is. A copy of everything comes to ${product.name} to read, and you reply from Gmail or Outlook. Nothing moves.` },
  { id: 'hosted', icon: Server, title: `Move our email to ${product.name}`, body: `We host your new mail, so you can cancel Google or Microsoft. Cheapest per person. Your old mail stays in ${provider === 'imap' ? 'your current mailbox' : providerName(provider)} until you cancel it.` },
  { id: 'mix', icon: Shuffle, title: 'Some of each', body: `Keep pricey licences for a few people and give everyone else a ${product.name} mailbox.` },
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
  // One free trial per person and per company domain: the server says whether this company gets one, and why not.
  const [noTrial, setNoTrial] = useState<string | null>(null);
  useEffect(() => {
    if (preview || !server.on) return;
    void fetch('/api/trial')
      .then((r) => (r.ok ? (r.json() as Promise<{ available: boolean; why?: string }>) : null))
      .then((d) => d && !d.available && setNoTrial(d.why ?? 'You’ve already had a free trial.'))
      .catch(() => {});
  }, [preview]);
  const [previewDone, setPreviewDone] = useState(false);
  const [brand, setBrand] = useState<Pick<Workspace, 'name' | 'logo' | 'color'>>({ name: '', color: WORKSPACE_COLORS[0] });
  // A work address (not gmail and the like) already tells us the company's domain.
  const [domain, setDomain] = useState(() => (preview ? '' : ((d) => (d && !isFreemail(d) ? d : ''))(me.email.split('@')[1] ?? '')));
  const [apps, setApps] = useState<AppId[]>(APPS.map((a) => a.id));
  const [setup, setSetup] = useState<EmailSetup>('keep');
  const [provider, setProvider] = useState<MailProvider>('google');
  const [route, setRoute] = useState<'own' | 'boosted'>('own'); // how mail goes out: our server, or Boosted (Amazon on our account)
  const [emailInput, setMyEmail] = useState('');
  const [keep, setKeep] = useState<MeetingSettings['keep']>('audio');
  // Meeting languages: a first guess from the browser (Indonesian usually comes mixed with English), easy to change.
  const [languages, setLanguages] = useState<string[]>(() => {
    const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2).toLowerCase();
    return nav === 'id' || nav === 'ms' ? [nav, 'en'] : MEETING_LANGUAGES.some((l) => l.code === nav) ? [nav] : ['en'];
  });
  const [agency, setAgency] = useState(false);
  const [industry, setIndustry] = useState<Industry>('agency'); // white label: the company's own brand in place of ours
  const [mixPart, setMixPart] = useState<'split' | 'keep'>('split'); // "Some of each": which people the guide is about
  const [routingOk, setRoutingOk] = useState(false); // the routing test reached sprint2go
  const [team, setTeam] = useState<Invite[]>([{ key: 1, name: '', email: '', role: 'member', where: 'sprint2go' }]);

  const d = domain.trim().toLowerCase().replace(/^@/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  // The suggested address (firstname@domain) counts until the person types their own.
  const suggested = d ? `${me.name.split(' ')[0].toLowerCase()}@${d}` : '';
  const myEmail = emailInput.trim() || suggested;
  const mailOn = setup !== 'none';
  const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const steps = ['Company', 'Apps', 'Email', 'Team'];
  const realMail = server.on && !caps.demo; // a real server: no pretend routing check during sign-up

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
        industry,
        timeZone: deviceTz(), // where its creator is; Settings, General changes it
        ...(agency ? { whiteLabel: { enabled: true, name: brand.name.trim(), logo: brand.logo, color: brand.color, slug: brand.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') } } : {}),
        ...(setup === 'mix' ? { mailRouting: { dailyCheck: true, ...(routingOk ? { verifiedAt: new Date().toISOString() } : {}) } } : {}),
        emailProvider: setup === 'hosted' || setup === 'none' ? undefined : provider,
        ...(mailOn ? { mailRoute: route } : {}),
        plan: trialPlan(brand.name.trim(), myEmail),
        ai: defaultAI(false),
        meetings: { ...DEFAULT_MEETINGS, keep, clientMeetings: keep, internalMeetings: keep, languages },
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
                <span key={s} className={i === step ? 'on' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
                  <b>{i < step ? <Check size={12} /> : j + 1}</b> <span className="ob-step-name">{s}</span>
                </span>
              );
            })}
          </div>
          {preview && <span className="ob-preview-tag">Preview · nothing is saved</span>}
          <button className="icon-btn sm ob-close" onClick={onClose} aria-label="Close">
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
        <div className="onboard-body">
          <SmoothHeight>
          <TabPane key={step}>
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
              <div className="field">
                <label>What does the company do?</label>
                <div className="ob-industries">
                  {INDUSTRIES.map((i) => (
                    <button key={i.id} type="button" className={`ob-industry ${industry === i.id ? 'on' : ''}`} onClick={() => setIndustry(i.id)}>
                      <strong>{i.name}</strong>
                      <small>{i.hint}</small>
                    </button>
                  ))}
                </div>
                <small className="set-hint">Picks the starter tables and brief templates. Everything can be changed later.</small>
              </div>
              <label className={`ob-agency ${agency ? 'on' : ''}`}>
                <input type="checkbox" checked={agency} onChange={(e) => setAgency(e.target.checked)} />
                <span>
                  <strong>Our clients should see our brand, not sprint2go’s</strong>
                  <small>Clients sign in at your own address (like portal.youragency.com) and see your name and logo, never ours. Change it any time in Settings, Client portal & brand.</small>
                </span>
              </label>
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
              <div className={`fold ${apps.includes('meet') ? 'open' : ''}`} aria-hidden={!apps.includes('meet')}>
                <div className="fold-in">
                  <div className="ob-keep">
                    <strong>What should the notetaker keep?</strong>
                    <p className="muted small">It writes the notes from the meeting’s audio either way. People can change this per meeting, and you can change it later in Settings.</p>
                    <div className="cat-pick three">
                      {(
                        [
                          ['audio', 'Audio and notes', 'Recommended. About 30 MB per hour'],
                          ['video', 'Video too (Beta)', 'Cameras and screen shares. About 1 GB per hour'],
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
                  <div className="ob-keep">
                    <strong>Which languages are your meetings in?</strong>
                    <p className="muted small">Transcripts only come out in these. Pick two if people mix them, like Indonesian and English; the first is the main one.</p>
                    <LanguagePicker value={languages} onChange={setLanguages} />
                  </div>
                </div>
              </div>
              <p className="trial-note">
                {noTrial ? (
                  <>
                    This company starts on <b>Free</b> (up to 5 people, your own AI keys). {noTrial}
                  </>
                ) : (
                  <>
                    Your first 14 days are on Studio AI with everything switched on. After that you stay on <b>Free</b> (up to 5 people) unless you pick a plan. No card, no surprise charges.
                  </>
                )}
              </p>
            </>
          )}

          {step === 2 && (
            <>
              <h2>Where does your company’s email live?</h2>
              <p className="set-intro">{product.name} works with any of these. You can move people later.</p>
              <div className="ob-setups">
                {setups(provider).map(({ id, icon: Icon, title, body }) => (
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
                  <label>Where is your email today?</label>
                  <div className="aw-tones wrap">
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
                  {setup === 'mix' ? (
                    <>
                      <div className="segmented sm esg-who">
                        <button type="button" className={mixPart === 'split' ? 'on' : ''} onClick={() => setMixPart('split')}>
                          People on {product.name} mail
                        </button>
                        <button type="button" className={mixPart === 'keep' ? 'on' : ''} onClick={() => setMixPart('keep')}>
                          People who keep {providerName(provider)}
                        </button>
                      </div>
                      <h3 className="esg-title">{mixPart === 'split' ? `Give people a ${d || 'company'} mailbox here` : 'Their mail, copied here'}</h3>
                      <EmailSetupGuide mode={mixPart === 'split' ? 'split' : 'forward'} provider={provider} domain={d} first={me.name.split(' ')[0].toLowerCase()} company={brand.name} address={myEmail} onVerified={() => setRoutingOk(true)} />
                    </>
                  ) : (
                    <>
                      <h3 className="esg-title">{setup === 'hosted' ? 'How the move works' : 'How forwarding works'}</h3>
                      <EmailSetupGuide mode={setup === 'hosted' ? 'move' : 'forward'} provider={provider} domain={d} first={me.name.split(' ')[0].toLowerCase()} company={brand.name} address={myEmail} />
                    </>
                  )}
                  {/* Boosted sending is only a choice where this server has it (the demo shows it as one). */}
                  {(!server.on || caps.boosted) && (
                  <>
                  <h3 className="esg-title">How your mail goes out</h3>
                  <div className="ed-routes ob-routes">
                    <button type="button" className={`ed-route ${route === 'own' ? 'on' : ''}`} onClick={() => setRoute('own')}>
                      <span className="ed-route-head">
                        <Server size={16} />
                        <strong>{product.name} mail server</strong>
                        <em>Included</em>
                      </span>
                      <small>Free. A brand-new domain may land in spam for the first weeks while its reputation builds.</small>
                    </button>
                    <button type="button" className={`ed-route ${route === 'boosted' ? 'on' : ''}`} onClick={() => setRoute('boosted')}>
                      <span className="ed-route-head">
                        <Zap size={16} />
                        <strong>Boosted sending</strong>
                        <em>Credits</em>
                      </span>
                      <small>Through Amazon on our account: proven delivery to Gmail and Outlook from day one. Paid per email, from Rp 15.000 per 1,000.</small>
                    </button>
                  </div>
                  </>
                  )}
                  <small className="set-hint">You can finish now and do this later from Settings, Email delivery. {preview ? 'In this preview the waits are simulated.' : ''}</small>
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
                          { value: 'sprint2go', label: `Mailbox on ${product.name}` },
                          { value: 'existing', label: `Stays on ${providerName(provider)}` },
                        ]}
                      />
                    )}
                    <button className="icon-btn sm" onClick={() => setTeam((ts) => (ts.length > 1 ? ts.filter((x) => x.key !== t.key) : [{ ...ts[0], name: '', email: '' }]))} aria-label="Remove">
                      <X size={14} />
                    </button>
                    {t.email && existingEmails.includes(t.email.toLowerCase()) && <small className="err">Already has an account.</small>}
                    {setup === 'mix' && t.where === 'sprint2go' && t.email && !routingOk && (
                      <small className="ob-warn">
                        {realMail
                          ? `Mail for it arrives once ${providerLabel(provider)} passes unknown addresses on. Nobody at ${providerLabel(provider)} may have this address.`
                          : 'Mail to this address won’t arrive until the routing check in the email step passes. You can still invite them now.'}
                      </small>
                    )}
                    {setup === 'mix' && t.where === 'sprint2go' && t.email && routingOk && <small className="muted">Remove their {providerName(provider)} licence if they have one, or it keeps their mail.</small>}
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
                        ? `${n} ${n === 1 ? 'person' : 'people'}: ${noTrial ? 'free' : 'free after the trial'}. Up to 5 people never pay.`
                        : `${n} people: ${noTrial ? 'more than Free covers, so pick a plan after you start:' : 'after the 14-day trial,'} about ${rp(price?.price ?? 0)} a month on ${TIER_NAME[price?.tier ?? 'small']}, with your own AI keys. You choose before anything is charged.`}
                    </p>
                  );
                })()}
              </div>
            </>
          )}
          </TabPane>
          </SmoothHeight>
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
