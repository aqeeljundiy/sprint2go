import { useState } from 'react';
import { Check, Copy, FileSignature, Plus, Send, Trash2, X } from 'lucide-react';
import type { Client, Quote, User } from '../types';
import { term } from '../terms';
import { localDay, relative, uid } from '../utils';
import { DatePicker } from './ui/DatePicker';
import { Select } from './ui/Select';
import { EmptyState } from './ui/EmptyState';
import { t, tn } from '../i18n';
import { fmtDate } from '../i18n/format';

export const money = (n: number, cur: Quote['currency']) => (cur === 'IDR' ? `Rp ${Math.round(n).toLocaleString('id-ID')}` : `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
export const quoteTotal = (q: Pick<Quote, 'items'>) => q.items.reduce((a, i) => a + i.qty * i.price, 0);
const status = (s: Quote['status']) => ({ draft: t('Draft'), sent: t('Waiting for their answer'), accepted: t('Accepted'), declined: t('Declined') })[s];
const day = (d: string) => fmtDate(d.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' });
/** What "They agreed elsewhere" saves as the signature (English, shown in each reader's language). */
const OUTSIDE = 'Agreed outside the app';

/** The lines of a quote, with the total: the same table on both sides. */
export function QuoteLines({ q }: { q: Pick<Quote, 'items' | 'currency'> }) {
  return (
    <table className="qt-lines">
      <tbody>
        {q.items.map((i) => (
          <tr key={i.id}>
            <td>{i.title}</td>
            <td className="qt-num">{i.qty > 1 ? `${i.qty} × ${money(i.price, q.currency)}` : ''}</td>
            <td className="qt-num">{money(i.qty * i.price, q.currency)}</td>
          </tr>
        ))}
        <tr className="qt-total">
          <td>{t('Total')}</td>
          <td />
          <td className="qt-num">{money(quoteTotal(q), q.currency)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** A project's quotes: write one, send it, see the answer, turn an accepted one into a brief. */
export function QuotesTab({ client, quotes, users, me, canEdit, onSave, onDelete, onSend, onBrief, onOpenBrief }: {
  client: Client;
  quotes: Quote[];
  users: User[];
  me: string;
  canEdit: boolean;
  onSave: (q: Quote) => void;
  onDelete: (id: string) => void;
  onSend: (q: Quote) => void;
  onBrief: (q: Quote) => void;
  onOpenBrief: (id: string) => void;
}) {
  const [editing, setEditing] = useState<Quote | null>(null);
  const mine = quotes.filter((q) => q.clientId === client.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const blank = (): Quote => ({ id: uid(), workspaceId: client.workspaceId, clientId: client.id, title: t('{name}: quote', { name: client.name }), items: [{ id: uid(), title: '', qty: 1, price: 0 }], currency: 'IDR', status: 'draft', createdBy: me, createdAt: new Date().toISOString() });
  return (
    <div className="qt-tab">
      <div className="qt-head">
        <p className="muted small">{t('A quote or contract the {who} accepts by typing their name. Once accepted, it becomes a brief with one task per line.', { who: term.who })}</p>
        {canEdit && (
          <button type="button" className="primary-btn sm" onClick={() => setEditing(blank())}>
            <Plus size={14} /> {t('New quote')}
          </button>
        )}
      </div>
      {!mine.length && (
        <EmptyState
          icon={<FileSignature size={20} />}
          title={t('No quotes yet')}
          text={t('Write what you’ll do and what it costs. The {who} sees it in their shared space and accepts with one click.', { who: term.who })}
        />
      )}
      <div className="qt-list">
        {mine.map((q) => {
          const by = users.find((u) => u.id === q.createdBy);
          return (
            <article key={q.id} className={`qt-card st-${q.status}`}>
              <header>
                <strong>{q.title}</strong>
                <span className={`qt-status ${q.status}`}>{status(q.status)}</span>
                <span className="qt-amount">{money(quoteTotal(q), q.currency)}</span>
              </header>
              <p className="muted small">
                {[
                  tn(q.items.length, '{n} line', '{n} lines'),
                  by ? t('by {name}', { name: by.name.split(' ')[0] }) : '',
                  q.sentAt ? t('sent {when}', { when: relative(q.sentAt) }) : t('made {when}', { when: relative(q.createdAt) }),
                  q.status === 'accepted' && q.signature ? (q.signature === OUTSIDE ? t('agreed outside the app') : q.decidedAt ? t('signed “{name}” {when}', { name: q.signature, when: relative(q.decidedAt) }) : t('signed “{name}”', { name: q.signature })) : '',
                  q.status === 'declined' && q.note ? `“${q.note}”` : '',
                  q.validUntil && q.status === 'sent' ? t('valid until {date}', { date: day(q.validUntil) }) : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <div className="qt-actions">
                {q.status === 'draft' && canEdit && (
                  <>
                    <button type="button" className="ghost-btn sm" onClick={() => setEditing(structuredClone(q))}>
                      {t('Edit')}
                    </button>
                    <button type="button" className="primary-btn sm" disabled={!q.items.some((i) => i.title.trim())} onClick={() => onSend(q)}>
                      <Send size={13} /> {t('Send to {name}', { name: client.name })}
                    </button>
                  </>
                )}
                {q.status === 'sent' && canEdit && (
                  <button type="button" className="ghost-btn sm" onClick={() => onSave({ ...q, status: 'accepted', decidedAt: new Date().toISOString(), decidedBy: me, signature: OUTSIDE })}>
                    <Check size={13} /> {t('They agreed elsewhere')}
                  </button>
                )}
                {q.status === 'accepted' && !q.briefId && canEdit && (
                  <button type="button" className="primary-btn sm" onClick={() => onBrief(q)}>
                    <FileSignature size={13} /> {t('Turn into a brief')}
                  </button>
                )}
                {q.briefId && (
                  <button type="button" className="ghost-btn sm" onClick={() => onOpenBrief(q.briefId!)}>
                    {t('Open the brief')}
                  </button>
                )}
                {canEdit && (
                  <button type="button" className="icon-btn sm" title={t('Duplicate')} aria-label={t('Duplicate')} onClick={() => setEditing({ ...structuredClone(q), id: uid(), status: 'draft', createdAt: new Date().toISOString(), createdBy: me, sentAt: undefined, decidedAt: undefined, decidedBy: undefined, signature: undefined, note: undefined, briefId: undefined })}>
                    <Copy size={14} />
                  </button>
                )}
                {canEdit && q.status !== 'accepted' && (
                  <button type="button" className="icon-btn sm" title={t('Delete')} aria-label={t('Delete')} onClick={() => confirm(t('Delete “{title}”?', { title: q.title })) && onDelete(q.id)}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {editing && <QuoteEditor q={editing} client={client} onChange={setEditing} onSave={(q) => (onSave(q), setEditing(null))} onSend={(q) => (onSend(q), setEditing(null))} onClose={() => setEditing(null)} />}
    </div>
  );
}

function QuoteEditor({ q, client, onChange, onSave, onSend, onClose }: { q: Quote; client: Client; onChange: (q: Quote) => void; onSave: (q: Quote) => void; onSend: (q: Quote) => void; onClose: () => void }) {
  const set = (p: Partial<Quote>) => onChange({ ...q, ...p });
  const setItem = (id: string, p: Partial<Quote['items'][number]>) => set({ items: q.items.map((i) => (i.id === id ? { ...i, ...p } : i)) });
  const clean = (): Quote => ({ ...q, title: q.title.trim() || t('{name}: quote', { name: client.name }), items: q.items.filter((i) => i.title.trim()).map((i) => ({ ...i, title: i.title.trim(), qty: Math.max(1, i.qty || 1), price: Math.max(0, i.price || 0) })) });
  const ok = q.items.some((i) => i.title.trim());
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal qt-modal" role="dialog" aria-label={t('Quote')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="big-head">
          <FileSignature size={15} />
          <strong>{q.status === 'draft' && !q.sentAt ? t('Quote') : q.title}</strong>
          <span className="muted">{client.name}</span>
          <span className="spacer" />
          <button type="button" className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={16} />
          </button>
        </header>
        <div className="qt-body">
          <input className="title-input" autoFocus value={q.title} onChange={(e) => set({ title: e.target.value })} placeholder={t('What this is, e.g. Q4 campaign')} />
          <textarea className="qt-intro" rows={2} value={q.intro ?? ''} onChange={(e) => set({ intro: e.target.value })} placeholder={t('A few lines about the work (optional)')} />
          <div className="qt-grid">
            <span className="qt-gh">{t('What')}</span>
            <span className="qt-gh qt-num">{t('How many')}</span>
            <span className="qt-gh qt-num">{t('Each')}</span>
            <span className="qt-gh qt-num" title={t('When it becomes a task: due this many working days after the start')}>{t('Days')}</span>
            <span />
            {q.items.map((i) => (
              <div key={i.id} className="qt-row">
                <input value={i.title} onChange={(e) => setItem(i.id, { title: e.target.value })} placeholder={t('e.g. 4 short videos for Instagram')} />
                <input type="number" min={1} value={i.qty} onChange={(e) => setItem(i.id, { qty: Number(e.target.value) })} aria-label={t('How many')} />
                <input type="number" min={0} step={q.currency === 'IDR' ? 50000 : 10} value={i.price} onChange={(e) => setItem(i.id, { price: Number(e.target.value) })} aria-label={t('Price each')} />
                <input type="number" min={0} value={i.days ?? ''} onChange={(e) => setItem(i.id, { days: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="·" aria-label={t('Days')} />
                <button type="button" className="icon-btn sm" aria-label={t('Remove line')} disabled={q.items.length === 1} onClick={() => set({ items: q.items.filter((x) => x.id !== i.id) })}>
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          <div className="qt-foot-row">
            <button type="button" className="link-btn small" onClick={() => set({ items: [...q.items, { id: uid(), title: '', qty: 1, price: 0 }] })}>
              <Plus size={13} /> {t('Add a line')}
            </button>
            <span className="spacer" />
            <strong>{t('Total {amount}', { amount: money(quoteTotal(q), q.currency) })}</strong>
          </div>
          <div className="qt-opts">
            <label className="team-field">
              <span>{t('Currency')}</span>
              <Select<Quote['currency']> value={q.currency} onChange={(v) => set({ currency: v })} label={t('Currency')} className="sel-flat" options={[{ value: 'IDR', label: t('Rupiah (IDR)') }, { value: 'USD', label: t('US dollars (USD)') }]} />
            </label>
            <label className="team-field">
              <span>{t('Valid until')}</span>
              <DatePicker value={q.validUntil ?? ''} onChange={(d) => set({ validUntil: d || undefined })} label={t('Valid until')} placeholder={t('No end date')} className="sel-flat" />
            </label>
          </div>
          <textarea className="qt-terms" rows={3} value={q.terms ?? ''} onChange={(e) => set({ terms: e.target.value })} placeholder={t('Terms: payment (e.g. 50% to start, 50% on delivery), what’s included, revisions, timeline')} />
        </div>
        <footer className="modal-foot">
          <button type="button" className="ghost-btn sm" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="ghost-btn sm" disabled={!ok} onClick={() => onSave(clean())}>
            {t('Save draft')}
          </button>
          <button type="button" className="primary-btn sm" disabled={!ok} onClick={() => onSend(clean())}>
            <Send size={13} /> {t('Send to {name}', { name: client.name })}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** What the guest sees: quotes waiting for them (accept by typing their name, or decline with a note), then past ones. */
export function GuestQuotes({ quotes, company, canApprove, onDecide }: { quotes: Quote[]; company: string; canApprove: boolean; onDecide: (id: string, status: 'accepted' | 'declined', text: string) => void }) {
  const [name, setName] = useState<Record<string, string>>({});
  const [declining, setDeclining] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const open = quotes.filter((q) => q.status === 'sent');
  const past = quotes.filter((q) => q.status === 'accepted' || q.status === 'declined');
  if (!open.length && !past.length) return null;
  return (
    <div className="gq">
      {open.map((q) => {
        const expired = !!q.validUntil && q.validUntil < localDay();
        return (
          <article key={q.id} className="gq-card side-card">
            <h3>
              <FileSignature size={15} /> {q.title}
            </h3>
            <p className="muted small">{[q.sentAt ? t('From {company}, {when}', { company, when: relative(q.sentAt) }) : t('From {company}', { company }), q.validUntil ? t('valid until {date}', { date: day(q.validUntil) }) : ''].filter(Boolean).join(' · ')}</p>
            {q.intro && <p className="gq-intro">{q.intro}</p>}
            <QuoteLines q={q} />
            {q.terms && (
              <p className="gq-terms">
                <b>{t('Terms')}</b>
                <br />
                {q.terms}
              </p>
            )}
            {canApprove ? (
              expired ? (
                <p className="muted small">{t('This quote has passed its date. Ask {company} for a new one.', { company })}</p>
              ) : declining === q.id ? (
                <div className="gq-decide">
                  <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('What should change? (optional)')} />
                  <div className="gq-btns">
                    <button type="button" className="ghost-btn sm" onClick={() => setDeclining(null)}>
                      {t('Back')}
                    </button>
                    <button type="button" className="primary-btn sm" onClick={() => (onDecide(q.id, 'declined', note.trim()), setDeclining(null), setNote(''))}>
                      {t('Decline')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="gq-decide">
                  <label className="gq-sign">
                    <span>{t('Type your full name to accept')}</span>
                    <input value={name[q.id] ?? ''} onChange={(e) => setName({ ...name, [q.id]: e.target.value })} placeholder={t('Your name')} />
                  </label>
                  <div className="gq-btns">
                    <button type="button" className="ghost-btn sm" onClick={() => setDeclining(q.id)}>
                      {t('Decline')}
                    </button>
                    <button type="button" className="primary-btn sm" disabled={(name[q.id] ?? '').trim().length < 3} onClick={() => onDecide(q.id, 'accepted', (name[q.id] ?? '').trim())}>
                      <Check size={13} /> {t('Accept')}
                    </button>
                  </div>
                  <small className="muted">{t('Accepting means you agree to the lines and terms above. {company} is told straight away.', { company })}</small>
                </div>
              )
            ) : (
              <p className="muted small">{t('Someone with approval rights at your company can accept this.')}</p>
            )}
          </article>
        );
      })}
      {past.map((q) => (
        <article key={q.id} className={`gq-card side-card past ${q.status}`}>
          <h3>
            <FileSignature size={15} /> {q.title}
            <span className={`qt-status ${q.status}`}>{status(q.status)}</span>
          </h3>
          <p className="muted small">
            {[
              money(quoteTotal(q), q.currency),
              q.decidedAt ? (q.status === 'accepted' ? t('accepted {when}', { when: relative(q.decidedAt) }) : t('declined {when}', { when: relative(q.decidedAt) })) : '',
              q.signature ? (q.signature === OUTSIDE ? t('agreed outside the app') : t('signed “{name}”', { name: q.signature })) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </article>
      ))}
    </div>
  );
}
