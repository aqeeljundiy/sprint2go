import { ProjectBadge } from './ProjectBadge';
import { useEffect } from 'react';
import { ArrowRight, Check, LogOut, Plus } from 'lucide-react';
import type { Channel, ChatMessage, Client, ClientPerson, Todo, Workspace } from '../types';
import { tasksFor } from '../clientView';
import { relative } from '../utils';
import { WorkspaceLogo } from './WorkspaceLogo';

type Portal = { key: string; ws: Workspace; client: Client; person: ClientPerson };

/**
 * A guest's home when more than one company shares work with them: grouped by the company that invited them,
 * each project saying what's waiting on this person. Opening one goes into its shared space.
 */
export function SharedHome({ name, portals, todos, channels, messages, onOpen, onStart, onSignOut, ownWorkspace }: { name: string; portals: Portal[]; todos: Todo[]; channels: Channel[]; messages: ChatMessage[]; onOpen: (key: string) => void; onStart: () => void; onSignOut: () => void; ownWorkspace?: string /* someone with a company of their own: the button goes back there */ }) {
  const byCompany = [...new Set(portals.map((p) => p.ws.id))].map((id) => portals.filter((p) => p.ws.id === id));
  const waiting = (p: Portal) => (p.person.role === 'approver' && p.client.status !== 'ended' ? tasksFor(p.client, todos).filter((t) => t.approval?.status === 'waiting').length : 0);
  const lastUpdate = (p: Portal) => {
    const chans = new Set(channels.filter((c) => c.clientId === p.client.id && c.category === 'shared').map((c) => c.id));
    return [...tasksFor(p.client, todos).map((t) => t.history?.at(-1)?.at ?? t.createdAt), ...messages.filter((m) => chans.has(m.channelId)).map((m) => m.at)].filter(Boolean).sort().pop();
  };
  const total = portals.reduce((n, p) => n + waiting(p), 0);
  useEffect(() => {
    document.title = 'Shared with you · Sprint2go';
  }, []);
  return (
    <div className="shared-home">
      <header className="sh-head">
        <div>
          <h1>Shared with you</h1>
          <p className="muted">{total ? `${total} thing${total === 1 ? '' : 's'} waiting for your OK.` : `Hi ${name.split(' ')[0]}. Nothing is waiting on you right now.`}</p>
        </div>
        <button className="ghost-btn sm" onClick={onSignOut}>
          <LogOut size={14} /> Sign out
        </button>
      </header>
      {byCompany.map((list) => (
        <section key={list[0].ws.id} className="sh-company">
          <h2>
            <WorkspaceLogo ws={list[0].ws} size={22} /> {list[0].ws.name}
          </h2>
          <div className="sh-grid">
            {list.map((p) => {
              const w = waiting(p);
              const last = lastUpdate(p);
              return (
                <button key={p.key} className="sh-card" onClick={() => onOpen(p.key)}>
                  <ProjectBadge p={p.client} kind="client-dot" />
                  <span className="sh-text">
                    <strong>{p.client.name}</strong>
                    <small>
                      {p.client.status === 'ended' ? 'Ended, read only' : w ? `${w} to approve` : last ? `Updated ${relative(last)}` : 'Nothing new'}
                    </small>
                  </span>
                  {w ? <span className="ws-unread">{w}</span> : p.client.status !== 'ended' ? <Check size={15} className="muted" /> : null}
                  <ArrowRight size={15} className="sh-go" />
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <button className="sh-start" onClick={onStart}>
        <Plus size={16} />
        {ownWorkspace ? (
          <span>
            <strong>Back to {ownWorkspace}</strong>
            <small>Your own company’s apps. Everything shared with you stays in the workspace switcher.</small>
          </span>
        ) : (
          <span>
            <strong>Start your own workspace</strong>
            <small>Free. Mail, chat, tasks and files for your own team. You keep access to everything shared with you here.</small>
          </span>
        )}
      </button>
    </div>
  );
}
