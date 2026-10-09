import { useState } from 'react';
import { AlertTriangle, FileText, Mail, Plus, Sparkles, Users } from 'lucide-react';
import type { Channel, ChatMessage, Client, Status, Team, Thread, Todo, User } from '../../types';
import { localDay, relative } from '../../utils';
import { term } from '../../terms';
import { companyOf } from '../../clientView';
import { companyTz, nextSummaryDay, settledKey, channelSchedule } from '../../jobTimes';
import { Avatar } from '../Avatar';
import { Badge, PersonCell } from '../ui/Person';
import { EmptyState } from '../ui/EmptyState';
import { Select } from '../ui/Select';
import { DatePicker } from '../ui/DatePicker';
import { personOption } from '../ui/PeopleList';
import { dueLabel } from '../TasksView';
import { CATEGORY_ONE, categoryText } from '../ChannelDialog';
import type { Presence } from '../ChatApp';
import { statusText } from './chatPrefs';
import { t, tx } from '../../i18n';
import { fmtDate, fmtTime, fmtWeekday } from '../../i18n/format';

/* What's inside a conversation besides its messages: its tasks, summaries, people and details. On desktop they're the
   tabs under the channel's header; on phones they're rows in the channel's details, each its own screen. */

/** The channel's tasks: its project's or team's, plus its own list. */
export function TasksPane(p: { channel: Channel; title: string; client?: Client; team?: Team; tasks: Todo[]; users: User[]; me: string; onCreateTask: (t: { title: string; userId: string; due?: string }) => void; onToggleTask: (id: string) => void; onOpenTask: (id: string) => void }) {
  const { client, team, users, me } = p;
  const [taskTitle, setTaskTitle] = useState('');
  const [taskWho, setTaskWho] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const person = (id: string) => users.find((u) => u.id === id);
  const add = () => {
    if (!taskTitle.trim()) return;
    p.onCreateTask({ title: taskTitle.trim(), userId: taskWho || me, due: taskDue || undefined });
    setTaskTitle('');
    setTaskDue('');
  };
  return (
    <div className="chan-pane">
      <p className="muted small">{client ? t('Tasks for {name}, plus anything added here.', { name: client.name }) : team ? t('{team}’s tasks, plus anything added here.', { team: team.name }) : t('This channel’s own to-do list.')}</p>
      <div className="todo-add task-add">
        <Plus size={16} />
        <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder={t('Add to {name}’s list…', { name: p.title })} />
        <Select value={taskWho || me} onChange={setTaskWho} label={t('Assign to')} className="sel-flat" options={users.map((u) => ({ ...personOption(u), label: u.id === me ? t('Me') : u.name, icon: <Avatar person={u} size={18} /> }))} />
        <DatePicker value={taskDue} onChange={setTaskDue} label={t('Due')} placeholder={t('Due')} className="sel-flat" />
        <button className="primary-btn sm" disabled={!taskTitle.trim()} onClick={add}>
          {t('Add')}
        </button>
      </div>
      {[false, true].map((done) => {
        const list = p.tasks.filter((task) => task.done === done).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
        if (!list.length) return null;
        return (
          <div key={String(done)} className="todo-group">
            <div className="d-heading">{done ? t('Done') : tx('task', 'Open')}</div>
            {list.map((task) => (
              <div key={task.id} className={`task ${task.done ? 'done' : ''}`}>
                <button className="todo-check" onClick={() => p.onToggleTask(task.id)} aria-label={task.done ? t('Mark not done') : t('Mark done')}>
                  {task.done && <span>✓</span>}
                </button>
                <button className="task-title-btn" onClick={() => p.onOpenTask(task.id)}>
                  {task.title}
                </button>
                {task.due && !task.done && <span className={`due ${dueLabel(task.due).cls}`}>{t(dueLabel(task.due).text)}</span>}
                {person(task.userId) ? <Avatar person={person(task.userId)!} size={22} /> : <span className="avatar-empty sm">?</span>}
              </div>
            ))}
          </div>
        );
      })}
      {!p.tasks.length && <EmptyState compact text={t('Nothing on this list yet. Add one above, or type /task in a message.')} />}
    </div>
  );
}

