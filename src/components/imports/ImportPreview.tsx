import { useState } from 'react';
import { ChevronRight, Hash, Lock, MessageCircle, Users } from 'lucide-react';
import type { ImportChoices, ImportPerson, ImportPreview } from '../../importTypes';
import { DRIVE_FOLDER } from '../../importTypes';
import type { TaskStage, User } from '../../types';
import { stageName, toneOf } from '../../stages';
import { term } from '../../terms';
import { fmtSize } from '../../data/drive';
import { Avatar } from '../Avatar';
import { Badge, PersonCell } from '../ui/Person';
import { Select, type Option } from '../ui/Select';
import { num } from './importWords';
import { t, tn } from '../../i18n';
import { fmtList } from '../../i18n/format';

interface Props {
  preview: ImportPreview;
  choices: ImportChoices;
  onChoices: (c: ImportChoices) => void;
  members: User[];
  stages: TaskStage[];
  projects: { id: string; name: string; color: string }[];
}

/** People the export would invite (for Free's limit). */
export const invitesIn = (p: ImportPreview, c: ImportChoices) => p.people.filter((x) => c.people[x.key]?.action === 'invite').length;
/** What the files to save take (Drive), with or without the big ones. */
export const driveNeed = (p: ImportPreview, c: ImportChoices) => (p.drive ? p.drive.bytes - (c.big ? 0 : p.drive.bigBytes) : 0);

/** Why Start can't be pressed yet, or null. */
export function blocker(p: ImportPreview, c: ImportChoices): string | null {
  if (p.seatsLeft !== null && invitesIn(p, c) > p.seatsLeft)
    return p.seatsLeft === 0
      ? t('Free covers 5 people, so nobody else can join. Keep the others as names or match them to people here, or pick a plan in Plan & billing.')
      : t('Free covers 5 people, so only {n} more can join. Keep the others as names or match them to people here, or pick a plan in Plan & billing.', { n: num(p.seatsLeft) });
  if (p.channels && p.channels.length && (c.leaveOut ?? []).length >= p.channels.length) return t('Turn on at least one channel.');
  if (p.mail && !c.mailbox) return t('Pick the mailbox the mail goes into.');
  if (p.drive && driveNeed(p, c) > p.room.left) {
    const sizes = { need: fmtSize(driveNeed(p, c)), left: fmtSize(p.room.left) };
    return p.drive.big && c.big
      ? t('These files take {need} and the company has {left} left. Leave the big files out, or an owner can add storage in Plan & billing.', sizes)
      : t('These files take {need} and the company has {left} left. An owner can add storage in Plan & billing.', sizes);
  }
  return null;
}

/** The preview step: what an import would make, and the choices it needs before it starts. */
export function ImportPreviewStep({ preview: p, choices: c, onChoices, members, stages, projects }: Props) {
  const set = (patch: Partial<ImportChoices>) => onChoices({ ...c, ...patch });
  const askOver = p.room.askOverMb;
  return (
    <div className="imp-preview">
      {p.source === 'slack' && <SlackPart p={p} c={c} set={set} />}
      {p.source === 'trello' && <TrelloPart p={p} c={c} set={set} stages={stages} projects={projects} />}
      {p.source === 'mail' && p.mail && <MailPart p={p} c={c} set={set} />}
      {p.source === 'drive' && p.drive && (
        <section className="imp-sec">
          <h4>{t('Into Drive')}</h4>
          <p className="imp-line">{driveLine(p.drive)}</p>
          <Room need={driveNeed(p, c)} left={p.room.left} total={p.room.total} />
          {p.drive.otherParts.length > 0 && <p className="imp-note">{t('This Takeout also has {parts}. Only Drive comes over.', { parts: fmtList(p.drive.otherParts) })}</p>}
        </section>
      )}
      {((p.files && p.files.big > 0) || (p.drive && p.drive.big > 0)) && (
        <BigFiles n={p.files?.big ?? p.drive!.big} bytes={p.files?.bigBytes ?? p.drive!.bigBytes} askOver={askOver} on={!!c.big} onChange={(big) => set({ big })} />
      )}
      {p.people.length > 0 && <People p={p} c={c} set={set} members={members} />}
    </div>
  );
}

