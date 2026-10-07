import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Bell,
  Calendar,
  Check,
  CheckSquare,
  ChevronDown,
  Cloud,
  FileText,
  FolderOpen,
  Handshake,
  House,
  Inbox,
  KeyRound,
  ListChecks,
  Mail,
  MessagesSquare,
  NotebookPen,
  Search,
  Server,
  Sparkles,
  TriangleAlert,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { Logo } from '../components/Logo';
import { PLAN_FEATURES, PRICES, TIER_NAME, rp } from '../data/pricing';
import type { Tier, Track } from '../types';
import { Tour } from './Tour';

const APP = '/signin';
const SIGNUP = '/signup';
const GITHUB = 'https://github.com/aqeeljundiy';

const GithubMark = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Fades sections in as they scroll into view, one after another inside a group (skipped for reduced motion). */
function useReveal() {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.rv')];
    if (reduced() || !('IntersectionObserver' in window)) return els.forEach((e) => e.classList.add('in'));
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }),
      { rootMargin: '0px 0px -8% 0px' },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
}

const NAV = [
  ['product', 'Product'],
  ['shared', 'Shared spaces'],
  ['ai', 'AI'],
  ['pricing', 'Pricing'],
  ['about', 'About'],
] as const;

/** Clear over the hero, a blurred bar once scrolled; a pill slides to the section you're reading. */
function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const links = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const on = () => setScrolled(scrollY > 12);
    on();
    addEventListener('scroll', on, { passive: true });
    return () => removeEventListener('scroll', on);
  }, []);
  // Which section is on screen.
  useEffect(() => {
    const secs = NAV.map(([id]) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (seen) setActive(seen.target.id);
      },
      { rootMargin: '-40% 0px -50% 0px', threshold: [0, 0.2, 0.5] },
    );
    secs.forEach((s) => io.observe(s));
    const top = () => scrollY < 300 && setActive(null);
    addEventListener('scroll', top, { passive: true });
    return () => (io.disconnect(), removeEventListener('scroll', top));
  }, []);
  useEffect(() => {
    const a = active && links.current?.querySelector<HTMLAnchorElement>(`a[href="#${active}"]`);
    setPill(a ? { left: a.offsetLeft, width: a.offsetWidth } : null);
  }, [active]);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
  }, [open]);

  return (
    <header className={`ln-nav ${scrolled || open ? 'scrolled' : ''} ${open ? 'open' : ''}`}>
      <div className="ln-wrap ln-nav-in">
        <a href="#top" className="ln-brand" aria-label="Sprint2go home" onClick={() => setOpen(false)}>
          <Logo size={28} />
          <span>
            sprint<b>2</b>go
          </span>
        </a>
        <nav className="ln-links" aria-label="Sections" ref={links}>
          <span className={`ln-pill ${pill ? 'on' : ''}`} style={pill ? { transform: `translateX(${pill.left}px)`, width: pill.width } : undefined} aria-hidden="true" />
          {NAV.map(([id, label]) => (
            <a key={id} href={`#${id}`} className={active === id ? 'on' : ''}>
              {label}
            </a>
          ))}
        </nav>
        <div className="ln-nav-cta">
          <a href={APP} className="ln-btn ghost">
            Sign in
          </a>
          <a href={SIGNUP} className="ln-btn primary">
            Start free
          </a>
        </div>
        <button className="ln-burger" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span />
          <span />
          <span />
        </button>
      </div>
      <div className="ln-drawer" aria-hidden={!open}>
        <div className="ln-drawer-in">
          {NAV.map(([id, label], i) => (
            <a key={id} href={`#${id}`} style={{ ['--i' as string]: i }} onClick={() => setOpen(false)} tabIndex={open ? 0 : -1}>
              {label}
            </a>
          ))}
          <span className="ln-drawer-sep" />
          <a href={SIGNUP} className="ln-btn primary lg block" style={{ ['--i' as string]: NAV.length }} tabIndex={open ? 0 : -1}>
            Start free
          </a>
          <a href={APP} className="ln-btn outline lg block" style={{ ['--i' as string]: NAV.length + 1 }} tabIndex={open ? 0 : -1}>
            Sign in
          </a>
        </div>
      </div>
    </header>
  );
}

/* ---------- product mocks ---------- */

const RAIL: [LucideIcon, string, number?][] = [
  [House, 'Home'],
  [Mail, 'Mail', 4],
  [MessagesSquare, 'Chat'],
  [CheckSquare, 'Tasks', 2],
  [Calendar, 'Calendar'],
  [NotebookPen, 'Notes'],
  [FolderOpen, 'Drive'],
  [Video, 'Meet'],
  [KeyRound, 'Vault'],
];

