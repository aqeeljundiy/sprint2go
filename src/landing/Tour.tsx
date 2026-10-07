import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Calendar, Check, CheckSquare, Eye, FileText, FolderOpen, KeyRound, Mail, MessagesSquare, Mic, NotebookPen, Paperclip, Sparkles, Video, type LucideIcon } from 'lucide-react';

/* Small product previews for the tour, built from the app's own look. Each one moves a little, on its own. */

const Chip = ({ children, tone }: { children: ReactNode; tone?: 'blue' | 'amber' | 'green' | 'pink' }) => <span className={`tc ${tone ?? ''}`}>{children}</span>;

function MailMock() {
  const rows: [string, string, string, ReactNode][] = [
    ['Nadia Putri', 'Re: Q4 concepts', 'Love direction 2. Could one of the four lean into…', <Chip tone="amber">KopiKita</Chip>],
    ['Sarah Lim', 'Budget for 12.12', 'Can we see two scenarios before Friday?', <Chip tone="pink">Lumina Skin</Chip>],
    ['Kirana Dewi', 'Founder intro', 'We’re a subscription coffee brand looking for…', <Chip>New lead</Chip>],
  ];
  return (
    <div className="tm">
      <div className="tm-head">
        <strong>Inbox</strong>
        <span className="tm-seg">
          <span className="on">Needs reply</span>
          <span>Everything</span>
        </span>
      </div>
      {rows.map(([from, subj, snip, chip], i) => (
        <div key={from} className="tm-mail" style={{ ['--i' as string]: i }}>
          <span className="tm-av">{from.charAt(0)}</span>
          <span className="tm-mtxt">
            <span className="tm-mrow">
              <b>{from}</b> {chip}
            </span>
            <small>
              <strong>{subj}</strong> · {snip}
            </small>
          </span>
        </div>
      ))}
      <div className="tm-found">
        <Sparkles size={13} /> To-do found in Sarah’s email: <b>Send two 12.12 budget scenarios</b>, due Friday <span className="tm-add">Add</span>
      </div>
    </div>
  );
}

function ChatMock() {
  return (
    <div className="tm">
      <div className="tm-head">
        <strong># kopikita-x-pnp</strong>
        <Chip tone="green">Guests can see this</Chip>
      </div>
      <div className="tm-msg" style={{ ['--i' as string]: 0 }}>
        <span className="tm-av" style={{ background: '#b45309' }}>N</span>
        <span>
          <b>
            Nadia Putri <em className="tm-guest">Guest · KopiKita</em>
          </b>
          <p>The morning ritual angle is exactly it. Can we see it as a 15s?</p>
        </span>
      </div>
      <div className="tm-msg" style={{ ['--i' as string]: 1 }}>
        <span className="tm-av" style={{ background: '#5b5bf6' }}>A</span>
        <span>
          <b>Aqeel</b>
          <span className="tm-voice">
            <Mic size={12} />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <small>0:14</small>
          </span>
        </span>
      </div>
      <div className="tm-msg" style={{ ['--i' as string]: 2 }}>
        <span className="tm-av" style={{ background: '#f97316' }}>N</span>
        <span>
          <b>Nanda</b>
          <p>
            Cut is up <Paperclip size={11} /> <u>KopiKita_ritual_15s.mp4</u>
          </p>
        </span>
      </div>
    </div>
  );
}

