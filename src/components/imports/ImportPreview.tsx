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
    return `Free covers 5 people, so ${p.seatsLeft === 0 ? 'nobody else' : `only ${p.seatsLeft} more`} can join. Keep the others as names or match them to people here, or pick a plan in Plan & billing.`;
  if (p.channels && p.channels.length && (c.leaveOut ?? []).length >= p.channels.length) return 'Turn on at least one channel.';
  if (p.drive && driveNeed(p, c) > p.room.left)
    return `These files take ${fmtSize(driveNeed(p, c))} and the company has ${fmtSize(p.room.left)} left.${p.drive.big && c.big ? ' Leave the big files out, or a' : ' A'}n owner can add storage in Plan & billing.`;
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
      {p.source === 'drive' && p.drive && (
        <section className="imp-sec">
          <h4>Into Drive</h4>
          <p className="imp-line">
            {num(p.drive.files)} file{p.drive.files === 1 ? '' : 's'}
            {p.drive.folders ? ` in ${num(p.drive.folders)} folder${p.drive.folders === 1 ? '' : 's'}` : ''}, {fmtSize(p.drive.bytes)} in all, go into{' '}
            {p.drive.into === 'existing' ? `the ${DRIVE_FOLDER} folder that’s already in Drive` : `a new folder called ${DRIVE_FOLDER}`}.
          </p>
          <Room need={driveNeed(p, c)} left={p.room.left} total={p.room.total} />
          {p.drive.otherParts.length > 0 && <p className="imp-note">This Takeout also has {p.drive.otherParts.join(', ')}. Only Drive comes over.</p>}
        </section>
      )}
      {((p.files && p.files.big > 0) || (p.drive && p.drive.big > 0)) && (
        <BigFiles n={p.files?.big ?? p.drive!.big} bytes={p.files?.bigBytes ?? p.drive!.bigBytes} askOver={askOver} on={!!c.big} onChange={(big) => set({ big })} />
      )}
      {p.people.length > 0 && <People p={p} c={c} set={set} members={members} />}
    </div>
  );
}

function SlackPart({ p, c, set }: { p: ImportPreview; c: ImportChoices; set: (x: Partial<ImportChoices>) => void }) {
  const out = new Set(c.leaveOut ?? []);
  const toggle = (key: string) => set({ leaveOut: out.has(key) ? [...out].filter((k) => k !== key) : [...out, key] });
  const channels = p.channels ?? [];
  const f = p.files;
  return (
    <>
      <section className="imp-sec">
        <h4>Channels</h4>
        <p className="imp-line muted">Turn off any you don’t need. A channel with the same name as one here adds its history to that one.</p>
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
                    {ch.kind === 'dm' ? 'Direct messages, ' : ch.kind === 'group' ? 'Group messages, ' : ''}
                    {num(ch.messages)} message{ch.messages === 1 ? '' : 's'}
                    {ch.into ? `, into your #${ch.name}` : ''}
                  </small>
                </span>
                {ch.archived && <Badge small>Archived</Badge>}
                <button type="button" role="switch" aria-checked={on} aria-label={`Bring in ${ch.name}`} className={`switch ${on ? 'on' : ''}`} onClick={() => toggle(ch.key)}>
                  <span />
                </button>
              </div>
            );
          })}
        </div>
        {p.oldMessages && (
          <p className="imp-note warn">
            This company deletes chat messages older than {p.oldMessages.period}, so {num(p.oldMessages.n)} of these would go on its next daily clean-up. To keep them, change it in Settings, Apps &amp; chat first.
          </p>
        )}
      </section>
      {f && (f.linked > 0 || f.notInExport > 0) && (
        <section className="imp-sec">
          <h4>Files</h4>
          {f.linked > 0 && (
            <p className="imp-line">
              {num(f.linked)} file{f.linked === 1 ? '' : 's'} ({fmtSize(f.bytes)}) are fetched from Slack while its links still work.
              {f.bytes > p.room.left ? ` The company has ${fmtSize(p.room.left)} left, so what doesn’t fit stays out and is listed at the end.` : ''}
            </p>
          )}
          {f.notInExport > 0 && (
            <p className="imp-line muted">
              {num(f.notInExport)} file{f.notInExport === 1 ? ' isn’t' : 's aren’t'} in the export. {f.notInExport === 1 ? 'Its name stays' : 'Their names stay'} on the messages.
            </p>
          )}
        </section>
      )}
    </>
  );
}

