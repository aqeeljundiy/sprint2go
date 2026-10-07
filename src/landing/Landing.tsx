import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Bell,
  Calendar,
  Check,
  CheckSquare,
  ChevronDown,
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
  Cloud,
  Sparkles,
  TriangleAlert,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { Logo } from '../components/Logo';
import { PLAN_FEATURES, PRICES, TIER_NAME, rp } from '../data/pricing';
import type { Tier, Track } from '../types';

const APP = '/signin';

/** Fades sections in as they scroll into view (skipped for people who prefer less motion). */
function useReveal() {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.rv')];
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
      els.forEach((e) => e.classList.add('in'));
      return;
    }
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

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(scrollY > 8);
    on();
    addEventListener('scroll', on, { passive: true });
    return () => removeEventListener('scroll', on);
  }, []);
  return (
    <header className={`ln-nav ${scrolled ? 'scrolled' : ''}`}>
      <div className="ln-wrap ln-nav-in">
        <a href="#top" className="ln-brand" aria-label="Sprint2go home">
          <Logo size={28} />
          <span>
            sprint<b>2</b>go
          </span>
        </a>
        <nav className="ln-links" aria-label="Sections">
          <a href="#apps">Apps</a>
          <a href="#shared">Shared spaces</a>
          <a href="#ai">AI</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <div className="ln-nav-cta">
          <a href={APP} className="ln-btn ghost">
            Sign in
          </a>
          <a href={APP} className="ln-btn primary">
            Start free
          </a>
        </div>
      </div>
    </header>
  );
}

/* ---------- product mocks (built from the app's own look, not screenshots) ---------- */

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

function UpNextRow({ icon: Icon, tone, title, sub, action }: { icon: LucideIcon; tone?: 'warn'; title: string; sub: string; action: ReactNode }) {
  return (
    <div className="mk-row">
      <span className={`mk-ic ${tone ?? ''}`}>
        <Icon size={15} />
      </span>
      <span className="mk-txt">
        <strong>{title}</strong>
        <small>{sub}</small>
      </span>
      <span className="mk-act">{action}</span>
    </div>
  );
}