/** "12 files in 3 folders, 40 MB in all, go into a new folder called Google Drive import." */
function driveLine(d: NonNullable<ImportPreview['drive']>): string {
  const vars = { files: tn(d.files, '{n} file', '{n} files'), folders: tn(d.folders, '{n} folder', '{n} folders'), size: fmtSize(d.bytes), folder: DRIVE_FOLDER };
  if (d.into === 'existing')
    return d.folders
      ? t('{files} in {folders}, {size} in all, go into the {folder} folder that’s already in Drive.', vars)
      : t('{files}, {size} in all, go into the {folder} folder that’s already in Drive.', vars);
  return d.folders ? t('{files} in {folders}, {size} in all, go into a new folder called {folder}.', vars) : t('{files}, {size} in all, go into a new folder called {folder}.', vars);
}

function SlackPart({ p, c, set }: { p: ImportPreview; c: ImportChoices; set: (x: Partial<ImportChoices>) => void }) {
  const out = new Set(c.leaveOut ?? []);
  const toggle = (key: string) => set({ leaveOut: out.has(key) ? [...out].filter((k) => k !== key) : [...out, key] });
  const channels = p.channels ?? [];
  const f = p.files;
  return (
    <>
      <section className="imp-sec">
        <h4>{t('Channels')}</h4>
        <p className="imp-line muted">{t('Turn off any you don’t need. A channel with the same name as one here adds its history to that one.')}</p>
        <div className="imp-list" role="list">
          {channels.map((ch) => {
            const on = !out.has(ch.key);
            const Icon = ch.kind === 'dm' ? MessageCircle : ch.kind === 'group' ? Users : ch.kind === 'private' ? Lock : Hash;
            return (
              <div key={ch.key} role="listitem" className={`imp-row ${on ? '' : 'off'}`}>
                <span className="imp-row-icon">
                  <Icon size={15} />
                </span>
                <span className="imp-row-text">
                  <strong>{ch.name}</strong>
                  <small>
                    {[ch.kind === 'dm' ? t('Direct messages') : ch.kind === 'group' ? t('Group messages') : '', tn(ch.messages, '{n} message', '{n} messages'), ch.into ? t('into your #{channel}', { channel: ch.name }) : '']
                      .filter(Boolean)
                      .join(', ')}
                  </small>
                </span>
                {ch.archived && <Badge small>{t('Archived')}</Badge>}
                <button type="button" role="switch" aria-checked={on} aria-label={t('Bring in {name}', { name: ch.name })} className={`switch ${on ? 'on' : ''}`} onClick={() => toggle(ch.key)}>
                  <span />
                </button>
              </div>
            );
          })}
        </div>
        {p.oldMessages && (
          <p className="imp-note warn">
            {t('This company deletes chat messages older than {period}, so {n} of these would go on its next daily clean-up. To keep them, change it in Settings, Apps & chat first.', {
              period: t(p.oldMessages.period),
              n: num(p.oldMessages.n),
            })}
          </p>
        )}
      </section>
      {f && (f.linked > 0 || f.notInExport > 0) && (
        <section className="imp-sec">
          <h4>{t('Files')}</h4>
          {f.linked > 0 && (
            <p className="imp-line">
              {tn(f.linked, '{n} file ({size}) is fetched from Slack while its links still work.', '{n} files ({size}) are fetched from Slack while its links still work.', { size: fmtSize(f.bytes) })}
              {f.bytes > p.room.left ? ` ${t('The company has {left} left, so what doesn’t fit stays out and is listed at the end.', { left: fmtSize(p.room.left) })}` : ''}
            </p>
          )}
          {f.notInExport > 0 && <p className="imp-line muted">{tn(f.notInExport, '{n} file isn’t in the export. Its name stays on the messages.', '{n} files aren’t in the export. Their names stay on the messages.')}</p>}
        </section>
      )}
    </>
  );
}