function TrelloPart({ p, c, set, stages, projects }: { p: ImportPreview; c: ImportChoices; set: (x: Partial<ImportChoices>) => void; stages: TaskStage[]; projects: Props['projects'] }) {
  const b = p.board!;
  const lists = (p.lists ?? []).filter((l) => !l.archived || c.archived);
  const projectOptions: Option[] = [
    { value: '', label: `New ${term.one}: ${b.name}`, hint: 'Made for this board' },
    ...projects.map((x) => ({ value: x.id, label: x.name, icon: <span className="sel-dot" style={{ background: x.color }} />, group: `Your ${term.many}` })),
  ];
  const stageOptions: Option[] = stages.map((s) => ({ value: s.id, label: stageName(s), icon: <span className={`stage-dot k-${s.kind} tone-${toneOf(s)}`} /> }));
  return (
    <>
      <section className="imp-sec">
        <h4>Into</h4>
        <Select
          value={c.projectId ?? ''}
          options={projectOptions}
          onChange={(v) => set({ projectId: v })}
          label={`Which ${term.one} the cards go into`}
          searchable={projects.length > 6}
          width={320}
          className="imp-field"
        />
        <p className="imp-line muted">
          {num(b.cards)} card{b.cards === 1 ? '' : 's'} become{b.cards === 1 ? 's a task' : ' tasks'}
          {b.comments ? `, with ${num(b.comments)} comment${b.comments === 1 ? '' : 's'}` : ''}.
        </p>
      </section>
      <section className="imp-sec">
        <h4>Lists</h4>
        <p className="imp-line muted">Each list’s cards go to one of your task stages.</p>
        <div className="imp-list" role="list">
          {lists.map((l) => (
            <div key={l.key} role="listitem" className="imp-row imp-map">
              <span className="imp-row-text">
                <strong>{l.name}</strong>
                <small>
                  {num(l.cards)} card{l.cards === 1 ? '' : 's'}
                  {l.archived ? ', archived' : ''}
                </small>
              </span>
              <ChevronRight size={15} className="imp-arrow" aria-hidden />
              <Select
                value={c.stages?.[l.key] ?? l.suggested}
                options={stageOptions}
                onChange={(v) => set({ stages: { ...(c.stages ?? {}), [l.key]: v } })}
                label={`Stage for ${l.name}`}
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
            <strong>Bring archived cards too</strong>
            <small>
              {num(b.archivedCards)} archived card{b.archivedCards === 1 ? '' : 's'} stay out unless you turn this on.
            </small>
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
      <h4>Big files</h4>
      <p className="imp-line">
        {num(n)} file{n === 1 ? ' is' : 's are'} over {askOver >= 1 ? `${num(askOver)} MB` : fmtSize(askOver * 1024 * 1024)}, {fmtSize(bytes)} in all. Your company asks before saving files that big.
      </p>
      <div className="segmented imp-seg" role="group" aria-label="Big files">
        <button type="button" className={on ? '' : 'on'} aria-pressed={!on} onClick={() => onChange(false)}>
          Leave them out
        </button>
        <button type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => onChange(true)}>
          Bring them in
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
          ? `The company has ${fmtSize(left)} free of ${fmtSize(total)}, shared by everyone.${need / Math.max(1, left) >= 0.05 ? ` This leaves ${fmtSize(left - need)}.` : ''}`
          : `It doesn’t fit: the company has ${fmtSize(left)} free of ${fmtSize(total)}.`}
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
    ...(person.canInvite ? [{ value: 'invite', label: 'Invite them', hint: 'Joins as a member; you get their invite link', group: 'Them' }] : []),
    { value: 'former', label: 'Keep as a former member', hint: 'Their name stays on what they wrote', group: 'Them' },
    ...members.map((u) => ({ value: `map:${u.id}`, label: u.name, hint: u.email, icon: <Avatar person={u} size={20} />, group: 'Same person as', keywords: u.email })),
  ];
  const row = (person: ImportPerson) => {
    const v = valueOf(person, c);
    const mapped = v.startsWith('map:') ? members.find((u) => u.id === v.slice(4)) : undefined;
    return (
      <div key={person.key} role="listitem" className="imp-row imp-person">
        <PersonCell
          person={{ name: person.name, email: person.email }}
          sub={person.email ?? `No email in ${from}`}
          badges={
            person.gone ? (
              <Badge small>Deactivated</Badge>
            ) : person.how === 'name' ? (
              <Badge small tone="info">
                Same name
              </Badge>
            ) : null
          }
          size={28}
        />
        <Select
          value={v}
          options={options(person)}
          onChange={(x) => pick(person, x)}
          label={`What happens to ${person.name}`}
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
      <h4>People</h4>
      {open.length > 0 ? (
        <p className="imp-line muted">
          {open.length === 1 ? 'One person isn’t' : `${num(open.length)} people aren’t`} here yet. Pick what happens to {open.length === 1 ? 'them' : 'each'}.
          {inviting ? ` You get ${inviting === 1 ? 'an invite link' : 'invite links'} to send; nothing is emailed.` : ''}
        </p>
      ) : (
        <p className="imp-line muted">Everyone is matched to someone here.</p>
      )}
      {open.length > 3 && (
        <div className="imp-bulk">
          {open.some((x) => x.canInvite) && (
            <button type="button" className="link-btn small" onClick={() => all('invite')}>
              Invite everyone with an email
            </button>
          )}
          <button type="button" className="link-btn small" onClick={() => all('former')}>
            Keep them all as names
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
            {matched.length === 1 ? `${matched[0].name} is` : `${num(matched.length)} people are`} matched to people here
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
