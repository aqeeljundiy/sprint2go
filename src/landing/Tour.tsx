import { useState, type ReactNode } from 'react';
import { Calendar, Check, CheckSquare, Eye, FileText, FolderOpen, KeyRound, Mail, MessagesSquare, Mic, NotebookPen, Paperclip, Sparkles, Video, type LucideIcon } from 'lucide-react';
import { useT, type Dict } from './i18n';

/* Small, still previews for the tour, built from the app's own look. */

const Chip = ({ children, tone }: { children: ReactNode; tone?: 'blue' | 'amber' | 'green' | 'pink' }) => <span className={`tc ${tone ?? ''}`}>{children}</span>;

function MailMock({ m }: { m: Dict['tm'] }) {
  const chips = [<Chip tone="amber">Kopinara</Chip>, <Chip tone="pink">Selara Skin</Chip>, <Chip>{m.newLead}</Chip>];
  return (
    <div className="tm">
      <div className="tm-head">
        <strong>{m.inbox}</strong>
        <span className="tm-seg">
          <span className="on">{m.needsReply}</span>
          <span>{m.everything}</span>
        </span>
      </div>
      {m.mails.map(([from, subj, snip], i) => (
        <div key={from} className="tm-mail">
          <span className="tm-av">{from.charAt(0)}</span>
          <span className="tm-mtxt">
            <span className="tm-mrow">
              <b>{from}</b> {chips[i]}
            </span>
            <small>
              <strong>{subj}</strong> · {snip}
            </small>
          </span>
        </div>
      ))}
      <div className="tm-found">
        <Sparkles size={13} /> {m.found} <b>{m.foundTask}</b>, {m.foundDue} <span className="tm-add">{m.add}</span>
      </div>
    </div>
  );
}

function ChatMock({ m }: { m: Dict['tm'] }) {
  return (
    <div className="tm">
      <div className="tm-head">
        <strong># kopinara-x-studio</strong>
        <Chip tone="green">{m.guestsSee}</Chip>
      </div>
      <div className="tm-msg">
        <span className="tm-av" style={{ background: '#b45309' }}>L</span>
        <span>
          <b>
            Laras Anindita <em className="tm-guest">{m.guestTag}</em>
          </b>
          <p>{m.msg1}</p>
        </span>
      </div>
      <div className="tm-msg">
        <span className="tm-av" style={{ background: '#5b5bf6' }}>R</span>
        <span>
          <b>Raka</b>
          <span className="tm-voice">
            <Mic size={12} />
            {[6, 11, 8, 14, 9, 12, 5, 10].map((h, i) => (
              <i key={i} style={{ height: h }} />
            ))}
            <small>0:14</small>
          </span>
        </span>
      </div>
      <div className="tm-msg">
        <span className="tm-av" style={{ background: '#f97316' }}>J</span>
        <span>
          <b>Joko</b>
          <p>
            {m.msg3} <Paperclip size={11} /> <u>Kopinara_ritual_15s.mp4</u>
          </p>
        </span>
      </div>
    </div>
  );
}

