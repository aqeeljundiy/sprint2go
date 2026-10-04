import { useState } from 'react';
import { BellRing, Bot, ChevronDown, Eye, FileSearch, Forward, MousePointerClick, Reply } from 'lucide-react';
import type { Message, Thread } from '../types';
import { DEFAULT_TRACK_OPTIONS, fmtDuration, maybeForwarded, realOpens, replyAfter, summarize } from '../tracking';
import { fullDate, relative } from '../utils';
import { Avatar } from './Avatar';

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
        <strong>Read tracking</strong>
        <span>
          {sum.opens
            ? `Opened by ${sum.openedBy} of ${sum.recipients} · ${sum.opens} open${sum.opens > 1 ? 's' : ''}${sum.clicks ? ` · ${sum.clicks} click${sum.clicks > 1 ? 's' : ''}` : ''}`
            : 'Not opened yet'}
        </span>
      </div>

      {emails.map((email) => {
        const r = tracking[email];
        const person = message.to.find((p) => p.email === email) ?? { name: email, email };
        const real = realOpens(r);
        const last = real[real.length - 1];
        const replied = replyAfter(thread, message, email);
        const forwarded = maybeForwarded(r);
        const events = [
          ...r.opens.map((o) => ({ kind: o.auto ? ('auto' as const) : ('open' as const), at: o.at, o })),
          ...r.clicks.map((c) => ({ kind: 'click' as const, at: c.at, c })),
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
                <small className={replied || real.length ? 'ok' : r.opens.length ? 'auto' : ''}>
                  {replied
                    ? `Replied ${relative(replied)}`
                    : real.length
                      ? `Opened ${real.length}× · last ${relative(last.at)}${opts.details && last.device ? ` on ${last.device.split(' · ')[0]}` : ''}`
                      : r.opens.length
                        ? 'Auto-opened by Apple Mail, may not be read yet'
                        : 'Not opened yet'}
                </small>
              </span>
              {forwarded && (
                <span className="tp-tag warn" title="Opened from more than one city, so it may have been forwarded">
                  <Forward size={12} /> Forwarded?
                </span>
              )}
              {(r.docs?.length ?? 0) > 0 && (
                <span className="tp-tag" title="Attachment views">
                  <FileSearch size={12} /> {r.docs!.length}
                </span>
              )}
              {r.clicks.length > 0 && (
                <span className="tp-tag" title="Link clicks">
                  <MousePointerClick size={12} /> {r.clicks.length}
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
                      ) : ev.kind === 'auto' ? (
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
                        <>
                          Clicked <b>{ev.c.label}</b>
                        </>
                      )}
                      {ev.kind === 'doc' && (
                        <>
                          Viewed <b>{ev.d.file}</b> for {fmtDuration(ev.d.seconds)}
                          {ev.d.pages && ` · ${ev.d.pages} pages`}
                        </>
                      )}
                      {ev.kind === 'reply' && <b>Replied</b>}
                      {ev.kind === 'auto' && <>Loaded automatically ({ev.o.auto === 'apple' ? 'Apple Mail Privacy' : 'security scanner'}), not counted</>}
                      {ev.kind === 'open' &&
                        (opts.details ? (
                          <>
                            Opened on <b>{ev.o.device}</b>
                            {ev.o.place && ` · ${ev.o.place}`}
                          </>
                        ) : (
                          <b>Opened</b>
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
          {remindAt > new Date() ? `Reminder on ${remindAt.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} if there’s no reply` : 'No reply yet, time to follow up'}
        </div>
      )}
      <p className="tp-note">Opens are a good signal, not proof. Some apps load images automatically, others block them. Clicks, file views and replies are reliable.</p>
    </div>
  );
}