function AppMock() {
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
            <UpNextRow icon={ListChecks} title="Send the Q4 concepts to KopiKita" sub="Due today" action={<><Check size={13} /> Done</>} />
            <UpNextRow icon={TriangleAlert} tone="warn" title="Launch bundle landing page" sub="Late with Bayu" action="Remind" />
            <UpNextRow icon={Inbox} title="Founder intro: coffee brand looking for a partner" sub="Kirana is waiting for a reply" action="Reply" />
            <UpNextRow icon={CheckSquare} title="November ad budget" sub="Waiting for your approval" action="Approve" />
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
          <UpNextRow icon={CheckSquare} title="November ad budget (Rp 45 jt)" sub="Dimas asked for your OK" action="Approve" />
          <UpNextRow icon={FileText} title="Q4 creative brief" sub="New comment from Bayu" action="Open" />
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
      {rows.map(([job, model, key, c]) => (
        <div key={job} className="ai-row">
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

const APPS: [LucideIcon, string, string][] = [
  [Mail, 'Mail', 'Shared inboxes, snooze and send later. To-dos come out of the emails that matter, not the newsletters.'],
  [MessagesSquare, 'Chat', 'Channels per project, threads and voice notes, plus a shelf for the links and files everyone keeps asking for.'],
  [CheckSquare, 'Tasks', 'By person, team or project. Approvals, checklists, repeats, and briefs that show how far along the work is.'],
  [Calendar, 'Calendar', 'Drag to move, stretch to resize, and drop a task into your day to block time for it.'],
  [Video, 'Meet', 'Recordings and notes with decisions and action items, filed under the right project automatically.'],
  [FolderOpen, 'Drive', 'Files sorted by project, with what’s shared outside the company always marked.'],
  [NotebookPen, 'Notes', 'Private or for the whole team. Select a line and turn it into a task.'],
  [KeyRound, 'Vault', 'Shared passwords and 2FA codes for chosen people. Every reveal is logged.'],
];

function Pricing() {
  const [track, setTrack] = useState<Track>('own');
  const tiers: Tier[] = ['free', 'small', 'studio', 'agency'];
  return (
    <section id="pricing" className="ln-sec">
      <div className="ln-wrap">
        <div className="ln-head rv">
          <h2>Simple pricing, in rupiah</h2>
          <p>Pay for your team. Guests are always free. Pay yearly and get two months free.</p>
          <div className="ln-toggle" role="tablist" aria-label="AI">
            <button role="tab" aria-selected={track === 'own'} className={track === 'own' ? 'on' : ''} onClick={() => setTrack('own')}>
              Your own AI keys
            </button>
            <button role="tab" aria-selected={track === 'ai'} className={track === 'ai' ? 'on' : ''} onClick={() => setTrack('ai')}>
              AI included
            </button>
          </div>
        </div>
        <div className="ln-prices rv">
          {tiers.map((t) => {
            const p = t === 'free' ? null : PRICES[track][t];
            const free = t === 'free';
            return (
              <div key={t} className={`ln-price ${t === 'studio' ? 'hl' : ''}`}>
                {t === 'studio' && <span className="ln-pop">Most teams start here</span>}
                <h3>{TIER_NAME[t]}</h3>
                <p className="ln-amount">
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
                <a href={APP} className={`ln-btn ${t === 'studio' ? 'primary' : 'outline'} block`}>
                  {free ? 'Start free' : 'Try it free'}
                </a>
              </div>
            );
          })}
        </div>
        <p className="ln-note rv">
          Bigger team? Business covers 80 people with SSO, an audit log and priority support, from {rp(PRICES[track].business.base)} a month.
        </p>
      </div>
    </section>
  );
}

const FAQ: [string, string][] = [
  ['Do the people we invite from outside have to pay?', 'No. Guests get a free account and only see what you share with them. If they like it, they can start their own workspace, also free.'],
  ['Can we keep Gmail or Outlook?', 'Yes. Forward a copy of your mail here and reply as yourself, or move your domain’s mail to Sprint2go and bring your old mail along. You can mix both.'],
  ['Which AI does it use?', 'Your choice. Use the AI included in your plan, or add keys from Anthropic, OpenAI, Google, DeepSeek and others and pick a model for each job.'],
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
          <div className="ln-hero-text rv">
            <span className="ln-eyebrow">
              <Sparkles size={13} /> Mail, chat, tasks and meetings in one app
            </span>
            <h1>
              One app for the
              <br />
              whole workday.
            </h1>
            <p>Sprint2go brings your team’s email, chat, tasks, calendar, files, meetings and passwords together, and opens every morning on what needs you.</p>
            <div className="ln-cta">
              <a href={APP} className="ln-btn primary lg">
                Start free <ArrowRight size={16} />
              </a>
              <a href="#apps" className="ln-btn ghost lg">
                See what’s inside
              </a>
            </div>
            <small className="ln-fine">Free for up to 5 people. No card needed.</small>
          </div>
          <div className="ln-hero-art rv">
            <AppMock />
          </div>
        </div>
      </section>

      <section id="apps" className="ln-sec">
        <div className="ln-wrap">
          <div className="ln-head rv">
            <h2>Everything your team opens all day</h2>
            <p>Eight apps that know about each other. A meeting turns into tasks, an email into a to-do, a chat into a decision on the right project.</p>
          </div>
          <div className="ln-apps">
            {APPS.map(([Icon, name, line], i) => (
              <div key={name} className="ln-app rv" style={{ transitionDelay: `${(i % 4) * 60}ms` }}>
                <span className="ln-app-ic">
                  <Icon size={19} />
                </span>
                <h3>{name}</h3>
                <p>{line}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ln-sec alt">
        <div className="ln-wrap ln-split">
          <div className="rv">
            <h2>It opens on what needs you</h2>
            <p className="ln-lead">No dashboards of numbers nobody acts on. Home shows the late task, the reply someone is waiting for and the approval only you can give, each with the button to deal with it.</p>
            <ul className="ln-points">
              <li>
                <Check size={16} /> <span>
                  <b>Up next</b>, ranked: what’s late, what’s due, who’s waiting.
                </span>
              </li>
              <li>
                <Check size={16} /> <span>
                  <b>Counts only when something needs doing</b>, never just to fill a screen.
                </span>
              </li>
              <li>
                <Check size={16} /> <span>
                  <b>One search</b> that jumps to any project, task, person or file, or asks AI.
                </span>
              </li>
              <li>
                <Check size={16} /> <span>
                  <b>Brain dump</b>: type everything on your mind and get tasks with owners and dates.
                </span>
              </li>
            </ul>
          </div>
          <div className="ln-focus rv">
            <div className="mock-card big">
              <h4>Up next</h4>
              <UpNextRow icon={TriangleAlert} tone="warn" title="Send October invoice to Nadia" sub="Late with Dewi" action={<><Bell size={13} /> Remind</>} />
              <UpNextRow icon={ListChecks} title="Cut 15s and 6s versions of the reel" sub="Video editing queue, nobody on it yet" action="Assign" />
              <UpNextRow icon={Inbox} title="“Could one of the four lean into that?”" sub="Nadia is waiting for a reply" action="Reply" />
              <UpNextRow icon={CheckSquare} title="Finish four Q4 concept directions" sub="Due tomorrow" action={<><Check size={13} /> Done</>} />
            </div>
          </div>
        </div>
      </section>

      <section id="shared" className="ln-sec">
        <div className="ln-wrap ln-split rev">
          <div className="rv">
            <span className="ln-kicker">
              <Handshake size={14} /> Shared spaces
            </span>
            <h2>Work with clients and partners without a second tool</h2>
            <p className="ln-lead">Invite people from outside to a project. They get a free account and a clean space with only what you share: work to approve, requests, a shared channel, files and meeting notes.</p>
            <ul className="ln-points">
              <li>
                <Check size={16} /> <span>Guests are free, always.</span>
              </li>
              <li>
                <Check size={16} /> <span>They show up as “Name · Company”, so everyone knows who’s who.</span>
              </li>
              <li>
                <Check size={16} /> <span>Their colleagues can join without a ticket to you.</span>
              </li>
              <li>
                <Check size={16} /> <span>Your internal channels, notes and other projects stay yours.</span>
              </li>
            </ul>
          </div>
          <div className="rv">
            <GuestMock />
          </div>
        </div>
      </section>

      <section id="ai" className="ln-sec alt">
        <div className="ln-wrap ln-split">
          <div className="rv">
            <span className="ln-kicker">
              <Sparkles size={14} /> AI
            </span>
            <h2>AI on your terms</h2>
            <p className="ln-lead">Use the AI included in your plan, or bring your own keys. Then pick the model for each job: a strong one for meeting notes, a cheap one for sorting email.</p>
            <ul className="ln-points">
              <li>
                <Check size={16} /> <span>Anthropic, OpenAI, Google, DeepSeek, Qwen, Mistral and more.</span>
              </li>
              <li>
                <Check size={16} /> <span>Monthly caps per key, and an estimate before you spend.</span>
              </li>
              <li>
                <Check size={16} /> <span>AI runs when someone clicks, or once in the background for jobs you allow.</span>
              </li>
            </ul>
          </div>
          <div className="rv">
            <AIMock />
          </div>
        </div>
      </section>

      <section className="ln-sec">
        <div className="ln-wrap">
          <div className="ln-head rv">
            <h2>Keep your email, or move it</h2>
            <p>Your call, and you can change your mind later.</p>
          </div>
          <div className="ln-two">
            <div className="ln-opt rv">
              <span className="ln-app-ic">
                <Cloud size={19} />
              </span>
              <h3>Keep Gmail or Outlook</h3>
              <p>Mail stays at Google Workspace or Microsoft 365. A copy of everything comes to Sprint2go, and you reply from here as yourself. One admin rule sets up the whole team.</p>
            </div>
            <div className="ln-opt rv" style={{ transitionDelay: '80ms' }}>
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

      <section className="ln-sec alt">
        <div className="ln-wrap ln-faq-wrap">
          <h2 className="rv">Questions</h2>
          <div className="ln-faq">
            {FAQ.map(([q, a], i) => (
              <div key={q} className={`ln-q rv ${open === i ? 'open' : ''}`}>
                <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                  {q} <ChevronDown size={18} />
                </button>
                <div className="ln-a">
                  <p>{a}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ln-final">
        <div className="ln-wrap rv">
          <h2>Bring your team’s day into one place</h2>
          <p>Start free with up to 5 people. Invite your clients the same afternoon.</p>
          <a href={APP} className="ln-btn white lg">
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
            <a href="#apps">Apps</a>
            <a href="#shared">Shared spaces</a>
            <a href="#ai">AI</a>
            <a href="#pricing">Pricing</a>
            <a href={APP}>Sign in</a>
          </nav>
          <small>© {new Date().getFullYear()} Sprint2go</small>
        </div>
      </footer>
    </div>
  );
}