type Row = { id: number; icon: LucideIcon; tone?: 'warn'; title: string; sub: string; action: ReactNode };

function UpNextRow({ r, leaving }: { r: Omit<Row, 'id'>; leaving?: boolean }) {
  const Icon = r.icon;
  return (
    <div className={`mk-row ${leaving ? 'leaving' : ''}`}>
      <span className={`mk-ic ${r.tone ?? ''}`}>{leaving ? <Check size={15} /> : <Icon size={15} />}</span>
      <span className="mk-txt">
        <strong>{r.title}</strong>
        <small>{r.sub}</small>
      </span>
      <span className="mk-act">{r.action}</span>
    </div>
  );
}

const QUEUE: Omit<Row, 'id'>[] = [
  { icon: ListChecks, title: 'Send the Q4 concepts to KopiKita', sub: 'Due today', action: <><Check size={13} /> Done</> },
  { icon: TriangleAlert, tone: 'warn', title: 'Launch bundle landing page', sub: 'Late with Bayu', action: 'Remind' },
  { icon: Inbox, title: 'Founder intro: coffee brand looking for a partner', sub: 'Kirana is waiting for a reply', action: 'Reply' },
  { icon: CheckSquare, title: 'November ad budget', sub: 'Waiting for your approval', action: 'Approve' },
  { icon: Video, title: 'Lumina monthly review at 14:00', sub: 'Notes will be ready after', action: 'Join' },
  { icon: ListChecks, title: 'Cut 15s and 6s versions of the reel', sub: 'Video queue, nobody on it yet', action: 'Assign' },
  { icon: Inbox, title: '“Could one of the four lean into that?”', sub: 'Nadia is waiting for a reply', action: 'Reply' },
];

