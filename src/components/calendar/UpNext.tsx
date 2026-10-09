import { useEffect, useMemo, useState } from 'react';
import { Mic, MicOff, Repeat, Video } from 'lucide-react';
import type { CalEvent } from '../../types';
import { MEETING_NAME, meetingLinkOf, notetakerJoins } from '../../meetingLinks';
import { startsIn, upNext } from './calTools';
import { expandEvents } from '../../repeat';
import { t } from '../../i18n';

/**
 * The next meeting, when it starts within 30 minutes: its title, how soon, Join, and whether the notetaker goes.
 * It folds away five minutes after the start.
 */
export function UpNext({ events, color, onOpen, botWill }: { events: CalEvent[]; color: (id: string) => string; onOpen: (id: string) => void; botWill?: (e: CalEvent) => boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  // Repeating events: their dates around now (worked out again every ten minutes).
  const slot = Math.floor(now / 600_000);
  const near = useMemo(() => expandEvents(events, slot * 600_000 - 3_600_000, slot * 600_000 + 2 * 3_600_000), [events, slot]);
  const e = upNext(near, now);
  // Keep the last one while it folds away, so the strip doesn't empty before it closes.
  const [shown, setShown] = useState<CalEvent | undefined>(e);
  useEffect(() => {
    if (e) setShown(e);
  }, [e?.id, e?.start, e?.title]); // eslint-disable-line react-hooks/exhaustive-deps
  const ev = e ?? shown;
  const link = ev ? meetingLinkOf(ev) : null;
  const bot = ev && link && notetakerJoins(link.kind) && botWill ? botWill(ev) : undefined;
  return (
    <div className={`fold cal-upnext-fold${e ? ' open' : ''}`} aria-hidden={!e}>
      <div>
        {ev && (
          <div className="cal-upnext" style={{ ['--c' as string]: color(ev.calendarId) }}>
            <button type="button" className="cu-main" onClick={() => onOpen(ev.id)}>
              <span className="cu-when">{new Date(ev.start).getTime() <= now ? 'Now' : startsIn(ev, now)}</span>
              <span className="cu-title">{ev.title}</span>
              {ev.rrule && <Repeat size={13} className="cu-repeat" aria-label={t('Repeats')} />}
              {bot !== undefined && (bot ? <Mic size={14} className="cu-bot on" aria-label="The notetaker will join" /> : <MicOff size={14} className="cu-bot" aria-label="The notetaker won’t join" />)}
            </button>
            {link && (
              <a className="primary-btn sm cu-join" href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`Join ${MEETING_NAME[link.kind]}`}>
                <Video size={14} /> Join
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
