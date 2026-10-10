import { useState } from 'react';
import { BellRing, Bot, ChevronDown, Eye, FileSearch, Forward, MousePointerClick, Reply } from 'lucide-react';
import type { Message, Thread } from '../types';
import { DEFAULT_TRACK_OPTIONS, PROXY, autoWhy, fmtDuration, maybeForwarded, realClicks, realOpens, recipientLine, replyAfter, summarize } from '../tracking';
import { fullDate, relative } from '../utils';
import { Avatar } from './Avatar';
import { t, tn } from '../i18n';
import { tj } from '../i18n/tj';
import { fmtWeekday } from '../i18n/format';

/** "6 of 8 pages" (the tracker writes "6 of 8"). */
const pagesSeen = (s: string) => {
  const m = s.match(/^(\d+) of (\d+)$/);
  return m ? t('{seen} of {total} pages', { seen: m[1], total: m[2] }) : s;
};

/** Who opened an email you sent, how often, what they clicked and viewed, and whether they replied. */
export function TrackingPanel({ thread, message }: { thread: Thread; message: Message }) {
  const tracking = message.tracking!;
  const opts = message.trackOptions ?? DEFAULT_TRACK_OPTIONS;
  const emails = Object.keys(tracking);
  const [open, setOpen] = useState<Set<string>>(new Set(emails.length === 1 ? emails : []));
  const sum = summarize(tracking);

  const toggle = (e: string) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(e) ? n.delete(e) : n.add(e);
      return n;
    });

  const remindAt = opts.remindDays ? new Date(new Date(message.date).getTime() + opts.remindDays * 86_400_000) : null;

  return (
    <div className="track-panel">
      <div className="tp-head">
        <Eye size={15} />
        <strong>{t('Read tracking')}</strong>
        <span>
          {sum.opens
            ? [t('Opened by {opened} of {total}', { opened: sum.openedBy, total: sum.recipients }), tn(sum.opens, '{n} open', '{n} opens'), sum.clicks ? tn(sum.clicks, '{n} click', '{n} clicks') : ''].filter(Boolean).join(' · ')
            : sum.clicks
              ? tn(sum.clicks, '{n} click', '{n} clicks')
              : sum.autoOnly
                ? t('Opened (maybe automatic)')
                : t('Not opened yet')}
        </span>
      </div>

      {emails.map((email) => {
        const r = tracking[email];
        const person = [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])].find((p) => p.email === email) ?? { name: email, email };
        const real = realOpens(r);
        const clicks = realClicks(r);
        const replied = replyAfter(thread, message, email);
        const forwarded = maybeForwarded(r);
        const events = [
          ...r.opens.map((o) => ({ kind: o.auto ? ('auto' as const) : ('open' as const), at: o.at, o })),
          ...r.clicks.map((c) => ({ kind: c.auto ? ('checked' as const) : ('click' as const), at: c.at, c })),
          ...(r.docs ?? []).map((d) => ({ kind: 'doc' as const, at: d.at, d })),
          ...(replied ? [{ kind: 'reply' as const, at: replied }] : []),
        ].sort((a, b) => b.at.localeCompare(a.at));
        const isOpen = open.has(email);

        return (
          <div key={email} className={`tp-person ${isOpen ? 'open' : ''}`}>
            <button className="tp-row" onClick={() => events.length && toggle(email)} disabled={!events.length}>
              <Avatar person={person} size={28} />
              <span className="tp-who">
                <strong>{person.name}</strong>
                <small className={replied || real.length || clicks.length ? 'ok' : r.opens.length ? 'auto' : ''} title={!replied && !real.length && !clicks.length && r.opens.length ? autoWhy(r.opens[r.opens.length - 1]) : undefined}>
                  {replied ? t('Replied {when}', { when: relative(replied) }) : recipientLine(r)}
                </small>
              </span>
              {forwarded && (
                <span className="tp-tag warn" title={t('Opened from more than one city, so it may have been forwarded')}>
                  <Forward size={12} /> {t('Forwarded?')}
                </span>
              )}
              {(r.docs?.length ?? 0) > 0 && (
                <span className="tp-tag" title={t('Attachment views')}>
                  <FileSearch size={12} /> {r.docs!.length}
                </span>
              )}
              {clicks.length > 0 && (
                <span className="tp-tag" title={t('Link clicks')}>
                  <MousePointerClick size={12} /> {clicks.length}
                </span>
              )}
              {events.length > 0 && <ChevronDown size={16} className="tp-chev" />}
            </button>

            {isOpen && (
              <ol className="tp-timeline">
                {events.map((ev, i) => (
                  <li key={i} className={`tp-ev ${ev.kind}`}>
                    <span className="tp-icon">
                      {ev.kind === 'click' ? (
                        <MousePointerClick size={13} />
                      ) : ev.kind === 'auto' || ev.kind === 'checked' ? (
                        <Bot size={13} />
                      ) : ev.kind === 'doc' ? (
                        <FileSearch size={13} />
                      ) : ev.kind === 'reply' ? (
                        <Reply size={13} />
                      ) : (
                        <Eye size={13} />
                      )}
                    </span>
                    <span className="tp-text">
                      {ev.kind === 'click' && (
                        <>{tj('Clicked {link}', { link: <b>{ev.c.label}</b> })}</>
                      )}
                      {ev.kind === 'doc' && (
                        <>
                          {tj('Viewed {file} for {time}', { file: <b>{ev.d.file}</b>, time: fmtDuration(ev.d.seconds) })}
                          {ev.d.pages && ` · ${pagesSeen(ev.d.pages)}`}
                        </>
                      )}
                      {ev.kind === 'reply' && <b>{t('Replied')}</b>}
                      {ev.kind === 'checked' && (
                        <span title={t('Some mail filters open every link to check it before the person sees the email')}>{t('Link checked by a mail filter: {link}, not counted', { link: ev.c.label })}</span>
                      )}
                      {ev.kind === 'auto' && <span title={autoWhy(ev.o)}>{ev.o.auto === 'apple' ? t('Opened (maybe automatic) by Apple Mail, not counted') : t('Opened (maybe automatic), not counted')}</span>}
                      {ev.kind === 'open' &&
                        (ev.o.via ? (
                          <span title={t('{app} loads pictures through its own servers, so the device isn’t known', { app: PROXY[ev.o.via] })}>{tj('Opened via {app}', { app: <b>{PROXY[ev.o.via]}</b> })}</span>
                        ) : ev.o.device ? (
                          <>
                            {tj('Opened on {device}', { device: <b>{ev.o.device}</b> })}
                            {ev.o.place && ` · ${ev.o.place}`}
                          </>
                        ) : (
                          <>
                            <b>{t('Opened')}</b>
                            {ev.o.place && ` · ${ev.o.place}`}
                          </>
                        ))}
                    </span>
                    <time title={fullDate(ev.at)}>{relative(ev.at)}</time>
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}

      {remindAt && !emails.every((e) => replyAfter(thread, message, e)) && (
        <div className="tp-remind">
          <BellRing size={13} />
          {remindAt > new Date() ? t('Reminder on {day} if there’s no reply', { day: fmtWeekday(remindAt) }) : t('No reply yet, time to follow up')}
        </div>
      )}
      <p className="tp-note">{t('Opens are a hint, not proof. Apple Mail and some mail filters load pictures by themselves, so those show as maybe automatic and don’t count. Gmail and Outlook.com load them through their own servers, which hide the device. Apps that block pictures never show an open. Clicks and replies are the surest signs.')}</p>
    </div>
  );
}