function TasksMock() {
  const cols: [string, [string, ReactNode?][]][] = [
    ['To do', [['Storyboard the 15s cut'], ['Brief for 12.12', <Chip tone="pink">Lumina</Chip>]]],
    ['In progress', [['Four Q4 concepts', <Chip tone="amber">KopiKita</Chip>]]],
    ['Waiting on guest', [['November ad budget', <Chip tone="blue">Approve</Chip>]]],
  ];
  return (
    <div className="tm">
      <div className="tm-board">
        {cols.map(([name, cards]) => (
          <div key={name} className="tm-col">
            <small>{name}</small>
            {cards.map(([t, chip], i) => (
              <div key={t} className="tm-card" style={{ ['--i' as string]: i }}>
                <span>{t}</span>
                {chip}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="tm-found">
        <Check size={13} /> Nadia approved <b>Four Q4 concepts</b>. Moved to Done.
      </div>
    </div>
  );
}

function CalendarMock() {
  return (
    <div className="tm tm-cal">
      <div className="tm-head">
        <strong>Thursday, 8 October</strong>
        <small>Drag a task into your day</small>
      </div>
      <div className="tm-day">
        {['9', '10', '11', '12', '13', '14'].map((h) => (
          <span key={h} className="tm-hr">
            {h}:00
          </span>
        ))}
        <span className="tm-ev a" style={{ top: '4%', height: '14%' }}>
          Standup
        </span>
        <span className="tm-ev b" style={{ top: '52%', height: '22%' }}>
          Lumina monthly review
        </span>
        <span className="tm-ev c drag">
          <CheckSquare size={11} /> Storyboard the 15s cut
        </span>
      </div>
    </div>
  );
}

function MeetMock() {
  return (
    <div className="tm">
      <div className="tm-head">
        <strong>Lumina monthly review</strong>
        <small>47 min · notes ready</small>
      </div>
      <p className="tm-sum">Blended ROAS rose to 4.1 from 3.2. Sarah approved scaling for 11.11 and wants 12.12 scenarios next week.</p>
      <small className="tm-label">Decisions</small>
      <div className="tm-li">
        <Check size={12} /> Scale 11.11 budget by 30%
      </div>
      <small className="tm-label">Action items</small>
      {[
        ['Two 12.12 budget scenarios', 'F', '#f59e0b'],
        ['Retargeting carousel for bundles', 'S', '#d946ef'],
      ].map(([t, a, c], i) => (
        <div key={t} className="tm-li task" style={{ ['--i' as string]: i }}>
          <CheckSquare size={12} /> {t}
          <span className="tm-av sm" style={{ background: c }}>
            {a}
          </span>
        </div>
      ))}
    </div>
  );
}

function DriveMock() {
  const files: [string, string, boolean][] = [
    ['KopiKita_ritual_15s.mp4', '48 MB', true],
    ['Q4 concepts.pdf', '6.4 MB', true],
    ['Retainer contract 2026.pdf', '220 KB', false],
  ];
  return (
    <div className="tm">
      <div className="tm-head">
        <strong>
          <FolderOpen size={14} /> KopiKita
        </strong>
        <small>Shared with guests are marked</small>
      </div>
      {files.map(([n, s, shared], i) => (
        <div key={n} className="tm-file" style={{ ['--i' as string]: i }}>
          <FileText size={15} />
          <span>{n}</span>
          <small>{s}</small>
          <span className={`tm-eye ${shared ? 'on' : ''}`} title={shared ? 'Guests can see it' : 'Team only'}>
            <Eye size={12} /> {shared ? 'Shared' : 'Team only'}
          </span>
        </div>
      ))}
    </div>
  );
}

function NotesMock() {
  return (
    <div className="tm">
      <div className="tm-head">
        <strong>KopiKita review call prep</strong>
        <small>Team · edited just now</small>
      </div>
      <p className="tm-note">Open with the 11.11 numbers, then the four concepts.</p>
      <p className="tm-note">
        <mark>Ask Nadia for the CEO’s final word by Friday</mark>
        <span className="tm-pop">
          <CheckSquare size={12} /> Make a task
        </span>
      </p>
      <p className="tm-note muted">Bring the retainer renewal up last.</p>
    </div>
  );
}

function VaultMock() {
  const [left, setLeft] = useState(30 - (Math.floor(Date.now() / 1000) % 30));
  useEffect(() => {
    const t = setInterval(() => setLeft(30 - (Math.floor(Date.now() / 1000) % 30)), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="tm">
      <div className="tm-head">
        <strong>
          <KeyRound size={14} /> KopiKita Meta Business
        </strong>
        <Chip>Design team</Chip>
      </div>
      <div className="tm-field">
        <small>Email</small>
        <span>ads@kopikita.co.id</span>
      </div>
      <div className="tm-field">
        <small>Password</small>
        <span>•••••••••••• </span>
        <em>Reveal · logged</em>
      </div>
      <div className="tm-field">
        <small>2FA code</small>
        <span className="tm-code">
          {left > 15 ? '482 913' : '106 274'}
          <svg viewBox="0 0 20 20" className="tm-ring">
            <circle cx="10" cy="10" r="8" />
            <circle cx="10" cy="10" r="8" style={{ strokeDashoffset: 50.3 * (1 - left / 30) }} />
          </svg>
        </span>
      </div>
    </div>
  );
}

export const TOUR: { id: string; icon: LucideIcon; name: string; title: string; points: string[]; mock: () => ReactNode }[] = [
  { id: 'mail', icon: Mail, name: 'Mail', title: 'Email that sorts itself by project', points: ['Shared inboxes for hello@ and finance@', 'Snooze, send later, and who’s on it', 'To-dos pulled from the emails that matter'], mock: MailMock },
  { id: 'chat', icon: MessagesSquare, name: 'Chat', title: 'Channels per project, guests included', points: ['Shared channels with clients and partners', 'Threads, voice notes, kudos', 'A shelf for the links and files people keep asking for'], mock: ChatMock },
  { id: 'tasks', icon: CheckSquare, name: 'Tasks', title: 'Work that moves on its own', points: ['By person, team or project', 'Approvals from guests, right on the task', 'Checklists, repeats and briefs'], mock: TasksMock },
  { id: 'calendar', icon: Calendar, name: 'Calendar', title: 'Your day, with your tasks in it', points: ['Drag to move, stretch to resize', 'Drop a task in to block time for it', 'Every calendar you use, in one view'], mock: CalendarMock },
  { id: 'meet', icon: Video, name: 'Meet', title: 'Meetings that turn into work', points: ['Notes, decisions and action items', 'Filed under the right project', 'Shared with guests only if you want'], mock: MeetMock },
  { id: 'drive', icon: FolderOpen, name: 'Drive', title: 'Files where the project is', points: ['A folder per project, automatically', 'What guests can see is always marked', 'Your own cloud for the big files'], mock: DriveMock },
  { id: 'notes', icon: NotebookPen, name: 'Notes', title: 'Notes that become tasks', points: ['Private, or for the whole team', 'Link a note to a project', 'Select a line, make it a task'], mock: NotesMock },
  { id: 'vault', icon: KeyRound, name: 'Vault', title: 'Shared logins without the spreadsheet', points: ['Passwords and 2FA codes for chosen people', 'Every reveal is logged', 'Encrypted, revealed one at a time'], mock: VaultMock },
];

const STEP = 6000;

/** The product tour: a tab per app, auto-advancing with a progress bar until someone picks one. */
export function Tour() {
  const [cur, setCur] = useState(0);
  const [auto, setAuto] = useState(true);
  const [paused, setPaused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.3 });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!auto || paused || !visible || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setTimeout(() => setCur((c) => (c + 1) % TOUR.length), STEP);
    return () => clearTimeout(t);
  }, [cur, auto, paused, visible]);
  const item = TOUR[cur];
  const Mock = item.mock;
  return (
    <div className="tour rv" ref={ref} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="tour-tabs" role="tablist" aria-label="Apps">
        {TOUR.map((t, i) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={i === cur}
            className={i === cur ? 'on' : ''}
            onClick={() => (setCur(i), setAuto(false))}
          >
            <t.icon size={17} />
            <span>{t.name}</span>
            {i === cur && auto && <i className={`tour-bar ${paused || !visible ? 'paused' : ''}`} style={{ animationDuration: `${STEP}ms` }} key={cur} />}
          </button>
        ))}
      </div>
      <div className="tour-stage" key={item.id}>
        <div className="tour-copy">
          <h3>{item.title}</h3>
          <ul>
            {item.points.map((p) => (
              <li key={p}>
                <Check size={15} /> {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="tour-mock">
          <Mock />
        </div>
      </div>
    </div>
  );
}
