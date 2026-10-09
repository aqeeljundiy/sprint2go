import { ProjectBadge } from './ProjectBadge';
import { useEffect } from 'react';
import { ArrowRight, Check, LogOut, Plus } from 'lucide-react';
import type { Channel, ChatMessage, Client, ClientPerson, Todo, Workspace } from '../types';
import { tasksFor } from '../clientView';
import { relative } from '../utils';
import { WorkspaceLogo } from './WorkspaceLogo';
import { brand as product } from '../terms';
import { LANGS, t, tn, type Lang } from '../i18n';
import { useLang } from '../i18n/useLang';

type Portal = { key: string; ws: Workspace; client: Client; person: ClientPerson };

/**
 * A guest's home when more than one company shares work with them: grouped by the company that invited them,
 * each project saying what's waiting on this person. Opening one goes into its shared space.
 */
export function SharedHome({ name, portals, todos, channels, messages, onOpen, onStart, onSignOut, ownWorkspace, language, onLanguage }: {
  name: string;
  portals: Portal[];
  todos: Todo[];
  channels: Channel[];
  messages: ChatMessage[];
  onOpen: (key: string) => void;
  onStart: () => void;
  onSignOut: () => void;
  ownWorkspace?: string /* someone with a company of their own: the button goes back there */;
  /** Guests have no Settings: English or Bahasa Indonesia here (only when a handler is passed). Their pick, if any. */
  language?: Lang;
  onLanguage?: (l: Lang) => void;
}) {
  const lang = useLang();
  const byCompany = [...new Set(portals.map((p) => p.ws.id))].map((id) => portals.filter((p) => p.ws.id === id));
  const waiting = (p: Portal) => (p.person.role === 'approver' && p.client.status !== 'ended' ? tasksFor(p.client, todos).filter((tk) => tk.approval?.status === 'waiting').length : 0);
  const lastUpdate = (p: Portal) => {
    const chans = new Set(channels.filter((c) => c.clientId === p.client.id && c.category === 'shared').map((c) => c.id));
    return [...tasksFor(p.client, todos).map((tk) => tk.history?.at(-1)?.at ?? tk.createdAt), ...messages.filter((m) => chans.has(m.channelId)).map((m) => m.at)].filter(Boolean).sort().pop();
  };
  const total = portals.reduce((n, p) => n + waiting(p), 0);
  useEffect(() => {
    document.title = t('Shared with you · {product}', { product: product.name });
  }, [lang]);
  const shownLang = language ?? lang;
  return (
    <div className="shared-home">
      <header className="sh-head">
        <div>
          <h1>{t('Shared with you')}</h1>
          <p className="muted">{total ? tn(total, '{n} thing waiting for your OK.', '{n} things waiting for your OK.') : t('Hi {name}. Nothing is waiting on you right now.', { name: name.split(' ')[0] })}</p>
        </div>
        <button className="ghost-btn sm" onClick={onSignOut}>
          <LogOut size={14} /> {t('Sign out')}
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
                      {p.client.status === 'ended' ? t('Ended, read only') : w ? tn(w, '{n} to approve', '{n} to approve') : last ? t('Updated {when}', { when: relative(last) }) : t('Nothing new')}
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
            <strong>{t('Back to {company}', { company: ownWorkspace })}</strong>
            <small>{t('Your own company’s apps. Everything shared with you stays in the workspace switcher.')}</small>
          </span>
        ) : (
          <span>
            <strong>{t('Start your own workspace')}</strong>
            <small>{t('Free. Mail, chat, tasks and files for your own team. You keep access to everything shared with you here.')}</small>
          </span>
        )}
      </button>
      {onLanguage && (
        <div className="segmented sh-lang" role="group" aria-label={t('Language')}>
          {LANGS.map((l) => (
            <button key={l.id} type="button" lang={l.id} className={shownLang === l.id ? 'on' : ''} aria-pressed={shownLang === l.id} onClick={() => onLanguage(l.id)}>
              {l.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