function TrelloPart({ p, c, set, stages, projects }: { p: ImportPreview; c: ImportChoices; set: (x: Partial<ImportChoices>) => void; stages: TaskStage[]; projects: Props['projects'] }) {
  const b = p.board!;
  const lists = (p.lists ?? []).filter((l) => !l.archived || c.archived);
  const projectOptions: Option[] = [
    { value: '', label: t('New {project}: {name}', { project: term.one, name: b.name }), hint: t('Made for this board') },
    ...projects.map((x) => ({ value: x.id, label: x.name, icon: <span className="sel-dot" style={{ background: x.color }} />, group: t('Your {projects}', { projects: term.many }) })),
  ];
  const stageOptions: Option[] = stages.map((s) => ({ value: s.id, label: stageName(s), icon: <span className={`stage-dot k-${s.kind} tone-${toneOf(s)}`} /> }));
  return (
    <>
      <section className="imp-sec">
        <h4>{t('Into')}</h4>
        <Select
          value={c.projectId ?? ''}
          options={projectOptions}
          onChange={(v) => set({ projectId: v })}
          label={t('Which {project} the cards go into', { project: term.one })}
          searchable={projects.length > 6}
          width={320}
          className="imp-field"
        />
        <p className="imp-line muted">
          {b.comments
            ? tn(b.cards, '{n} card becomes a task, with {comments}.', '{n} cards become tasks, with {comments}.', { comments: tn(b.comments, '{n} comment', '{n} comments') })
            : tn(b.cards, '{n} card becomes a task.', '{n} cards become tasks.')}
        </p>
      </section>
      <section className="imp-sec">
        <h4>{t('Lists')}</h4>
        <p className="imp-line muted">{t('Each list’s cards go to one of your task stages.')}</p>
        <div className="imp-list" role="list">
          {lists.map((l) => (
            <div key={l.key} role="listitem" className="imp-row imp-map">
              <span className="imp-row-text">
                <strong>{l.name}</strong>
                <small>{l.archived ? tn(l.cards, '{n} card, archived', '{n} cards, archived') : tn(l.cards, '{n} card', '{n} cards')}</small>
              </span>
              <ChevronRight size={15} className="imp-arrow" aria-hidden />
              <Select
                value={c.stages?.[l.key] ?? l.suggested}
                options={stageOptions}
                onChange={(v) => set({ stages: { ...(c.stages ?? {}), [l.key]: v } })}
                label={t('Stage for {list}', { list: l.name })}
                width={220}
                className="imp-field"
              />
            </div>
          ))}
        </div>
      </section>
      {b.archivedCards > 0 && (
        <label className="imp-toggle">
          <span>
            <strong>{t('Bring archived cards too')}</strong>
            <small>{tn(b.archivedCards, '{n} archived card stays out unless you turn this on.', '{n} archived cards stay out unless you turn this on.')}</small>
          </span>
          <button type="button" role="switch" aria-checked={!!c.archived} className={`switch ${c.archived ? 'on' : ''}`} onClick={() => set({ archived: !c.archived })}>
            <span />
          </button>
        </label>
      )}
    </>
  );
}

