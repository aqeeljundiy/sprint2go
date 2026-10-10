import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Mail, Menu, MoreHorizontal, Pencil, Phone, Search, Trash2, Upload, UserPlus, Users, X, Merge } from 'lucide-react';
import type { Person, User, Workspace } from '../../types';
import { server } from '../../sync';
import { usePhone } from '../../mobile/media';
import { TopBar, TopBarButton } from '../../mobile/TopBar';
import { useCreateAction } from '../../mobile/chrome';
import { Avatar } from '../Avatar';
import { Badge } from '../ui/Person';
import { PushScreen } from '../ui/PushScreen';
import { Layer } from '../ui/Layer';
import { EmptyState } from '../ui/EmptyState';
import { SmoothHeight, TabPane, useLeaving } from '../ui/Smooth';
import { useActionMenu } from '../ui/ActionSheet';
import { useOnePanel } from '../../onePanel';
import { loadContacts, postJson, type Contact, type ContactsInfo, type Frequent } from './teamsApi';
import { BusyButton, ErrorLine } from './teamsBits';
import { t, tn } from '../../i18n';
import { fmtDay } from '../../i18n/format';
import './teams.css';

/*
 * Mail, Contacts (Google Contacts in Mail): your saved contacts with their emails, phones, company, notes and labels;
 * everyone you've emailed ("Other contacts"), most written-to first; and the team. Add, edit, delete, merge the ones
 * that look like the same person, put them in labels, and bring them in or out as vCard (.vcf) or CSV. Compose's
 * suggestions come from here too (most contacted first). Kept on the server, per person and company
 * (server/mailContacts.ts). Desktop: the list with the contact in a side panel; phones: a list, the contact pushed over it.
 */

type Tab = 'contacts' | 'other' | 'team';
type Draft = { id?: string; name: string; emails: string[]; phones: string[]; company: string; title: string; notes: string; labels: string[] };
const blank = (p?: Partial<Draft>): Draft => ({ name: '', emails: [''], phones: [], company: '', title: '', notes: '', labels: [], ...p });
const toDraft = (c: Contact): Draft => ({ id: c.id, name: c.name, emails: c.emails.length ? c.emails : [''], phones: c.phones, company: c.company ?? '', title: c.title ?? '', notes: c.notes ?? '', labels: c.labels });

/** Saved contacts and your team, ranked for compose: most written-to first (server/mailContacts.ts frequent). */
export function rankForCompose(info: ContactsInfo | null): Person[] {
  if (!info) return [];
  const score = new Map(info.frequent.map((f, i) => [f.email, info.frequent.length - i]));
  const out = new Map<string, Person & { s: number }>();
  for (const f of info.frequent) out.set(f.email, { name: f.name, email: f.email, s: score.get(f.email) ?? 0 });
  for (const c of info.contacts) for (const e of c.emails) out.set(e, { name: c.name || e.split('@')[0], email: e, s: (score.get(e) ?? 0) + 0.5 });
  for (const m of info.team) if (m.email && !out.has(m.email)) out.set(m.email, { name: m.name, email: m.email, s: 0.25 });
  return [...out.values()].sort((a, b) => b.s - a.s).map(({ name, email }) => ({ name, email }));
}

/** The contacts for compose, loaded once per company and refreshed when Contacts saves (event s2g:contacts). */
export function useComposeContacts(wsId: string) {
  const [info, setInfo] = useState<ContactsInfo | null>(null);
  useEffect(() => {
    if (!server.on) return;
    let on = true;
    const load = () => void loadContacts(wsId).then((d) => on && setInfo(d), () => {});
    load();
    window.addEventListener('s2g:contacts', load);
    return () => ((on = false), window.removeEventListener('s2g:contacts', load));
  }, [wsId]);
  return useMemo(() => rankForCompose(info), [info]);
}
const changed = () => window.dispatchEvent(new CustomEvent('s2g:contacts'));