/** Summaries: the schedule, writing one now, "since my last visit", and the ones written before. */
export function SummaryPane(p: {
  channel: Channel;
  users: User[];
  since: string;
  summaryCost: string;
  summaryOff?: { text: string; fix?: { label: string; run: () => void } };
  timeZone?: string;
  summarizing: 'period' | 'since' | null;
  sinceText: string | null;
  summarize: (kind: 'period' | 'since') => void;
  onChannel: (patch: Partial<Channel>) => void;
}) {
  const { channel } = p;
  const person = (id: string) => p.users.find((u) => u.id === id);
  const schedule = channelSchedule(channel);
  const lastRun = channel.summary?.last;
  const nextDay = nextSummaryDay(schedule, settledKey(lastRun), Date.now(), companyTz({ timeZone: p.timeZone }), !!lastRun);
  const nextRun = () => (!nextDay ? '' : nextDay === localDay() ? t('today') : fmtWeekday(nextDay));
  const lastMissed = lastRun && (lastRun.state === 'off' || lastRun.state === 'failed') && lastRun.key === settledKey(lastRun) ? lastRun : null;
  const lastRetrying = lastRun?.state === 'failed' && !settledKey(lastRun) ? lastRun : null;
  const failed = (why?: string) => why ?? t('the AI service failed');
  return (
    <div className="chan-pane">
      <div className="sum-head">
        <span>
          <strong>{schedule === 'off' ? t('No automatic summary') : schedule === 'monthly' ? t('Updated every month') : schedule === 'weekly' ? t('Updated every week') : t('Updated every day with new messages')}</strong>
          <small className="muted">{schedule === 'off' ? t('Each summary uses {cost}', { cost: p.summaryCost }) : p.summaryOff ? t('Paused until AI works for this company') : t('Next: {when} · skipped when nothing happened · each uses {cost}', { when: nextRun(), cost: p.summaryCost })}</small>
        </span>
        <Select
          value={schedule}
          onChange={(v) => p.onChannel({ summary: { ...channel.summary, schedule: v, post: channel.summary?.post ?? false, history: channel.summary?.history ?? [] } })}
          label={t('Summary schedule')}
          className="sel-flat"
          options={[
            { value: 'monthly', label: t('Monthly') },
            { value: 'weekly', label: t('Weekly') },
            { value: 'daily', label: t('Daily') },
            { value: 'off', label: t('Off') },
          ]}
        />
      </div>
      <div className="sum-actions">
        <button className="primary-btn sm" disabled={!!p.summarizing} onClick={() => p.summarize('period')}>
          <Sparkles size={14} /> {p.summarizing === 'period' ? t('Writing…') : t('Update now')}
        </button>
        <button className="ghost-btn sm" disabled={!!p.summarizing} onClick={() => p.summarize('since')}>
          {p.summarizing === 'since' ? t('Reading…') : t('Since my last visit ({when})', { when: relative(p.since) })}
        </button>
        <label className="check-row small">
          <input type="checkbox" checked={channel.summary?.post ?? false} onChange={(e) => p.onChannel({ summary: { ...channel.summary, schedule, post: e.target.checked, history: channel.summary?.history ?? [] } })} /> {t('Post new summaries in the channel')}
        </label>
      </div>
      {schedule !== 'off' && (p.summaryOff || lastMissed || lastRetrying) && (
        <div className="sum-off" role="status">
          <AlertTriangle size={15} aria-hidden />
          <span>
            {p.summaryOff
              ? t('Scheduled summaries can’t be written: {why}', { why: p.summaryOff.text })
              : lastRetrying
                ? `${lastRetrying.label ? t('The {period} summary couldn’t be written yet ({why}).', { period: lastRetrying.label, why: failed(lastRetrying.why) }) : t('The latest summary couldn’t be written yet ({why}).', { why: failed(lastRetrying.why) })} ${lastRetrying.retryAt ? t('It’s tried again by itself at {time}.', { time: fmtTime(lastRetrying.retryAt) }) : t('It’s tried again by itself.')}`
                : lastMissed!.label
                  ? t('The {period} summary wasn’t written: {why}', { period: lastMissed!.label, why: failed(lastMissed!.why) })
                  : t('The last summary wasn’t written: {why}', { why: failed(lastMissed!.why) })}{' '}
            {p.summaryOff?.fix && (
              <button className="link-btn" onClick={p.summaryOff.fix.run}>
                {p.summaryOff.fix.label}
              </button>
            )}
          </span>
        </div>
      )}
      {p.sinceText && (
        <div className="sum-card since">
          <div className="sum-meta">{t('Since your last visit')}</div>
          <p>{p.sinceText}</p>
        </div>
      )}
      {(channel.summary?.history ?? []).map((h) => (
        <div key={h.id} className="sum-card">
          <div className="sum-meta">
            {h.period} · {h.auto ? t('scheduled') : t('asked by {name}', { name: person(h.by ?? '')?.name.split(' ')[0] ?? t('someone') })} · {relative(h.at)}
          </div>
          <p>{h.text}</p>
        </div>
      ))}
      {!(channel.summary?.history ?? []).length && !p.sinceText && <EmptyState compact text={t('No summaries yet. “Update now” writes the first one.')} />}
    </div>
  );
}