/** "Ask before saving big files": the files over the company's size, and whether they come in. */
function BigFiles({ n, bytes, askOver, on, onChange }: { n: number; bytes: number; askOver: number; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <section className="imp-sec">
      <h4>{t('Big files')}</h4>
      <p className="imp-line">
        {tn(n, '{n} file is over {size}, {total} in all. Your company asks before saving files that big.', '{n} files are over {size}, {total} in all. Your company asks before saving files that big.', {
          size: askOver >= 1 ? `${num(askOver)} MB` : fmtSize(askOver * 1024 * 1024),
          total: fmtSize(bytes),
        })}
      </p>
      <div className="segmented imp-seg" role="group" aria-label={t('Big files')}>
        <button type="button" className={on ? '' : 'on'} aria-pressed={!on} onClick={() => onChange(false)}>
          {t('Leave them out')}
        </button>
        <button type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => onChange(true)}>
          {t('Bring them in')}
        </button>
      </div>
    </section>
  );
}

/** The company's storage, and what this import would take of it. */
function Room({ need, left, total }: { need: number; left: number; total: number }) {
  if (!total) return null;
  const used = total - left;
  const pct = (x: number) => `${Math.min(100, Math.max(0.5, (x / total) * 100))}%`;
  const fits = need <= left;
  return (
    <div className="imp-room">
      <div className="bf-meter" aria-hidden="true">
        <span className="bf-used" style={{ width: used > 0 ? pct(used) : 0 }} />
        <span className={`bf-this ${fits ? '' : 'over'}`} style={{ width: pct(Math.min(need, left)) }} />
      </div>
      <p className={`imp-line ${fits ? 'muted' : 'warn-text'}`}>
        {fits
          ? `${t('The company has {left} free of {total}, shared by everyone.', { left: fmtSize(left), total: fmtSize(total) })}${need / Math.max(1, left) >= 0.05 ? ` ${t('This leaves {rest}.', { rest: fmtSize(left - need) })}` : ''}`
          : t('It doesn’t fit: the company has {left} free of {total}.', { left: fmtSize(left), total: fmtSize(total) })}
      </p>
    </div>
  );
}

const valueOf = (p: ImportPerson, c: ImportChoices) => {
  const x = c.people[p.key];
  if (!x) return p.match ? `map:${p.match}` : p.suggested;
  return x.action === 'map' ? `map:${x.userId ?? p.match}` : x.action;
};