/** The Home screen, live: every few seconds the top item gets done and the next one slides in. */
function AppMock() {
  const [rows, setRows] = useState<Row[]>(() => QUEUE.slice(0, 4).map((r, i) => ({ ...r, id: i })));
  const [leaving, setLeaving] = useState<number | null>(null);
  const next = useRef(4);
  const first = useRef(rows[0].id);
  first.current = rows[0].id;
  useEffect(() => {
    if (reduced()) return;
    let out: ReturnType<typeof setTimeout>;
    const t = setInterval(() => {
      if (document.hidden) return;
      setLeaving(first.current);
      out = setTimeout(() => {
        const id = next.current++;
        setRows((rs) => [...rs.slice(1), { ...QUEUE[id % QUEUE.length], id }]);
        setLeaving(null);
      }, 650);
    }, 3400);
    return () => (clearInterval(t), clearTimeout(out));
  }, []);
  return (
    <div className="mock" aria-hidden="true">
      <div className="mock-bar">
        <i />
        <i />
        <i />
        <span>app.sprint2go.com</span>
      </div>
      <div className="mock-body">
        <aside className="mock-rail">
          <span className="mock-ws">P</span>
          {RAIL.map(([Icon, label, n], i) => (
            <span key={label} className={`mock-rail-item ${i === 0 ? 'on' : ''}`}>
              <Icon size={16} />
              {n ? <em>{n}</em> : null}
              <small>{label}</small>
            </span>
          ))}
        </aside>
        <div className="mock-main">
          <p className="mock-date">Thursday, October 8</p>
          <h3 className="mock-hi">Good morning, Aqeel.</h3>
          <div className="mock-search">
            <Search size={14} /> Jump to a project, task, person or file, or ask anything <kbd>⌘K</kbd>
          </div>
          <div className="mock-card">
            <h4>Up next</h4>
            <div className="mk-list">
              {rows.map((r) => (
                <UpNextRow key={r.id} r={r} leaving={leaving === r.id} />
              ))}
            </div>
          </div>
          <div className="mock-grid">
            <div className="mock-card sm">
              <h4>
                <TriangleAlert size={13} /> Projects at risk
              </h4>
              <p>
                <span className="dot" style={{ background: '#b45309' }}>K</span> KopiKita <b>1 late</b>
              </p>
              <p>
                <span className="dot" style={{ background: '#ec4899' }}>L</span> Lumina Skin <b>1 not picked up</b>
              </p>
            </div>
            <div className="mock-card sm">
              <h4>
                <Video size={13} /> Today
              </h4>
              <p>
                <span className="time">14:00</span> Lumina monthly review
              </p>
              <p>
                <span className="time">16:30</span> Design crit, Q4 statics
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GuestMock() {
  return (
    <div className="mock guest" aria-hidden="true">
      <div className="mock-bar">
        <i />
        <i />
        <i />
        <span>Shared space · Elkiya Group</span>
      </div>
      <div className="gm-body">
        <p className="mock-date">Shared with you</p>
        <h3 className="mock-hi sm">Good morning, Faisal.</h3>
        <div className="mock-card">
          <h4>Needs you</h4>
          <UpNextRow r={{ icon: CheckSquare, title: 'November ad budget (Rp 45 jt)', sub: 'Dimas asked for your OK', action: 'Approve' }} />
          <UpNextRow r={{ icon: FileText, title: 'Q4 creative brief', sub: 'New comment from Bayu', action: 'Open' }} />
        </div>
        <div className="gm-people">
          <span className="av" style={{ background: '#e11d48' }}>
            FT
          </span>
          <span>
            <strong>Faisal Tirtonady</strong>
            <small>Guest · Pixel & Profits</small>
          </span>
          <span className="av" style={{ background: '#0f766e' }}>
            DP
          </span>
          <span>
            <strong>Dimas Prakoso</strong>
            <small>Elkiya Group</small>
          </span>
        </div>
      </div>
    </div>
  );
}

function AIMock() {
  const rows: [string, string, string, string][] = [
    ['Meeting notes', 'Claude Sonnet 5.5', 'Your Anthropic key', '#d97757'],
    ['Ask AI', 'Claude Opus 5.5', 'Your Anthropic key', '#d97757'],
    ['Email summaries', 'Gemini 3.5 Flash', 'Your Google key', '#4285f4'],
    ['Voice notes', 'Nova 3', 'Your Deepgram key', '#13ef93'],
    ['Sorting & filing', 'DeepSeek V4 Flash', 'Your DeepSeek key', '#4d6bfe'],
  ];
  return (
    <div className="mock ai" aria-hidden="true">
      <div className="ai-head">
        <strong>Which AI does each job</strong>
        <span className="seg">
          <span>Best</span>
          <span className="on">Balanced</span>
          <span>Lowest cost</span>
        </span>
      </div>
      {rows.map(([job, model, key, c], i) => (
        <div key={job} className="ai-row rv" style={{ ['--i' as string]: i }}>
          <span className="ai-job">{job}</span>
          <span className="ai-model">
            <i style={{ background: c }} />
            {model}
            <ChevronDown size={13} />
          </span>
          <small>{key}</small>
        </div>
      ))}
    </div>
  );
}

/* ---------- sections ---------- */

const WORKS_WITH = ['Gmail', 'Google Workspace', 'Microsoft 365', 'Outlook', 'Zoho Mail', 'Claude', 'OpenAI', 'Gemini', 'DeepSeek', 'Qwen', 'Mistral', 'Deepgram', 'Whisper', 'OpenRouter'];

function Pricing() {
  const [track, setTrack] = useState<Track>('own');
  const tiers: Tier[] = ['free', 'small', 'studio', 'agency'];
  return (
    <section id="pricing" className="ln-sec">
      <div className="ln-wrap">
        <div className="ln-head">
          <h2 className="rv">Simple pricing, in rupiah</h2>
          <p className="rv" style={{ ['--i' as string]: 1 }}>
            Pay for your team. Guests are always free. Pay yearly and get two months free.
          </p>
          <div className="ln-toggle rv" style={{ ['--i' as string]: 2 }} role="tablist" aria-label="AI">
            <span className={`ln-toggle-pill ${track}`} aria-hidden="true" />
            <button role="tab" aria-selected={track === 'own'} className={track === 'own' ? 'on' : ''} onClick={() => setTrack('own')}>
              Your own AI keys
            </button>
            <button role="tab" aria-selected={track === 'ai'} className={track === 'ai' ? 'on' : ''} onClick={() => setTrack('ai')}>
              AI included
            </button>
          </div>
        </div>
        <div className="ln-prices">
          {tiers.map((t, i) => {
            const p = t === 'free' ? null : PRICES[track][t];
            const free = t === 'free';
            return (
              <div key={t} className={`ln-price rv ${t === 'studio' ? 'hl' : ''}`} style={{ ['--i' as string]: i }}>
                {t === 'studio' && <span className="ln-pop">Most teams start here</span>}
                <h3>{TIER_NAME[t]}</h3>
                <p className="ln-amount" key={track}>
                  {free ? (
                    <>
                      <b>Rp 0</b>
                      <small>up to 5 people</small>
                    </>
                  ) : p!.perPerson ? (
                    <>
                      <b>{rp(p!.base)}</b>
                      <small>per person, a month</small>
                    </>
                  ) : (
                    <>
                      <b>{rp(p!.base)}</b>
                      <small>
                        a month for {p!.included} people, then {rp(p!.extra)} each
                      </small>
                    </>
                  )}
                </p>
                <ul>
                  {(free && track === 'ai' ? ['Uses your own AI keys', ...PLAN_FEATURES.free.slice(0, 1), ...PLAN_FEATURES.free.slice(2)] : PLAN_FEATURES[t]).map((f) => (
                    <li key={f}>
                      <Check size={14} /> {f}
                    </li>
                  ))}
                  {!free && track === 'ai' && (
                    <li>
                      <Check size={14} /> Shared AI allowance, no keys to manage
                    </li>
                  )}
                </ul>
                <a href={SIGNUP} className={`ln-btn ${t === 'studio' ? 'primary' : 'outline'} block`}>
                  {free ? 'Start free' : 'Try it free'}
                </a>
              </div>
            );
          })}
        </div>
        <p className="ln-note rv">Bigger team? Business covers 80 people with SSO, an audit log and priority support, from {rp(PRICES[track].business.base)} a month.</p>
      </div>
    </section>
  );
}

const FAQ: [string, string][] = [
  ['Do the people we invite from outside have to pay?', 'No. Guests get a free account and only see what you share with them. If they like it, they can start their own workspace, also free.'],
  ['Can we keep Gmail or Outlook?', 'Yes. Forward a copy of your mail here and reply as yourself, or move your domain’s mail to Sprint2go and bring your old mail along. You can mix both.'],
  ['Which AI does it use?', 'Your choice. Use the AI included in your plan, or add keys from Anthropic, OpenAI, Google, DeepSeek and others and pick a model for each job.'],
  ['Is it open source?', 'Parts of what we build are, on GitHub, for anyone who wants to look under the hood or play with it. We share what works for us.'],
  ['Is it hard to switch over?', 'Most teams start with chat and tasks in an afternoon, then move email when they’re ready. Nothing has to move on day one.'],
];

export function Landing() {
  useReveal();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="ln" id="top">
      <Nav />

      <section className="ln-hero">
        <div className="ln-wrap">
          <div className="ln-hero-text">
            <span className="ln-eyebrow a" style={{ ['--d' as string]: '0s' }}>
              <Sparkles size={13} /> Mail, chat, tasks and meetings in one app
            </span>
            <h1>
              <span className="line a" style={{ ['--d' as string]: '.08s' }}>
                One app for the
              </span>
              <span className="line a" style={{ ['--d' as string]: '.18s' }}>
                whole <em>workday.</em>
              </span>
            </h1>
            <p className="a" style={{ ['--d' as string]: '.32s' }}>
              Sprint2go brings your team’s email, chat, tasks, calendar, files, meetings and passwords together, and opens every morning on what needs you.
            </p>
            <div className="ln-cta a" style={{ ['--d' as string]: '.44s' }}>
              <a href={SIGNUP} className="ln-btn primary lg">
                Start free <ArrowRight size={16} />
              </a>
              <a href="#product" className="ln-btn ghost lg">
                Take the tour
              </a>
            </div>
            <small className="ln-fine a" style={{ ['--d' as string]: '.52s' }}>
              Free for up to 5 people. No card needed.
            </small>
          </div>
          <div className="ln-hero-art a" style={{ ['--d' as string]: '.3s' }}>
            <AppMock />
            <span className="ln-float f1" aria-hidden="true">
              <Check size={13} /> Nadia approved the Q4 concepts
            </span>
            <span className="ln-float f2" aria-hidden="true">
              <Video size={13} /> Meeting notes ready · 3 action items
            </span>
            <span className="ln-float f3" aria-hidden="true">
              <Sparkles size={13} /> 2 to-dos found in your email
            </span>
          </div>
        </div>
      </section>

      <section className="ln-strip" aria-label="Works with">
        <p className="rv">Works with the email and AI you already use</p>
        <div className="ln-marquee rv" style={{ ['--i' as string]: 1 }}>
          <div className="ln-marquee-track">
            {[...WORKS_WITH, ...WORKS_WITH].map((w, i) => (
              <span key={i}>{w}</span>
            ))}
          </div>
        </div>
      </section>

      <section id="product" className="ln-sec">
        <div className="ln-wrap">
          <div className="ln-head">
            <h2 className="rv">Eight apps that know about each other</h2>
            <p className="rv" style={{ ['--i' as string]: 1 }}>
              A meeting turns into tasks, an email into a to-do, a chat into a decision on the right project. No copy and paste between tools.
            </p>
          </div>
          <Tour />
        </div>
      </section>

      <section className="ln-sec alt">
        <div className="ln-wrap ln-split">
          <div>
            <h2 className="rv">It opens on what needs you</h2>
            <p className="ln-lead rv" style={{ ['--i' as string]: 1 }}>
              No dashboards of numbers nobody acts on. Home shows the late task, the reply someone is waiting for and the approval only you can give, each with the button to deal with it.
            </p>
            <ul className="ln-points">
              {(
                [
                  ['Up next', ', ranked: what’s late, what’s due, who’s waiting.'],
                  ['Counts only when something needs doing', ', never just to fill a screen.'],
                  ['One search', ' that jumps to any project, task, person or file, or asks AI.'],
                  ['Brain dump', ': type everything on your mind and get tasks with owners and dates.'],
                ] as const
              ).map(([b, t], i) => (
                <li key={b} className="rv" style={{ ['--i' as string]: i + 2 }}>
                  <Check size={16} />{' '}
                  <span>
                    <b>{b}</b>
                    {t}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="ln-focus rv" style={{ ['--i' as string]: 1 }}>
            <div className="mock-card big">
              <h4>Up next</h4>
              <UpNextRow r={{ icon: TriangleAlert, tone: 'warn', title: 'Send October invoice to Nadia', sub: 'Late with Dewi', action: <><Bell size={13} /> Remind</> }} />
              <UpNextRow r={{ icon: ListChecks, title: 'Cut 15s and 6s versions of the reel', sub: 'Video editing queue, nobody on it yet', action: 'Assign' }} />
              <UpNextRow r={{ icon: Inbox, title: '“Could one of the four lean into that?”', sub: 'Nadia is waiting for a reply', action: 'Reply' }} />
              <UpNextRow r={{ icon: CheckSquare, title: 'Finish four Q4 concept directions', sub: 'Due tomorrow', action: <><Check size={13} /> Done</> }} />
            </div>
          </div>
        </div>
      </section>

      <section id="shared" className="ln-sec">
        <div className="ln-wrap ln-split rev">
          <div>
            <span className="ln-kicker rv">
              <Handshake size={14} /> Shared spaces
            </span>
            <h2 className="rv" style={{ ['--i' as string]: 1 }}>
              Work with clients and partners without a second tool
            </h2>
            <p className="ln-lead rv" style={{ ['--i' as string]: 2 }}>
              Invite people from outside to a project. They get a free account and a clean space with only what you share: work to approve, requests, a shared channel, files and meeting notes.
            </p>
            <ul className="ln-points">
              {['Guests are free, always.', 'They show up as “Name · Company”, so everyone knows who’s who.', 'Their colleagues can join without a ticket to you.', 'Your internal channels, notes and other projects stay yours.'].map((t, i) => (
                <li key={t} className="rv" style={{ ['--i' as string]: i + 3 }}>
                  <Check size={16} /> <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rv" style={{ ['--i' as string]: 1 }}>
            <GuestMock />
          </div>
        </div>
      </section>

      <section id="ai" className="ln-sec alt">
        <div className="ln-wrap ln-split">
          <div>
            <span className="ln-kicker rv">
              <Sparkles size={14} /> AI
            </span>
            <h2 className="rv" style={{ ['--i' as string]: 1 }}>
              AI on your terms
            </h2>
            <p className="ln-lead rv" style={{ ['--i' as string]: 2 }}>
              Use the AI included in your plan, or bring your own keys. Then pick the model for each job: a strong one for meeting notes, a cheap one for sorting email.
            </p>
            <ul className="ln-points">
              {['Anthropic, OpenAI, Google, DeepSeek, Qwen, Mistral and more.', 'Monthly caps per key, and an estimate before you spend.', 'AI runs when someone clicks, or once in the background for jobs you allow.'].map((t, i) => (
                <li key={t} className="rv" style={{ ['--i' as string]: i + 3 }}>
                  <Check size={16} /> <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rv" style={{ ['--i' as string]: 1 }}>
            <AIMock />
          </div>
        </div>
      </section>

      <section className="ln-sec">
        <div className="ln-wrap">
          <div className="ln-head">
            <h2 className="rv">Keep your email, or move it</h2>
            <p className="rv" style={{ ['--i' as string]: 1 }}>
              Your call, and you can change your mind later.
            </p>
          </div>
          <div className="ln-two">
            <div className="ln-opt rv">
              <span className="ln-app-ic">
                <Cloud size={19} />
              </span>
              <h3>Keep Gmail or Outlook</h3>
              <p>Mail stays at Google Workspace or Microsoft 365. A copy of everything comes to Sprint2go, and you reply from here as yourself. One admin rule sets up the whole team.</p>
            </div>
            <div className="ln-opt rv" style={{ ['--i' as string]: 1 }}>
              <span className="ln-app-ic">
                <Server size={19} />
              </span>
              <h3>Move your email here</h3>
              <p>We host your domain’s mail, so you can cancel the per-person licences. Your old mail comes with you, and nothing is lost on switch day.</p>
            </div>
          </div>
        </div>
      </section>

      <Pricing />

      <section id="about" className="ln-sec alt">
        <div className="ln-wrap ln-about">
          <div className="ln-quote rv">
            <span className="ln-qmark" aria-hidden="true">
              ”
            </span>
            <p>We build the systems we need to run our own companies, with AI where it actually saves time. When something works for us, we share it, so other teams don’t have to start from zero.</p>
          </div>
          <article className="ln-founder rv" style={{ ['--i' as string]: 1 }}>
            <span className="ln-founder-av">AJ</span>
            <div>
              <h3>Aqeel</h3>
              <p className="ln-founder-role">Aqilla Abdurrahman Jundiy · Founder of Elkiya Group</p>
              <p>
                Sprint2go started as the tool we wanted for ourselves: one place for an agency, a group of brands and the remote teams behind them. We’re building AI systems to solve our own problems first, then putting them in other people’s hands.
              </p>
              <p>Parts of what we build are open source. If you want to look under the hood or play with it, it’s on GitHub.</p>
              <div className="ln-founder-links">
                <a href={GITHUB} target="_blank" rel="noreferrer" className="ln-btn outline">
                  <GithubMark /> GitHub
                </a>
                <a href="https://elkiyagroup.com" target="_blank" rel="noreferrer" className="ln-btn ghost">
                  Elkiya Group
                </a>
              </div>
            </div>
          </article>
          <div className="ln-chips rv" style={{ ['--i' as string]: 2 }}>
            <span>Built in Indonesia</span>
            <span>Made for our own teams first</span>
            <span>Open source parts on GitHub</span>
            <span>Your AI keys, your choice</span>
          </div>
        </div>
      </section>

      <section className="ln-sec">
        <div className="ln-wrap ln-faq-wrap">
          <h2 className="rv">Questions</h2>
          <div className="ln-faq">
            {FAQ.map(([q, a], i) => (
              <div key={q} className={`ln-q rv ${open === i ? 'open' : ''}`} style={{ ['--i' as string]: i }}>
                <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                  {q} <ChevronDown size={18} />
                </button>
                <div className="ln-a">
                  <div>
                    <p>{a}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ln-final">
        <span className="ln-key k1" aria-hidden="true">
          <Logo size={30} />
        </span>
        <span className="ln-key k2" aria-hidden="true">
          <Mail size={26} />
        </span>
        <span className="ln-key k3" aria-hidden="true">
          <CheckSquare size={26} />
        </span>
        <span className="ln-key k4" aria-hidden="true">
          <MessagesSquare size={26} />
        </span>
        <div className="ln-wrap rv">
          <h2>Bring your team’s day into one place</h2>
          <p>Start free with up to 5 people. Invite your clients the same afternoon.</p>
          <a href={SIGNUP} className="ln-btn white lg">
            Start free <ArrowRight size={16} />
          </a>
        </div>
      </section>

      <footer className="ln-foot">
        <div className="ln-wrap ln-foot-in">
          <a href="#top" className="ln-brand sm">
            <Logo size={22} />
            <span>
              sprint<b>2</b>go
            </span>
          </a>
          <nav>
            {NAV.map(([id, label]) => (
              <a key={id} href={`#${id}`}>
                {label}
              </a>
            ))}
            <a href={APP}>Sign in</a>
          </nav>
          <small>© {new Date().getFullYear()} Sprint2go · by Elkiya Group</small>
        </div>
      </footer>
    </div>
  );
}
