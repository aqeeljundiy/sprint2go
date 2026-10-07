import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { PLAN_FEATURES, PRICES, rp } from '../data/pricing';
import type { Tier, Track } from '../types';
import { Tour } from './Tour';
import { LangCtx, STR, startLang, useT, type Lang } from './i18n';

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
function useReveal(lang: Lang) {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.rv:not(.in)')];
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
  }, [lang]);
}

const SECTIONS = ['product', 'partners', 'ai', 'pricing', 'about'] as const;

function LangSwitch() {
  const { lang, setLang } = useT();
  return (
    <div className="ln-lang" role="group" aria-label="Language">
      <span className={`ln-lang-pill ${lang}`} aria-hidden="true" />
      {(['en', 'id'] as const).map((l) => (
        <button key={l} className={lang === l ? 'on' : ''} onClick={() => setLang(l)} aria-pressed={lang === l}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/** Clear over the hero, a blurred bar once scrolled; a pill slides to the section you're reading. */
function Nav() {
  const { t, lang } = useT();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const links = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const label = (id: (typeof SECTIONS)[number]) => t.nav[id];

  useEffect(() => {
    const on = () => setScrolled(scrollY > 12);
    on();
    addEventListener('scroll', on, { passive: true });
    return () => removeEventListener('scroll', on);
  }, []);
  useEffect(() => {
    const secs = SECTIONS.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
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
  }, [active, lang]);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
  }, [open]);

  return (
    <header className={`ln-nav ${scrolled || open ? 'scrolled' : ''} ${open ? 'open' : ''}`}>
      <div className="ln-wrap ln-nav-in">
        <a href="#top" className="ln-brand" aria-label="Sprint2go" onClick={() => setOpen(false)}>
          <Logo size={28} />
          <span>
            sprint<b>2</b>go
          </span>
        </a>
        <nav className="ln-links" aria-label="Sections" ref={links}>
          <span className={`ln-pill ${pill ? 'on' : ''}`} style={pill ? { transform: `translateX(${pill.left}px)`, width: pill.width } : undefined} aria-hidden="true" />
          {SECTIONS.map((id) => (
            <a key={id} href={`#${id}`} className={active === id ? 'on' : ''}>
              {label(id)}
            </a>
          ))}
        </nav>
        <div className="ln-nav-cta">
          <LangSwitch />
          <a href={APP} className="ln-btn ghost">
            {t.nav.signin}
          </a>
          <a href={SIGNUP} className="ln-btn primary">
            {t.nav.start}
          </a>
        </div>
        <button className="ln-burger" aria-label={open ? t.nav.close : t.nav.open} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span />
          <span />
          <span />
        </button>
      </div>
      <div className="ln-drawer" aria-hidden={!open}>
        <div className="ln-drawer-in">
          {SECTIONS.map((id, i) => (
            <a key={id} href={`#${id}`} style={{ ['--i' as string]: i }} onClick={() => setOpen(false)} tabIndex={open ? 0 : -1}>
              {label(id)}
            </a>
          ))}
          <span className="ln-drawer-sep" />
          <div className="ln-drawer-lang" style={{ ['--i' as string]: SECTIONS.length }}>
            <LangSwitch />
          </div>
          <a href={SIGNUP} className="ln-btn primary lg block" style={{ ['--i' as string]: SECTIONS.length + 1 }} tabIndex={open ? 0 : -1}>
            {t.nav.start}
          </a>
          <a href={APP} className="ln-btn outline lg block" style={{ ['--i' as string]: SECTIONS.length + 2 }} tabIndex={open ? 0 : -1}>
            {t.nav.signin}
          </a>
        </div>
      </div>
    </header>
  );
}

/* ---------- still product previews ---------- */

const RAIL: [LucideIcon, number?][] = [[House], [Mail, 4], [MessagesSquare], [CheckSquare, 2], [Calendar], [NotebookPen], [FolderOpen], [Video], [KeyRound]];

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
  const { t } = useT();
  const m = t.mock;
  const icons: [LucideIcon, 'warn' | undefined][] = [
    [ListChecks, undefined],
    [TriangleAlert, 'warn'],
    [Inbox, undefined],
    [CheckSquare, undefined],
  ];
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
          {RAIL.map(([Icon, n], i) => (
            <span key={i} className={`mock-rail-item ${i === 0 ? 'on' : ''}`}>
              <Icon size={16} />
              {n ? <em>{n}</em> : null}
              <small>{m.rail[i]}</small>
            </span>
          ))}
        </aside>
        <div className="mock-main">
          <p className="mock-date">{m.date}</p>
          <h3 className="mock-hi">{m.hi}</h3>
          <div className="mock-search">
            <Search size={14} /> {m.search} <kbd>⌘K</kbd>
          </div>
          <div className="mock-card">
            <h4>{m.upNext}</h4>
            {m.rows.map(([title, sub, action], i) => (
              <UpNextRow key={title} icon={icons[i][0]} tone={icons[i][1]} title={title} sub={sub} action={i === 0 ? <><Check size={13} /> {action}</> : action} />
            ))}
          </div>
          <div className="mock-grid">
            <div className="mock-card sm">
              <h4>
                <TriangleAlert size={13} /> {m.risk}
              </h4>
              <p>
                <span className="dot" style={{ background: '#b45309' }}>K</span> KopiKita <b>{m.late}</b>
              </p>
              <p>
                <span className="dot" style={{ background: '#ec4899' }}>L</span> Lumina Skin <b>{m.notPicked}</b>
              </p>
            </div>
            <div className="mock-card sm">
              <h4>
                <Video size={13} /> {m.today}
              </h4>
              <p>
                <span className="time">14:00</span> {m.ev1}
              </p>
              <p>
                <span className="time">16:30</span> {m.ev2}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GuestMock() {
  const { t } = useT();
  const g = t.partners;
  return (
    <div className="mock guest" aria-hidden="true">
      <div className="mock-bar">
        <i />
        <i />
        <i />
        <span>{g.bar}</span>
      </div>
      <div className="gm-body">
        <p className="mock-date">{g.shared}</p>
        <h3 className="mock-hi sm">{g.hi}</h3>
        <div className="mock-card">
          <h4>{g.needs}</h4>
          <UpNextRow icon={CheckSquare} title={g.r1[0]} sub={g.r1[1]} action={g.r1[2]} />
          <UpNextRow icon={FileText} title={g.r2[0]} sub={g.r2[1]} action={g.r2[2]} />
        </div>
        <div className="gm-people">
          <span className="av" style={{ background: '#e11d48' }}>
            FT
          </span>
          <span>
            <strong>Faisal Tirtonady</strong>
            <small>{g.guest}</small>
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
  const { t } = useT();
  const rows: [string, string, string][] = [
    ['Claude Sonnet 5.5', 'Anthropic', '#d97757'],
    ['Claude Opus 5.5', 'Anthropic', '#d97757'],
    ['Gemini 3.5 Flash', 'Google', '#4285f4'],
    ['Nova 3', 'Deepgram', '#13ef93'],
    ['DeepSeek V4 Flash', 'DeepSeek', '#4d6bfe'],
  ];
  return (
    <div className="mock ai" aria-hidden="true">
      <div className="ai-head">
        <strong>{t.ai.mockH}</strong>
        <span className="seg">
          <span>{t.ai.seg[0]}</span>
          <span className="on">{t.ai.seg[1]}</span>
          <span>{t.ai.seg[2]}</span>
        </span>
      </div>
      {rows.map(([model, provider, c], i) => (
        <div key={model + i} className="ai-row">
          <span className="ai-job">{t.ai.jobs[i]}</span>
          <span className="ai-model">
            <i style={{ background: c }} />
            {model}
            <ChevronDown size={13} />
          </span>
          <small>{t.ai.key(provider)}</small>
        </div>
      ))}
    </div>
  );
}

/* ---------- sections ---------- */

const WORKS_WITH = ['Gmail', 'Google Workspace', 'Microsoft 365', 'Outlook', 'Zoho Mail', 'Claude', 'OpenAI', 'Gemini', 'DeepSeek', 'Qwen', 'Mistral', 'Deepgram', 'Whisper', 'OpenRouter'];

function Pricing() {
  const { t } = useT();
  const p = t.pricing;
  const [track, setTrack] = useState<Track>('own');
  const tiers: Tier[] = ['free', 'small', 'studio', 'agency'];
  return (
    <section id="pricing" className="ln-sec">
      <div className="ln-wrap">
        <div className="ln-head">
          <h2 className="rv">{p.h}</h2>
          <p className="rv" style={{ ['--i' as string]: 1 }}>
            {p.p}
          </p>
          <div className="ln-toggle rv" style={{ ['--i' as string]: 2 }} role="tablist">
            <span className={`ln-toggle-pill ${track}`} aria-hidden="true" />
            <button role="tab" aria-selected={track === 'own'} className={track === 'own' ? 'on' : ''} onClick={() => setTrack('own')}>
              {p.own}
            </button>
            <button role="tab" aria-selected={track === 'ai'} className={track === 'ai' ? 'on' : ''} onClick={() => setTrack('ai')}>
              {p.inc}
            </button>
          </div>
        </div>
        <div className="ln-prices">
          {tiers.map((tier, i) => {
            const price = tier === 'free' ? null : PRICES[track][tier];
            const free = tier === 'free';
            const feats = free && track === 'ai' ? [p.ownKeys, ...PLAN_FEATURES.free.slice(0, 1).map(p.feature), ...PLAN_FEATURES.free.slice(2).map(p.feature)] : PLAN_FEATURES[tier].map(p.feature);
            return (
              <div key={tier} className={`ln-price rv ${tier === 'studio' ? 'hl' : ''}`} style={{ ['--i' as string]: i }}>
                {tier === 'studio' && <span className="ln-pop">{p.pop}</span>}
                <h3>{p.tiers[tier]}</h3>
                <p className="ln-amount">
                  {free ? (
                    <>
                      <b>Rp 0</b>
                      <small>{p.upTo5}</small>
                    </>
                  ) : price!.perPerson ? (
                    <>
                      <b>{rp(price!.base)}</b>
                      <small>{p.perPerson}</small>
                    </>
                  ) : (
                    <>
                      <b>{rp(price!.base)}</b>
                      <small>{p.base(price!.included, rp(price!.extra))}</small>
                    </>
                  )}
                </p>
                <ul>
                  {feats.map((f) => (
                    <li key={f}>
                      <Check size={14} /> {f}
                    </li>
                  ))}
                  {!free && track === 'ai' && (
                    <li>
                      <Check size={14} /> {p.allowance}
                    </li>
                  )}
                </ul>
                <a href={SIGNUP} className={`ln-btn ${tier === 'studio' ? 'primary' : 'outline'} block`}>
                  {free ? p.start : p.tryIt}
                </a>
              </div>
            );
          })}
        </div>
        <p className="ln-note rv">{p.note(rp(PRICES[track].business.base))}</p>
      </div>
    </section>
  );
}

function Page() {
  const { t, lang } = useT();
  useReveal(lang);
  const [open, setOpen] = useState<number | null>(0);
  const needIcons: [LucideIcon, 'warn' | undefined, ReactNode?][] = [
    [TriangleAlert, 'warn', <Bell size={13} />],
    [ListChecks, undefined],
    [Inbox, undefined],
    [CheckSquare, undefined, <Check size={13} />],
  ];
  return (
    <div className="ln" id="top">
      <Nav />

      <section className="ln-hero">
        <div className="ln-wrap">
          <div className="ln-hero-text">
            <span className="ln-eyebrow a" style={{ ['--d' as string]: '0s' }}>
              <Sparkles size={13} /> {t.hero.eyebrow}
            </span>
            <h1>
              <span className="line a" style={{ ['--d' as string]: '.08s' }}>
                {t.hero.line1}
              </span>
              <span className="line a" style={{ ['--d' as string]: '.18s' }}>
                {t.hero.line2}
                <em>{t.hero.em}</em>
              </span>
            </h1>
            <p className="a" style={{ ['--d' as string]: '.32s' }}>
              {t.hero.lead}
            </p>
            <div className="ln-cta a" style={{ ['--d' as string]: '.44s' }}>
              <a href={SIGNUP} className="ln-btn primary lg">
                {t.nav.start} <ArrowRight size={16} />
              </a>
              <a href="#product" className="ln-btn ghost lg">
                {t.hero.tour}
              </a>
            </div>
            <small className="ln-fine a" style={{ ['--d' as string]: '.52s' }}>
              {t.hero.fine}
            </small>
          </div>
          <div className="ln-hero-art a" style={{ ['--d' as string]: '.3s' }}>
            <AppMock />
            <span className="ln-float f1" aria-hidden="true">
              <Check size={13} /> {t.hero.f1}
            </span>
            <span className="ln-float f2" aria-hidden="true">
              <Video size={13} /> {t.hero.f2}
            </span>
            <span className="ln-float f3" aria-hidden="true">
              <Sparkles size={13} /> {t.hero.f3}
            </span>
          </div>
        </div>
      </section>

      <section className="ln-strip" aria-label="Works with">
        <p className="rv">{t.strip}</p>
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
            <h2 className="rv">{t.product.h}</h2>
            <p className="rv" style={{ ['--i' as string]: 1 }}>
              {t.product.p}
            </p>
          </div>
          <Tour />
        </div>
      </section>

      <section className="ln-sec alt">
        <div className="ln-wrap ln-split">
          <div>
            <h2 className="rv">{t.needs.h}</h2>
            <p className="ln-lead rv" style={{ ['--i' as string]: 1 }}>
              {t.needs.lead}
            </p>
            <ul className="ln-points">
              {t.needs.points.map(([b, rest], i) => (
                <li key={b} className="rv" style={{ ['--i' as string]: i + 2 }}>
                  <Check size={16} />{' '}
                  <span>
                    <b>{b}</b>
                    {rest}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="ln-focus rv" style={{ ['--i' as string]: 1 }}>
            <div className="mock-card big">
              <h4>{t.mock.upNext}</h4>
              {t.needs.rows.map(([title, sub, action], i) => (
                <UpNextRow
                  key={title}
                  icon={needIcons[i][0]}
                  tone={needIcons[i][1]}
                  title={title}
                  sub={sub}
                  action={
                    needIcons[i][2] ? (
                      <>
                        {needIcons[i][2]} {action}
                      </>
                    ) : (
                      action
                    )
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="partners" className="ln-sec">
        <div className="ln-wrap ln-split rev">
          <div>
            <span className="ln-kicker rv">
              <Handshake size={14} /> {t.partners.kicker}
            </span>
            <h2 className="rv" style={{ ['--i' as string]: 1 }}>
              {t.partners.h}
            </h2>
            <p className="ln-lead rv" style={{ ['--i' as string]: 2 }}>
              {t.partners.lead}
            </p>
            <ul className="ln-points">
              {t.partners.points.map((x, i) => (
                <li key={x} className="rv" style={{ ['--i' as string]: i + 3 }}>
                  <Check size={16} /> <span>{x}</span>
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
              <Sparkles size={14} /> {t.ai.kicker}
            </span>
            <h2 className="rv" style={{ ['--i' as string]: 1 }}>
              {t.ai.h}
            </h2>
            <p className="ln-lead rv" style={{ ['--i' as string]: 2 }}>
              {t.ai.lead}
            </p>
            <ul className="ln-points">
              {t.ai.points.map((x, i) => (
                <li key={x} className="rv" style={{ ['--i' as string]: i + 3 }}>
                  <Check size={16} /> <span>{x}</span>
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
            <h2 className="rv">{t.email.h}</h2>
            <p className="rv" style={{ ['--i' as string]: 1 }}>
              {t.email.p}
            </p>
          </div>
          <div className="ln-two">
            <div className="ln-opt rv">
              <span className="ln-app-ic">
                <Cloud size={19} />
              </span>
              <h3>{t.email.keepH}</h3>
              <p>{t.email.keepP}</p>
            </div>
            <div className="ln-opt rv" style={{ ['--i' as string]: 1 }}>
              <span className="ln-app-ic">
                <Server size={19} />
              </span>
              <h3>{t.email.moveH}</h3>
              <p>{t.email.moveP}</p>
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
            <p>{t.about.quote}</p>
          </div>
          <article className="ln-founder rv" style={{ ['--i' as string]: 1 }}>
            <span className="ln-founder-av">AJ</span>
            <div>
              <h3>Aqeel</h3>
              <p className="ln-founder-role">{t.about.role}</p>
              <p>{t.about.p1}</p>
              <p>{t.about.p2}</p>
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
            {t.about.chips.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="ln-sec">
        <div className="ln-wrap ln-faq-wrap">
          <h2 className="rv">{t.faq.h}</h2>
          <div className="ln-faq">
            {t.faq.items.map(([q, a], i) => (
              <div key={i} className={`ln-q rv ${open === i ? 'open' : ''}`} style={{ ['--i' as string]: i }}>
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
          <h2>{t.final.h}</h2>
          <p>{t.final.p}</p>
          <a href={SIGNUP} className="ln-btn white lg">
            {t.nav.start} <ArrowRight size={16} />
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
            {SECTIONS.map((id) => (
              <a key={id} href={`#${id}`}>
                {t.nav[id]}
              </a>
            ))}
            <a href={APP}>{t.nav.signin}</a>
          </nav>
          <small>
            © {new Date().getFullYear()} Sprint2go · {t.foot}
          </small>
        </div>
      </footer>
    </div>
  );
}

/** The landing page, in English or Bahasa Indonesia (the browser's language first, then whatever the visitor picks). */
export function Landing() {
  const [lang, setLangState] = useState<Lang>(startLang);
  const ctx = useMemo(
    () => ({
      lang,
      t: STR[lang],
      setLang: (l: Lang) => {
        setLangState(l);
        try {
          localStorage.setItem('s2g-lang', l);
        } catch {
          /* storage blocked: the choice lasts for this visit */
        }
      },
    }),
    [lang],
  );
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = lang === 'id' ? 'Sprint2go · Satu aplikasi untuk seluruh hari kerja' : 'Sprint2go · One app for the whole workday';
  }, [lang]);
  return (
    <LangCtx.Provider value={ctx}>
      <Page />
    </LangCtx.Provider>
  );
}