/** Pinned messages, rendered by the conversation. */
export function PinnedPane({ pinned, render }: { pinned: ChatMessage[]; render: (m: ChatMessage) => React.ReactNode }) {
  return (
    <div className="chan-pane">
      {pinned.map((m) => render(m))}
      {!pinned.length && <EmptyState compact text={t('Nothing pinned. Pin briefs, links and decisions from a message’s menu to keep them here.')} />}
    </div>
  );
}

/** About: purpose, project, team, owner, access, briefs, people, the project's contacts and emails. */
export function ChannelAbout(p: {
  channel: Channel;
  client?: Client;
  team?: Team;
  other?: User;
  users: User[];
  me: string;
  tasks: Todo[];
  mail: Thread[];
  statuses: Record<string, Status>;
  presence: (id: string) => Presence;
  timeZone?: string;
  onOpenClient: (id: string) => void;
  onOpenTeam: (id: string) => void;
  onOpenTask: (id: string) => void;
  onOpenMail: (id: string) => void;
  onSettings: () => void;
  only?: 'people' | 'about';
}) {
  const { channel, client, team, other } = p;
  const person = (id: string) => p.users.find((u) => u.id === id);
  const emails = client?.domain ? p.mail.filter((th) => th.messages.some((m) => [m.from, ...m.to].some((x) => x.email.toLowerCase().endsWith('@' + client.domain)))) : [];
  const contacts = client?.domain ? [...new Map(p.mail.flatMap((th) => th.messages.flatMap((m) => [m.from, ...m.to])).filter((x) => x.email.toLowerCase().endsWith('@' + client.domain)).map((x) => [x.email.toLowerCase(), x])).values()] : [];
  const lastContact = (email: string) =>
    p.mail
      .flatMap((th) => th.messages)
      .filter((m) => [m.from, ...m.to].some((x) => x.email.toLowerCase() === email))
      .map((m) => m.date)
      .sort()
      .pop();
  const briefs = p.tasks.filter((task) => task.kind === 'brief' && !task.done && client && task.clientId === client.id);
  const showAbout = p.only !== 'people';
  const showPeople = p.only !== 'about';

  return (
    <div className="chan-pane about-pane">
      {showAbout &&
        (other ? (
          <div className="profile">
            <Avatar person={other} size={64} />
            <strong>{other.name}</strong>
            <span className="muted">{other.title}</span>
            {p.statuses[other.id] && (
              <span className="profile-status">
                {p.statuses[other.id].emoji} {statusText(p.statuses[other.id])}
              </span>
            )}
            <a href={`mailto:${other.email}`}>{other.email}</a>
            <span className="muted small">{t('Local time {time}', { time: fmtDate(new Date(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: companyTz({ timeZone: p.timeZone }), timeZoneName: 'short' }) })}</span>
          </div>
        ) : (
          <dl className="fields about-fields">
            <dt>{t('Purpose')}</dt>
            <dd>{channel.topic ?? t('Not set')}</dd>
            <dt>{t('Category')}</dt>
            <dd>{categoryText(CATEGORY_ONE[channel.category ?? 'project'])}</dd>
            {client && (
              <>
                <dt>{term.One}</dt>
                <dd>
                  <button className="link-btn" onClick={() => p.onOpenClient(client.id)}>
                    {client.name}
                  </button>
                  {client.domain && <span className="muted small">@{client.domain}</span>}
                </dd>
                <dt>{t('Account owner')}</dt>
                <dd>{person(client.ownerId)?.name ?? t('Not set')}</dd>
              </>
            )}
            {team && (
              <>
                <dt>{t('Team')}</dt>
                <dd>
                  <button className="link-btn" onClick={() => p.onOpenTeam(team.id)}>
                    {team.name}
                  </button>
                </dd>
                <dt>{t('Team lead')}</dt>
                <dd>{person(team.leadId ?? '')?.name ?? t('Not set')}</dd>
              </>
            )}
            <dt>{t('Channel owner')}</dt>
            <dd>{person(channel.ownerId ?? '')?.name ?? t('Not set')}</dd>
            <dt>{t('Access')}</dt>
            <dd>
              {channel.private ? t('Private, invite only') : t('Public in the company')}
              {channel.postPolicy === 'admins' ? ` · ${t('announcements')}` : ''}
            </dd>
            {briefs.length > 0 && (
              <>
                <dt>{t('Briefs')}</dt>
                <dd className="col">
                  {briefs.map((b) => (
                    <button key={b.id} className="brief-chip" onClick={() => p.onOpenTask(b.id)}>
                      <FileText size={11} /> {b.title}
                    </button>
                  ))}
                </dd>
              </>
            )}
          </dl>
        ))}

      {showAbout && client && (
        <div className="te-list">
          <div className="d-heading">{t('Emails with {name}', { name: client.name })}</div>
          {emails.length === 0 && <EmptyState compact text={t('No emails with @{domain} in inboxes you can open.', { domain: client.domain ?? '' })} />}
          {emails.map((th) => {
            const last = th.messages[th.messages.length - 1];
            return (
              <button key={th.id} className="te-row simple" onClick={() => p.onOpenMail(th.id)}>
                <Avatar person={last.from} size={28} />
                <div className="te-main">
                  <strong>{th.subject}</strong>
                  <small>
                    {last.from.name} · {relative(last.date)}
                  </small>
                </div>
              </button>
            );
          })}
          <p className="muted small">{t('Only emails from inboxes you’re allowed to open are shown.')}</p>
        </div>
      )}

      {showPeople && !other && (
        <div className="people-list">
          {p.only !== 'people' && <div className="d-heading">{t('People')}</div>}
          <div className="sel-group">
            {t('Team')} · {channel.members.length}
          </div>
          {channel.members.map((id) => {
            const u = person(id);
            return (
              u && (
                <div key={id} className="pl-row">
                  <PersonCell
                    person={u}
                    avatar={
                      <span className="dm-av">
                        <Avatar person={u} size={28} />
                        <i className={`presence ${p.presence(id)}`} />
                      </span>
                    }
                    badges={
                      <>
                        {id === p.me && <Badge tone="accent">{t('You')}</Badge>}
                        {channel.ownerId === id && <Badge>{t('Owner')}</Badge>}
                      </>
                    }
                    sub={p.statuses[id] ? `${p.statuses[id].emoji} ${statusText(p.statuses[id])}` : u.title || u.email}
                  />
                </div>
              )
            );
          })}
          {!!channel.guests?.length && (
            <div className="sel-group">
              {t('Guests')} · {channel.guests.length}
            </div>
          )}
          {channel.guests?.map((g) => (
            <div key={g.email} className="pl-row">
              <PersonCell person={g} size={28} badges={<Badge tone="warn">{t('Guest')}</Badge>} sub={[companyOf(g.email, client?.people?.find((x) => x.email === g.email)?.company, client), g.email, g.status === 'joined' ? t('joined') : t('invite sent')].filter(Boolean).join(' · ')} />
            </div>
          ))}
          {contacts.length > 0 && <div className="sel-group">{t('Contacts at {name} · from emails', { name: client?.name ?? '' })}</div>}
          {contacts.map((c) => (
            <div key={c.email} className="pl-row">
              <PersonCell person={c} size={28} sub={lastContact(c.email.toLowerCase()) ? `${c.email} · ${t('last email {when}', { when: relative(lastContact(c.email.toLowerCase())!) })}` : c.email} />
              <a className="icon-btn sm" href={`mailto:${c.email}`} title={t('Email')} aria-label={t('Email {name}', { name: c.name })}>
                <Mail size={14} />
              </a>
            </div>
          ))}
          <button className="ghost-btn sm" onClick={p.onSettings}>
            <Users size={14} /> {t('Add people or guests')}
          </button>
        </div>
      )}
    </div>
  );
}
