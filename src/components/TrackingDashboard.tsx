import { useMemo, useState } from 'react';
import { BellRing, Eye, FileSearch, Menu, MousePointerClick, Reply, Send, Timer } from 'lucide-react';
import type { Message, Person, Thread } from '../types';
import { DEFAULT_TRACK_OPTIONS, fmtDuration, realClicks, realOpens, replyAfter, summarize } from '../tracking';
import { fullDate, relative } from '../utils';
import { Avatar } from './Avatar';
import { isMine } from '../identity';
import { EmptyState } from './ui/EmptyState';
import { t } from '../i18n';
import { tj } from '../i18n/tj';
import { fmtNumber, fmtPercent } from '../i18n/format';

interface Props {
  threads: Thread[];
  me: Person;
  onOpenThread: (id: string) => void;
  onNudge: (thread: Thread, to: Person) => void;
  onMenu: () => void;
}

type Filter = 'all' | 'opened' | 'unopened' | 'clicked' | 'waiting';

interface Entry {
  thread: Thread;
  message: Message;
  people: Person[];
  opens: number;
  clicks: number;
  docs: number;
  autoOnly: boolean;
  replied: Person[];
  waiting: Person[];
  last?: string;
  remindDue: boolean;
}

export function TrackingDashboard({ threads, me, onOpenThread, onNudge, onMenu }: Props) {
  const [filter, setFilter] = useState<Filter>('all');

  const { entries, feed, kpis } = useMemo(() => {
    const entries: Entry[] = [];
    // What happened, in words at render time (so a language switch rewrites them).
    const feed: { at: string; who: Person; kind: 'open' | 'click' | 'doc' | 'reply'; threadId: string; link?: string; file?: string; secs?: number }[] = [];
    let recipients = 0;
    let opened = 0;
    let clicked = 0;
    let repliedN = 0;
    const firstOpenDelays: number[] = [];

    for (const th of threads) {
      if (th.location === 'trash' || th.location === 'drafts') continue;
      for (const m of th.messages) {
        if (!isMine(m.from.email) || !m.tracking) continue;
        const sum = summarize(m.tracking);
        const opts = m.trackOptions ?? DEFAULT_TRACK_OPTIONS;
        const people = Object.keys(m.tracking).map((e) => m.to.find((p) => p.email === e) ?? { name: e, email: e });
        const replied: Person[] = [];
        const waiting: Person[] = [];
        let last: string | undefined = sum.lastOpen;
        let docs = 0;

        for (const p of people) {
          const r = m.tracking[p.email];
          const real = realOpens(r);
          const rep = replyAfter(th, m, p.email);
          recipients++;
          if (real.length) opened++;
          if (realClicks(r).length) clicked++;
          if (rep) {
            repliedN++;
            replied.push(p);
            feed.push({ at: rep, who: p, kind: 'reply', threadId: th.id });
            if (!last || rep > last) last = rep;
          } else waiting.push(p);
          if (real[0]) firstOpenDelays.push(new Date(real[0].at).getTime() - new Date(m.date).getTime());
          for (const o of real) feed.push({ at: o.at, who: p, kind: 'open', threadId: th.id });
          for (const c of realClicks(r)) {
            feed.push({ at: c.at, who: p, kind: 'click', threadId: th.id, link: c.label });
            if (!last || c.at > last) last = c.at;
          }
          for (const d of r.docs ?? []) {
            docs++;
            feed.push({ at: d.at, who: p, kind: 'doc', threadId: th.id, file: d.file, secs: d.seconds });
            if (!last || d.at > last) last = d.at;
          }
        }
        const remindDue = !!opts.remindDays && waiting.length > 0 && Date.now() - new Date(m.date).getTime() > opts.remindDays * 86_400_000;
        entries.push({ thread: th, message: m, people, opens: sum.opens, clicks: sum.clicks, docs, autoOnly: sum.autoOnly > 0 && !sum.opens, replied, waiting, last, remindDue });
      }
    }
    entries.sort((a, b) => (b.last ?? b.message.date).localeCompare(a.last ?? a.message.date));
    feed.sort((a, b) => b.at.localeCompare(a.at));
    const pct = (n: number) => (recipients ? Math.round((n / recipients) * 100) : 0);
    const avg = firstOpenDelays.length ? firstOpenDelays.reduce((a, b) => a + b, 0) / firstOpenDelays.length : 0;
    return {
      entries,
      feed: feed.slice(0, 14),
      kpis: { tracked: entries.length, open: pct(opened), click: pct(clicked), reply: pct(repliedN), avgOpen: avg },
    };
  }, [threads, me.email]);

  const shown = entries.filter((e) =>
    filter === 'opened' ? e.opens > 0 : filter === 'unopened' ? e.opens === 0 : filter === 'clicked' ? e.clicks + e.docs > 0 : filter === 'waiting' ? e.waiting.length > 0 : true,
  );
  const waiting = entries.filter((e) => e.waiting.length).sort((a, b) => Number(b.remindDue) - Number(a.remindDue) || a.message.date.localeCompare(b.message.date));

  const avgLabel = !kpis.avgOpen ? t('n/a') : kpis.avgOpen < 3_600_000 ? t('{n} min', { n: Math.max(1, Math.round(kpis.avgOpen / 60_000)) }) : t('{n} h', { n: fmtNumber(kpis.avgOpen / 3_600_000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });

  return (
    <section className="tracking-pane view-enter">
      <header className="tracking-head">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label={t('Open menu')}>
          <Menu size={18} />
        </button>
        <div>
          <h1>{t('Waiting for reply')}</h1>
          <p>{t('Who opened, clicked and replied to the emails you tracked')}</p>
        </div>
      </header>

      <div className="tracking-scroll">
        <div className="kpis">
          {(
            [
              [Send, t('Tracked emails'), fmtNumber(kpis.tracked)],
              [Eye, t('Open rate'), fmtPercent(kpis.open / 100)],
              [MousePointerClick, t('Click rate'), fmtPercent(kpis.click / 100)],
              [Reply, t('Reply rate'), fmtPercent(kpis.reply / 100)],
              [Timer, t('Avg. time to open'), avgLabel],
            ] as const
          ).map(([Icon, label, value], i) => (
            <div key={label} className="kpi" style={{ ['--i' as string]: i }}>
              <span className="kpi-icon">
                <Icon size={15} />
              </span>
              <span className="kpi-value">{value}</span>
              <span className="kpi-label">{label}</span>
            </div>
          ))}
        </div>

        <div className="tracking-grid">
          <div className="tg-main">
            <div className="tg-bar">
              <h2>{t('Tracked emails')}</h2>
              <div className="segmented">
                {(
                  [
                    ['all', t('All')],
                    ['opened', t('Opened')],
                    ['unopened', t('Not opened')],
                    ['clicked', t('Clicked')],
                    ['waiting', t('No reply')],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="te-list">
              {shown.length === 0 && <EmptyState compact text={t('Nothing here. Turn on tracking when you send an email to see opens and clicks.')} />}
              {shown.map((e, n) => {
                const status = e.replied.length === e.people.length
                  ? { cls: 'replied', icon: Reply, text: t('Replied') }
                  : e.clicks + e.docs > 0
                    ? { cls: 'clicked', icon: MousePointerClick, text: t('Clicked · seen {n}×', { n: e.opens }) }
                    : e.opens
                      ? { cls: 'seen', icon: Eye, text: t('Seen {n}×', { n: e.opens }) }
                      : e.autoOnly
                        ? { cls: 'auto', icon: Eye, text: t('Opened (maybe automatic)') }
                        : { cls: 'none', icon: Eye, text: t('Not opened') };
                return (
                  <button key={e.message.id} className="te-row" style={{ ['--i' as string]: Math.min(n, 12) }} onClick={() => onOpenThread(e.thread.id)}>
                    <div className="te-people">
                      {e.people.slice(0, 3).map((p) => (
                        <Avatar key={p.email} person={p} size={30} />
                      ))}
                    </div>
                    <div className="te-main">
                      <strong>{e.thread.subject}</strong>
                      <small>{t('To {names} · sent {when}', { names: e.people.map((p) => p.name).join(', '), when: relative(e.message.date) })}</small>
                    </div>
                    <div className="te-stats">
                      <span title={t('Opens')}>
                        <Eye size={13} /> {e.opens}
                      </span>
                      <span title={t('Link clicks')}>
                        <MousePointerClick size={13} /> {e.clicks}
                      </span>
                      <span title={t('Attachment views')}>
                        <FileSearch size={13} /> {e.docs}
                      </span>
                    </div>
                    <span className={`te-status ${status.cls}`}>
                      <status.icon size={12} /> {status.text}
                    </span>
                    <span className="te-last" title={e.last ? fullDate(e.last) : ''}>
                      {e.last ? relative(e.last) : t('No activity')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <aside className="tg-side">
            <div className="side-card">
              <h3>
                <BellRing size={14} /> {t('Waiting for a reply')}
              </h3>
              {waiting.length === 0 && <EmptyState compact text={t('Everyone has replied. 🎉')} />}
              {waiting.map((e) => (
                <div key={e.message.id} className={`wait-row ${e.remindDue ? 'due' : ''}`}>
                  <Avatar person={e.waiting[0]} size={28} />
                  <div className="wait-main" onClick={() => onOpenThread(e.thread.id)} role="button" tabIndex={0} onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && ev.target === ev.currentTarget && (ev.preventDefault(), onOpenThread(e.thread.id))}>
                    <strong>{e.waiting.map((p) => p.name.split(' ')[0]).join(', ')}</strong>
                    <small>
                      {e.thread.subject} · {relative(e.message.date)} · {e.opens ? t('seen {n}×', { n: e.opens }) : t('not opened')}
                    </small>
                  </div>
                  <button className={e.remindDue ? 'primary-btn sm' : 'ghost-btn outline sm'} onClick={() => onNudge(e.thread, e.waiting[0])}>
                    {t('Nudge')}
                  </button>
                </div>
              ))}
            </div>

            <div className="side-card">
              <h3>
                <span className="live-dot" /> {t('Activity')}
              </h3>
              {feed.length === 0 && <EmptyState compact text={t('No activity yet.')} />}
              <ol className="feed">
                {feed.map((f, i) => (
                  <li key={i} onClick={() => onOpenThread(f.threadId)} className={`feed-${f.kind}`}>
                    <span className="feed-icon">
                      {f.kind === 'click' ? <MousePointerClick size={12} /> : f.kind === 'doc' ? <FileSearch size={12} /> : f.kind === 'reply' ? <Reply size={12} /> : <Eye size={12} />}
                    </span>
                    <span className="feed-text">
                      {(() => {
                        const name = <b>{f.who.name.split(' ')[0]}</b>;
                        const subject = <i>{threads.find((th) => th.id === f.threadId)?.subject}</i>;
                        return f.kind === 'reply'
                          ? tj('{name} replied to {subject}', { name, subject })
                          : f.kind === 'click'
                            ? tj('{name} clicked “{link}” in {subject}', { name, link: f.link ?? '', subject })
                            : f.kind === 'doc'
                              ? tj('{name} viewed {file} ({time}) from {subject}', { name, file: f.file ?? '', time: fmtDuration(f.secs ?? 0), subject })
                              : tj('{name} opened {subject}', { name, subject });
                      })()}
                    </span>
                    <time title={fullDate(f.at)}>{relative(f.at)}</time>
                  </li>
                ))}
              </ol>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