function TasksMock({ m }: { m: Dict['tm'] }) {
  const cols: [string, [string, ReactNode?][]][] = [
    [m.cols[0], [[m.cards[0]], [m.cards[1], <Chip tone="pink">Selara</Chip>]]],
    [m.cols[1], [[m.cards[2], <Chip tone="amber">Kopinara</Chip>]]],
    [m.cols[2], [[m.cards[3], <Chip tone="blue">{m.approve}</Chip>]]],
  ];
  return (
    <div className="tm">
      <div className="tm-board">
        {cols.map(([name, cards]) => (
          <div key={name} className="tm-col">
            <small>{name}</small>
            {cards.map(([t, chip]) => (
              <div key={t} className="tm-card">
                <span>{t}</span>
                {chip}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="tm-found">
        <Check size={13} /> {m.approved} <b>{m.cards[2]}</b>. {m.moved}
      </div>
    </div>
  );
}

function CalendarMock({ m }: { m: Dict['tm'] }) {
  return (
    <div className="tm tm-cal">
      <div className="tm-head">
        <strong>{m.calDay}</strong>
        <small>{m.calHint}</small>
      </div>
      <div className="tm-day">
        {['9', '10', '11', '12', '13', '14'].map((h) => (
          <span key={h} className="tm-hr">
            {h}:00
          </span>
        ))}
        <span className="tm-ev a" style={{ top: '4%', height: '14%' }}>
          {m.standup}
        </span>
        <span className="tm-ev b" style={{ top: '52%', height: '22%' }}>
          {m.review}
        </span>
        <span className="tm-ev c">
          <CheckSquare size={11} /> {m.cards[0]}
        </span>
      </div>
    </div>
  );
}

function MeetMock({ m }: { m: Dict['tm'] }) {
  return (
    <div className="tm">
      <div className="tm-head">
        <strong>{m.meetH}</strong>
        <small>{m.meetMeta}</small>
      </div>
      <p className="tm-sum">{m.meetSum}</p>
      <small className="tm-label">{m.decisions}</small>
      <div className="tm-li">
        <Check size={12} /> {m.decision}
      </div>
      <small className="tm-label">{m.actions}</small>
      {m.acts.map((t, i) => (
        <div key={t} className="tm-li task">
          <CheckSquare size={12} /> {t}
          <span className="tm-av sm" style={{ background: i ? '#d946ef' : '#f59e0b' }}>
            {i ? 'S' : 'F'}
          </span>
        </div>
      ))}
    </div>
  );
}

function DriveMock({ m }: { m: Dict['tm'] }) {
  const files: [string, string, boolean][] = [
    ['Kopinara_ritual_15s.mp4', '48 MB', true],
    ['Q4 concepts.pdf', '6.4 MB', true],
    ['Retainer contract 2026.pdf', '220 KB', false],
  ];
  return (
    <div className="tm">
      <div className="tm-head">
        <strong>
          <FolderOpen size={14} /> Kopinara
        </strong>
        <small>{m.driveHint}</small>
      </div>
      {files.map(([n, s, shared]) => (
        <div key={n} className="tm-file">
          <FileText size={15} />
          <span>{n}</span>
          <small>{s}</small>
          <span className={`tm-eye ${shared ? 'on' : ''}`}>
            <Eye size={12} /> {shared ? m.shared : m.teamOnly}
          </span>
        </div>
      ))}
    </div>
  );
}

function NotesMock({ m }: { m: Dict['tm'] }) {
  return (
    <div className="tm">
      <div className="tm-head">
        <strong>{m.noteH}</strong>
        <small>{m.noteMeta}</small>
      </div>
      <p className="tm-note">{m.note1}</p>
      <p className="tm-note">
        <mark>{m.note2}</mark>
        <span className="tm-pop">
          <CheckSquare size={12} /> {m.makeTask}
        </span>
      </p>
      <p className="tm-note muted">{m.note3}</p>
    </div>
  );
}

function VaultMock({ m }: { m: Dict['tm'] }) {
  return (
    <div className="tm">
      <div className="tm-head">
        <strong>
          <KeyRound size={14} /> Kopinara Meta Business
        </strong>
        <Chip>{m.designTeam}</Chip>
      </div>
      <div className="tm-field">
        <small>{m.email}</small>
        <span>ads@kopinara.example</span>
      </div>
      <div className="tm-field">
        <small>{m.password}</small>
        <span>••••••••••••</span>
        <em>{m.reveal}</em>
      </div>
      <div className="tm-field">
        <small>{m.code}</small>
        <span className="tm-code">
          482 913
          <svg viewBox="0 0 20 20" className="tm-ring">
            <circle cx="10" cy="10" r="8" />
            <circle cx="10" cy="10" r="8" style={{ strokeDashoffset: 18 }} />
          </svg>
        </span>
      </div>
    </div>
  );
}

const TOUR: { id: string; icon: LucideIcon; Mock: (p: { m: Dict['tm'] }) => ReactNode }[] = [
  { id: 'mail', icon: Mail, Mock: MailMock },
  { id: 'chat', icon: MessagesSquare, Mock: ChatMock },
  { id: 'tasks', icon: CheckSquare, Mock: TasksMock },
  { id: 'calendar', icon: Calendar, Mock: CalendarMock },
  { id: 'meet', icon: Video, Mock: MeetMock },
  { id: 'drive', icon: FolderOpen, Mock: DriveMock },
  { id: 'notes', icon: NotebookPen, Mock: NotesMock },
  { id: 'vault', icon: KeyRound, Mock: VaultMock },
];

/**
 * The product tour: a tab per app. Every panel sits in the same grid cell, so the section keeps one height
 * (the tallest panel) and switching tabs only cross-fades. Nothing moves on its own.
 */
export function Tour() {
  const { t } = useT();
  const [cur, setCur] = useState(0);
  return (
    <div className="tour rv">
      <div className="tour-tabs" role="tablist" aria-label="Apps">
        {TOUR.map((x, i) => (
          <button key={x.id} role="tab" aria-selected={i === cur} className={i === cur ? 'on' : ''} onClick={() => setCur(i)}>
            <x.icon size={17} />
            <span>{t.tour[x.id].name}</span>
          </button>
        ))}
      </div>
      <div className="tour-stack">
        {TOUR.map(({ id, Mock }, i) => (
          <div key={id} className={`tour-stage ${i === cur ? 'on' : ''}`} role="tabpanel" aria-hidden={i !== cur}>
            <div className="tour-copy">
              <h3>{t.tour[id].title}</h3>
              <ul>
                {t.tour[id].points.map((p) => (
                  <li key={p}>
                    <Check size={15} /> {p}
                  </li>
                ))}
              </ul>
            </div>
            <div className="tour-mock">
              <Mock m={t.tm} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