/** People from the other app: matched to people here, or a choice each (invite, the same as someone here, a name). */
function People({ p, c, set, members }: { p: ImportPreview; c: ImportChoices; set: (x: Partial<ImportChoices>) => void; members: User[] }) {
  const [showMatched, setShowMatched] = useState(false);
  const open = p.people.filter((x) => !x.match);
  const matched = p.people.filter((x) => x.match);
  const from = p.source === 'slack' ? 'Slack' : 'Trello';
  const pick = (person: ImportPerson, v: string) => set({ people: { ...c.people, [person.key]: v.startsWith('map:') ? { action: 'map', userId: v.slice(4) } : { action: v as 'invite' | 'former' } } });
  const all = (action: 'invite' | 'former') => set({ people: { ...c.people, ...Object.fromEntries(open.filter((x) => action === 'former' || x.canInvite).map((x) => [x.key, { action }])) } });
  const options = (person: ImportPerson): Option[] => [
    ...(person.canInvite ? [{ value: 'invite', label: t('Invite them'), hint: t('Joins as a member; you get their invite link'), group: t('Them') }] : []),
    { value: 'former', label: t('Keep as a former member'), hint: t('Their name stays on what they wrote'), group: t('Them') },
    ...members.map((u) => ({ value: `map:${u.id}`, label: u.name, hint: u.email, icon: <Avatar person={u} size={20} />, group: t('Same person as'), keywords: u.email })),
  ];
  const row = (person: ImportPerson) => {
    const v = valueOf(person, c);
    const mapped = v.startsWith('map:') ? members.find((u) => u.id === v.slice(4)) : undefined;
    return (
      <div key={person.key} role="listitem" className="imp-row imp-person">
        <PersonCell
          person={{ name: person.name, email: person.email }}
          sub={person.email ?? t('No email in {app}', { app: from })}
          badges={
            person.gone ? (
              <Badge small>{t('Deactivated')}</Badge>
            ) : person.how === 'name' ? (
              <Badge small tone="info">
                {t('Same name')}
              </Badge>
            ) : null
          }
          size={28}
        />
        <Select
          value={v}
          options={options(person)}
          onChange={(x) => pick(person, x)}
          label={t('What happens to {name}', { name: person.name })}
          title={person.name}
          searchable={members.length > 6}
          width={280}
          className="imp-field"
          renderValue={(o) =>
            mapped ? (
              <span className="imp-mapped">
                <Avatar person={mapped} size={18} /> {mapped.name}
              </span>
            ) : (
              o?.label
            )
          }
        />
      </div>
    );
  };
  const inviting = invitesIn(p, c);
  return (
    <section className="imp-sec">
      <h4>{t('People')}</h4>
      {open.length > 0 ? (
        <p className="imp-line muted">
          {open.length === 1 ? t('One person isn’t here yet. Pick what happens to them.') : t('{n} people aren’t here yet. Pick what happens to each.', { n: num(open.length) })}
          {inviting ? ` ${tn(inviting, 'You get an invite link to send; nothing is emailed.', 'You get invite links to send; nothing is emailed.')}` : ''}
        </p>
      ) : (
        <p className="imp-line muted">{t('Everyone is matched to someone here.')}</p>
      )}
      {open.length > 3 && (
        <div className="imp-bulk">
          {open.some((x) => x.canInvite) && (
            <button type="button" className="link-btn small" onClick={() => all('invite')}>
              {t('Invite everyone with an email')}
            </button>
          )}
          <button type="button" className="link-btn small" onClick={() => all('former')}>
            {t('Keep them all as names')}
          </button>
        </div>
      )}
      {open.length > 0 && (
        <div className="imp-list" role="list">
          {open.map(row)}
        </div>
      )}
      {matched.length > 0 && (
        <>
          <button type="button" className="imp-fold-btn" aria-expanded={showMatched} onClick={() => setShowMatched((x) => !x)}>
            <ChevronRight size={14} className={`rot-chev ${showMatched ? 'open' : ''}`} />
            {matched.length === 1 ? t('{name} is matched to people here', { name: matched[0].name }) : t('{n} people are matched to people here', { n: num(matched.length) })}
          </button>
          <div className={`fold ${showMatched ? 'open' : ''}`}>
            <div className="fold-in">
              <div className="imp-list" role="list">
                {matched.map(row)}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/** Mail: how much there is, and the mailbox it goes into (the one it was addressed to, picked to start with). */
function MailPart({ p, c, set }: { p: ImportPreview; c: ImportChoices; set: (x: Partial<ImportChoices>) => void }) {
  const m = p.mail!;
  const options: Option[] = m.mailboxes.map((b) => ({ value: b.id, label: b.email, hint: b.shared ? t('Shared inbox') : b.name, keywords: b.name }));
  return (
    <section className="imp-sec">
      <h4>{t('Into a mailbox')}</h4>
      <p className="imp-line">{t('{emails}, {size} in all.', { emails: tn(m.messages, '{n} email', '{n} emails'), size: fmtSize(m.bytes) })}</p>
      <div className="imp-mailbox">
        <Select value={c.mailbox} options={options} onChange={(mailbox) => set({ mailbox })} label={t('Mailbox')} title={t('Mailbox')} placeholder={t('Pick a mailbox')} searchable={options.length > 8} width={320} />
      </div>
      <Room need={m.bytes} left={p.room.left} total={p.room.total} />
      {m.tooBig > 0 && <p className="imp-note">{tn(m.tooBig, '1 email is over 30 MB and stays out.', '{n} emails are over 30 MB and stay out.')}</p>}
      {m.otherParts.length > 0 && <p className="imp-note">{t('This Takeout also has {parts}. Only Mail comes over.', { parts: fmtList(m.otherParts) })}</p>}
    </section>
  );
}