export function ContactsView({ ws, users, me, onCompose, onMenu, toast }: { ws: Workspace; users: User[]; me: string; onCompose: (p: Person) => void; onMenu: () => void; toast: (text: string) => void }) {
  const phone = usePhone();
  const [info, setInfo] = useState<ContactsInfo | null | 'failed'>(null);
  const [tab, setTab] = useState<Tab>('contacts');
  const [label, setLabel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<{ draft: Draft; editing: boolean } | null>(null);
  const [merging, setMerging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const exportBtn = useRef<HTMLButtonElement>(null);
  const load = () => void loadContacts(ws.id).then(setInfo, () => setInfo('failed'));
  useEffect(() => {
    if (server.on) load();
    else setInfo({ contacts: [], frequent: [], team: users.filter((u) => u.id !== me).map((u) => ({ userId: u.id, name: u.name, email: u.email, title: u.title ?? '' })), duplicates: [] });
  }, [ws.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = info && info !== 'failed' ? info : null;
  const labels = useMemo(() => [...new Set((d?.contacts ?? []).flatMap((c) => c.labels))].sort((a, b) => a.localeCompare(b)), [d]);
  const match = (s: string) => s.toLowerCase().includes(q.trim().toLowerCase());
  const saved = (d?.contacts ?? []).filter((c) => (!label || c.labels.includes(label)) && (!q.trim() || match(c.name) || c.emails.some(match) || match(c.company ?? '') || c.phones.some(match)));
  const savedEmails = new Set((d?.contacts ?? []).flatMap((c) => c.emails));
  const others = (d?.frequent ?? []).filter((f) => !savedEmails.has(f.email) && (!q.trim() || match(f.name) || match(f.email)));
  const team = (d?.team ?? []).filter((m) => !q.trim() || match(m.name) || match(m.email));
  const savedRows = useLeaving(saved, (c) => c.id);
  const dupes = d?.duplicates ?? [];

  const save = async (draft: Draft) => {
    const r = await postJson<{ contact: Contact }>('/api/mail/contacts', { workspaceId: ws.id, contact: { ...draft, emails: draft.emails.map((e) => e.trim()).filter(Boolean) } });
    setInfo((x) => (x && x !== 'failed' ? { ...x, contacts: [...x.contacts.filter((c) => c.id !== r.contact.id), r.contact].sort((a, b) => a.name.localeCompare(b.name)) } : x));
    changed();
    return r.contact;
  };
  const remove = async (c: { id: string; name: string }) => {
    await postJson('/api/mail/contacts/delete', { workspaceId: ws.id, ids: [c.id] });
    setInfo((x) => (x && x !== 'failed' ? { ...x, contacts: x.contacts.filter((y) => y.id !== c.id), duplicates: x.duplicates.filter((g) => !g.includes(c.id)) } : x));
    setOpen(null);
    changed();
    toast(t('{name} deleted', { name: c.name }));
  };
  const mergeAll = async () => {
    setMerging(true);
    try {
      for (const g of dupes) await postJson('/api/mail/contacts/merge', { workspaceId: ws.id, ids: g });
      toast(tn(dupes.length, '{n} contact merged', '{n} contacts merged'));
      load();
      changed();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setMerging(false);
    }
  };
  const importFile = async (f: File) => {
    const format = /\.csv$/i.test(f.name) || f.type.includes('csv') ? 'csv' : 'vcf';
    try {
      const text = await f.text();
      const r = await postJson<{ added: number; updated: number }>('/api/mail/contacts/import', { workspaceId: ws.id, format, text });
      toast(r.updated ? t('{added} added, {updated} updated', { added: tn(r.added, '{n} contact', '{n} contacts'), updated: tn(r.updated, '{n} contact', '{n} contacts') }) : t('{added} added', { added: tn(r.added, '{n} contact', '{n} contacts') }));
      load();
      changed();
      setTab('contacts');
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const exportMenu = useActionMenu(
    () => [
      { label: t('Export as vCard (.vcf)'), icon: Download, run: () => (location.href = `/api/mail/contacts/export?ws=${encodeURIComponent(ws.id)}&format=vcf${label ? `&label=${encodeURIComponent(label)}` : ''}`) },
      { label: t('Export as CSV (Google, Outlook)'), icon: Download, run: () => (location.href = `/api/mail/contacts/export?ws=${encodeURIComponent(ws.id)}&format=csv${label ? `&label=${encodeURIComponent(label)}` : ''}`) },
      { label: t('Import vCard or CSV'), icon: Upload, group: 'in', run: () => fileRef.current?.click() },
    ],
    { title: t('Import and export'), menu: true },
  );
  // Phones: the create button makes a contact while Contacts is open (Gmail's Compose comes back after).
  useCreateAction('mail', phone && server.on ? { label: t('New contact'), icon: UserPlus, run: () => setOpen({ draft: blank(), editing: true }) } : null);
  const fromFrequent = (f: Frequent) => setOpen({ draft: blank({ name: f.name, emails: [f.email] }), editing: true });

  const tools = (
    <>
      <button type="button" ref={exportBtn} className={phone ? 'icon-btn mt-btn' : 'ghost-btn outline sm'} aria-label={t('Import and export')} title={t('Import and export')} onClick={() => exportMenu.openFrom(exportBtn)} disabled={!server.on}>
        {phone ? <MoreHorizontal size={22} /> : <><Upload size={14} /> {t('Import and export')}</>}
      </button>
      {!phone && (
        <button type="button" className="primary-btn sm" onClick={() => setOpen({ draft: blank(), editing: true })} disabled={!server.on}>
          <UserPlus size={14} /> {t('New contact')}
        </button>
      )}
    </>
  );
  const list = (
    <div className="ct-body">
      <div className="ct-tools">
        <label className="ct-search">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search contacts')} aria-label={t('Search contacts')} />
          {q && (
            <button type="button" className="icon-btn sm" aria-label={t('Clear')} onClick={() => setQ('')}>
              <X size={14} />
            </button>
          )}
        </label>
        <div className="segmented ct-tabs" role="tablist" aria-label={t('Contacts')}>
          {(['contacts', 'other', 'team'] as Tab[]).map((x) => (
            <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>
              {x === 'contacts' ? t('Contacts') : x === 'other' ? t('Other contacts') : t('Team')}
            </button>
          ))}
        </div>
      </div>
      {tab === 'contacts' && labels.length > 0 && (
        <div className="ct-labels" role="group" aria-label={t('Labels')}>
          <button type="button" className={`chip ${!label ? 'on' : ''}`} onClick={() => setLabel(null)}>
            {t('All')}
          </button>
          {labels.map((l) => (
            <button key={l} type="button" className={`chip ${label === l ? 'on' : ''}`} onClick={() => setLabel(label === l ? null : l)}>
              {l}
            </button>
          ))}
        </div>
      )}
      <SmoothHeight>
        {tab === 'contacts' && dupes.length > 0 && !q && (
          <div className="ct-dupes">
            <Merge size={16} />
            <span>{tn(dupes.length, '{n} pair of contacts look like the same person.', '{n} groups of contacts look like the same people.')}</span>
            <BusyButton busy={merging} className="ghost-btn outline sm" onClick={() => void mergeAll()}>
              {t('Merge them')}
            </BusyButton>
          </div>
        )}
      </SmoothHeight>
      <SmoothHeight>
        <TabPane key={tab}>
          {info === null ? (
            <p className="muted small ct-pad">{t('Checking…')}</p>
          ) : info === 'failed' ? (
            <p className="set-hint ct-pad">{t('Couldn’t check right now. Try again in a moment.')}</p>
          ) : tab === 'contacts' ? (
            savedRows.length ? (
              <ul className="ct-list">
                {savedRows.map(({ item: c, leaving }) => (
                  <ContactRow key={c.id} c={c} leaving={leaving} on={open?.draft.id === c.id} onOpen={() => setOpen({ draft: toDraft(c), editing: false })} onEmail={() => onCompose({ name: c.name, email: c.emails[0] })} onEdit={() => setOpen({ draft: toDraft(c), editing: true })} onDelete={() => void remove(c)} />
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={<Users size={28} />}
                title={q ? t('No contacts match') : t('No contacts yet')}
                text={q ? t('Try another name or email.') : t('Save people you email, or bring your contacts in from Google, Outlook or your phone as a vCard or CSV file.')}
                action={
                  !q && server.on ? (
                    <button type="button" className="primary-btn sm" onClick={() => fileRef.current?.click()}>
                      <Upload size={14} /> {t('Import contacts')}
                    </button>
                  ) : undefined
                }
              />
            )
          ) : tab === 'other' ? (
            others.length ? (
              <ul className="ct-list">
                {others.slice(0, 300).map((f) => (
                  <li key={f.email} className="ct-row">
                    <button type="button" className="ct-main" onClick={() => onCompose({ name: f.name, email: f.email })} title={t('Write to {name}', { name: f.name })}>
                      <Avatar person={{ name: f.name, email: f.email }} size={phone ? 40 : 32} />
                      <span className="ct-text">
                        <strong>{f.name}</strong>
                        <small>{f.lastAt ? t('{email}, last {date}', { email: f.email, date: fmtDay(f.lastAt) }) : f.email}</small>
                      </span>
                    </button>
                    <button type="button" className="icon-btn sm ct-side" aria-label={t('Save {name} as a contact', { name: f.name })} title={t('Save as a contact')} onClick={() => fromFrequent(f)}>
                      <UserPlus size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact text={q ? t('Nobody matches.') : t('People you email show here, most written-to first.')} />
            )
          ) : team.length ? (
            <ul className="ct-list">
              {team.map((m) => (
                <li key={m.userId} className="ct-row">
                  <button type="button" className="ct-main" onClick={() => onCompose({ name: m.name, email: m.email })} title={t('Write to {name}', { name: m.name })}>
                    <Avatar person={users.find((u) => u.id === m.userId) ?? { name: m.name, email: m.email }} size={phone ? 40 : 32} />
                    <span className="ct-text">
                      <strong>{m.name}</strong>
                      <small>{m.title ? `${m.email} · ${m.title}` : m.email}</small>
                    </span>
                  </button>
                  <span className="ct-side ct-icon" aria-hidden>
                    <Mail size={16} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact text={t('Nobody else is on the team yet.')} />
          )}
        </TabPane>
      </SmoothHeight>
    </div>
  );

  const detail = open && (
    <ContactPanel
      key={open.draft.id ?? 'new'}
      phone={phone}
      draft={open.draft}
      editing={open.editing}
      labels={labels}
      onEdit={() => setOpen((o) => (o ? { ...o, editing: true } : o))}
      onView={() => setOpen((o) => (o ? { ...o, editing: false } : o))}
      onClose={() => setOpen(null)}
      onEmail={(email) => onCompose({ name: open.draft.name, email })}
      onSave={async (dr) => {
        const c = await save(dr);
        setOpen({ draft: toDraft(c), editing: false });
        toast(dr.id ? t('Saved') : t('{name} added', { name: c.name }));
      }}
      onDelete={open.draft.id ? () => void remove({ id: open.draft.id!, name: open.draft.name }) : undefined}
    />
  );

  return (
    <section className="ct view-enter">
      {phone ? (
        <TopBar app="mail" lead={<TopBarButton icon={Menu} label={t('Open menu')} onClick={onMenu} />} title={<h1 className="mt-title">{t('Contacts')}</h1>} actions={tools} search={false} />
      ) : (
        <header className="ct-head">
          <h1>{t('Contacts')}</h1>
          <span className="ct-head-tools">{tools}</span>
        </header>
      )}
      {list}
      <input ref={fileRef} type="file" hidden accept=".vcf,.vcard,.csv,text/vcard,text/csv" onChange={(e) => (e.target.files?.[0] && void importFile(e.target.files[0]), (e.target.value = ''))} />
      {exportMenu.menu}
      {detail && (phone ? detail : <Layer>{detail}</Layer>)}
    </section>
  );
}

function ContactRow({ c, leaving, on, onOpen, onEmail, onEdit, onDelete }: { c: Contact; leaving: boolean; on: boolean; onOpen: () => void; onEmail: () => void; onEdit: () => void; onDelete: () => void }) {
  const more = useRef<HTMLButtonElement>(null);
  const phone = usePhone();
  const m = useActionMenu(() => [...(c.emails[0] ? [{ label: t('Write an email'), icon: Mail, run: onEmail }] : []), { label: t('Edit'), icon: Pencil, run: onEdit }, { label: t('Delete'), icon: Trash2, danger: true, run: onDelete }], { title: c.name });
  return (
    <li className={`ct-row lp ${on ? 'on' : ''} ${leaving ? 'row-leaving' : ''}`} {...m.bind}>
      <button type="button" className="ct-main" onClick={onOpen}>
        <Avatar person={{ name: c.name, email: c.emails[0] ?? c.name }} size={phone ? 40 : 32} />
        <span className="ct-text">
          <strong>
            {c.name}
            {c.labels.slice(0, 2).map((l) => (
              <Badge key={l} small>
                {l}
              </Badge>
            ))}
          </strong>
          <small>{[c.emails[0], c.company].filter(Boolean).join(' · ') || c.phones[0]}</small>
        </span>
      </button>
      <button type="button" ref={more} className="icon-btn sm ct-side" aria-label={t('Actions for {name}', { name: c.name })} onClick={() => m.openFrom(more)}>
        <MoreHorizontal size={16} />
      </button>
      {m.menu}
    </li>
  );
}

/** One contact: its details, or the form to change them. A side panel on desktop, a pushed screen on phones. */
function ContactPanel({ phone, draft, editing, labels, onEdit, onView, onClose, onEmail, onSave, onDelete }: { phone: boolean; draft: Draft; editing: boolean; labels: string[]; onEdit: () => void; onView: () => void; onClose: () => void; onEmail: (email: string) => void; onSave: (d: Draft) => Promise<void>; onDelete?: () => void }) {
  useOnePanel(onClose);
  const [d, setD] = useState<Draft>(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const ok = !!d.name.trim() || d.emails.some((e) => e.includes('@'));
  const submit = async () => {
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await onSave({ ...d, labels: newLabel.trim() ? [...new Set([...d.labels, newLabel.trim()])] : d.labels });
      setNewLabel('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const title = editing ? (draft.id ? t('Edit contact') : t('New contact')) : draft.name || draft.emails[0];
  const body = editing ? (
    <form
      className="ct-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="field">
        <label htmlFor="ct-name">{t('Name')}</label>
        <input id="ct-name" value={d.name} maxLength={120} autoFocus={!phone} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div className="field">
        <label>{t('Email')}</label>
        {d.emails.map((em, i) => (
          <span key={i} className="ct-multi">
            <input type="email" inputMode="email" value={em} aria-label={t('Email')} onChange={(e) => set({ emails: d.emails.map((x, j) => (j === i ? e.target.value : x)) })} />
            {d.emails.length > 1 && (
              <button type="button" className="icon-btn sm" aria-label={t('Remove')} onClick={() => set({ emails: d.emails.filter((_, j) => j !== i) })}>
                <X size={14} />
              </button>
            )}
          </span>
        ))}
        <button type="button" className="link-btn small ct-more" onClick={() => set({ emails: [...d.emails, ''] })}>
          {t('Add another email')}
        </button>
      </div>
      <div className="field">
        <label>{t('Phone')}</label>
        {d.phones.map((ph, i) => (
          <span key={i} className="ct-multi">
            <input type="tel" inputMode="tel" value={ph} aria-label={t('Phone')} onChange={(e) => set({ phones: d.phones.map((x, j) => (j === i ? e.target.value : x)) })} />
            <button type="button" className="icon-btn sm" aria-label={t('Remove')} onClick={() => set({ phones: d.phones.filter((_, j) => j !== i) })}>
              <X size={14} />
            </button>
          </span>
        ))}
        <button type="button" className="link-btn small ct-more" onClick={() => set({ phones: [...d.phones, ''] })}>
          {t('Add a phone number')}
        </button>
      </div>
      <div className="ct-two">
        <div className="field">
          <label htmlFor="ct-company">{t('Company')}</label>
          <input id="ct-company" value={d.company} maxLength={120} onChange={(e) => set({ company: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="ct-title">{t('Job title')}</label>
          <input id="ct-title" value={d.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} />
        </div>
      </div>
      <div className="field">
        <label>{t('Labels')}</label>
        <div className="ct-label-pick">
          {[...new Set([...labels, ...d.labels])].map((l) => (
            <button key={l} type="button" className={`chip ${d.labels.includes(l) ? 'on' : ''}`} aria-pressed={d.labels.includes(l)} onClick={() => set({ labels: d.labels.includes(l) ? d.labels.filter((x) => x !== l) : [...d.labels, l] })}>
              {l}
            </button>
          ))}
          <input className="ct-new-label" value={newLabel} maxLength={40} placeholder={t('New label')} aria-label={t('New label')} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && newLabel.trim() && (e.preventDefault(), set({ labels: [...new Set([...d.labels, newLabel.trim()])] }), setNewLabel(''))} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="ct-notes">{t('Notes')}</label>
        <textarea id="ct-notes" rows={3} value={d.notes} maxLength={4000} onChange={(e) => set({ notes: e.target.value })} />
      </div>
      <ErrorLine text={error} />
      {!phone && (
        <div className="ct-form-foot">
          <button type="button" className="ghost-btn" onClick={draft.id ? () => (setD(draft), onView()) : onClose}>
            {t('Cancel')}
          </button>
          <BusyButton type="submit" busy={busy} className="primary-btn" disabled={!ok}>
            {t('Save')}
          </BusyButton>
        </div>
      )}
    </form>
  ) : (
    <div className="ct-detail">
      <div className="ct-hero">
        <Avatar person={{ name: draft.name, email: draft.emails[0] ?? draft.name }} size={56} />
        <strong>{draft.name}</strong>
        {(draft.title || draft.company) && <small>{[draft.title, draft.company].filter(Boolean).join(', ')}</small>}
        {draft.labels.length > 0 && (
          <span className="ct-hero-labels">
            {draft.labels.map((l) => (
              <Badge key={l} small>
                {l}
              </Badge>
            ))}
          </span>
        )}
      </div>
      <ul className="ct-facts">
        {draft.emails.filter(Boolean).map((e) => (
          <li key={e}>
            <button type="button" className="ct-fact" onClick={() => onEmail(e)}>
              <Mail size={16} />
              <span>{e}</span>
            </button>
          </li>
        ))}
        {draft.phones.map((p) => (
          <li key={p}>
            <a className="ct-fact" href={`tel:${p.replace(/[^\d+]/g, '')}`}>
              <Phone size={16} />
              <span>{p}</span>
            </a>
          </li>
        ))}
      </ul>
      {draft.notes && <p className="ct-notes">{draft.notes}</p>}
      <div className="ct-detail-actions">
        <button type="button" className="ghost-btn outline sm" onClick={onEdit}>
          <Pencil size={14} /> {t('Edit')}
        </button>
        {onDelete && (
          <button type="button" className="ghost-btn sm danger" onClick={onDelete}>
            <Trash2 size={14} /> {t('Delete')}
          </button>
        )}
      </div>
    </div>
  );
  if (phone)
    return (
      <PushScreen
        title={title}
        onBack={editing && draft.id ? () => (setD(draft), onView()) : onClose}
        cancel={editing}
        className="ct-push"
        actions={
          editing ? (
            <button type="button" className="g-save" disabled={!ok || busy} onClick={() => void submit()}>
              {t('Save')}
            </button>
          ) : (
            <button type="button" className="g-save" onClick={onEdit}>
              {t('Edit')}
            </button>
          )
        }
      >
        {body}
      </PushScreen>
    );
  return (
    <div className="drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer ct-drawer" role="dialog" aria-label={title} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="drawer-head">
          <span className="ct-drawer-title">{title}</span>
          <button type="button" className="icon-btn sm" aria-label={t('Close')} onClick={onClose}>
            <X size={15} />
          </button>
        </header>
        <div className="ct-drawer-body">{body}</div>
      </aside>
    </div>
  );
}
