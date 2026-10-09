import { useRef, useState } from 'react';
import { ChevronDown, Lock, Link2 } from 'lucide-react';
import type { Client } from '../../types';
import { term } from '../../terms';
import { lsKey } from '../../settings';
import { Sheet } from '../ui/Sheet';
import { Select, Dot } from '../ui/Select';

const LAST = 's2g-quick-note-to';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Quick capture: a note from anywhere (More's New row, or text and links shared from another app on the phone),
 * without leaving the screen you're on. A short line becomes the title, anything longer the note itself. Where it goes
 * is a chip at the top, Private or a project, starting on the last one used.
 */
export function QuickNote({ shared, clients, onSave, onClose }: { shared?: { title?: string; text?: string; url?: string }; clients: Client[]; onSave: (n: { title: string; html: string; clientId?: string }) => void; onClose: () => void }) {
  const [text, setText] = useState(() => [shared?.title, shared?.text].filter(Boolean).join('\n'));
  const url = shared?.url && !(shared.text ?? '').includes(shared.url) ? shared.url : '';
  const open = clients.filter((c) => c.status !== 'ended');
  const [to, setTo] = useState<string>(() => {
    try {
      const v = localStorage.getItem(lsKey(LAST)) ?? '';
      return open.some((c) => c.id === v) ? v : '';
    } catch {
      return '';
    }
  });
  // Picking where it goes hands the typing back to the note (the one saved with comes back next time).
  const pick = (v: string) => {
    setTo(v);
    box.current?.focus({ preventScroll: true });
  };
  const box = useRef<HTMLTextAreaElement>(null);
  const save = () => {
    const t = text.trim();
    if (!t && !url) return;
    const [first, ...rest] = t.split(/\r?\n/);
    const short = !rest.length && first.length <= 80;
    const title = short ? first : rest.length && first.length <= 80 ? first : '';
    const lines = short ? [] : title ? rest : t.split(/\r?\n/);
    const html = [...lines.filter((l, i) => l.trim() || i > 0).map((l) => `<p>${esc(l) || '<br>'}</p>`), ...(url ? [`<p><a href="${esc(url)}">${esc(url)}</a></p>`] : [])].join('');
    try {
      localStorage.setItem(lsKey(LAST), to);
    } catch {
      /* not remembered */
    }
    onSave({ title, html, clientId: to || undefined });
  };
  const dest = open.find((c) => c.id === to);
  return (
    <Sheet
      title={shared ? 'Save to a note' : 'New note'}
      onClose={onClose}
      className="quick-note"
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="primary-btn" onClick={save} disabled={!text.trim() && !url}>
            Save
          </button>
        </>
      }
    >
      <div className="qn">
        <div className="qn-top">
          <Select<string>
            value={to}
            onChange={pick}
            label={`Where it goes: ${dest ? dest.name : 'Private'}`}
            title="Where it goes"
            className="qn-dest"
            width={260}
            options={[{ value: '', label: 'Private', hint: 'Only you', icon: <Lock size={14} /> }, ...open.map((c) => ({ value: c.id, label: c.name, group: term.Many, icon: <Dot color={c.color} /> }))]}
            renderValue={() => (
              <>
                {dest ? <Dot color={dest.color} /> : <Lock size={13} />}
                <span className="sel-text">{dest ? dest.name : 'Private'}</span>
                <ChevronDown size={14} className="sel-chev" />
              </>
            )}
          />
        </div>
        <textarea
          ref={box}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), save())}
          placeholder="What’s on your mind? The first line is the title."
          aria-label="Note"
          rows={4}
        />
        {url && (
          <p className="qn-link">
            <Link2 size={14} />
            <span>{url}</span>
          </p>
        )}
      </div>
    </Sheet>
  );
}
