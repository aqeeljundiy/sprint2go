import { useState } from 'react';
import { Check, Copy, FileSignature, Plus, Send, Trash2, X } from 'lucide-react';
import type { Client, Quote, User } from '../types';
import { term } from '../terms';
import { localDay, relative, uid } from '../utils';
import { DatePicker } from './ui/DatePicker';
import { Select } from './ui/Select';

export const money = (n: number, cur: Quote['currency']) => (cur === 'IDR' ? `Rp ${Math.round(n).toLocaleString('id-ID')}` : `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
export const quoteTotal = (q: Pick<Quote, 'items'>) => q.items.reduce((a, i) => a + i.qty * i.price, 0);
const STATUS: Record<Quote['status'], string> = { draft: 'Draft', sent: 'Waiting for their answer', accepted: 'Accepted', declined: 'Declined' };
const day = (d: string) => new Date(`${d.slice(0, 10)}T12:00`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

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
          <td>Total</td>
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
  const blank = (): Quote => ({ id: uid(), workspaceId: client.workspaceId, clientId: client.id, title: `${client.name}: quote`, items: [{ id: uid(), title: '', qty: 1, price: 0 }], currency: 'IDR', status: 'draft', createdBy: me, createdAt: new Date().toISOString() });
  return (
    <div className="qt-tab">
      <div className="qt-head">
        <p className="muted small">A quote or contract the {term.who} accepts by typing their name. Once accepted, it becomes a brief with one task per line.</p>
        {canEdit && (
          <button type="button" className="primary-btn sm" onClick={() => setEditing(blank())}>
            <Plus size={14} /> New quote
          </button>
        )}
      </div>
      {!mine.length && (
        <div className="empty">
          <div className="empty-art">
            <FileSignature size={20} />
          </div>
          <p className="empty-title">No quotes yet</p>
          <p className="empty-sub">Write what you’ll do and what it costs. The {term.who} sees it in their shared space and accepts with one click.</p>
        </div>
      )}
      <div className="qt-list">
        {mine.map((q) => {
          const by = users.find((u) => u.id === q.createdBy);
          return (
            <article key={q.id} className={`qt-card st-${q.status}`}>
              <header>
                <strong>{q.title}</strong>
                <span className={`qt-status ${q.status}`}>{STATUS[q.status]}</span>
                <span className="qt-amount">{money(quoteTotal(q), q.currency)}</span>
              </header>
              <p className="muted small">
                {q.items.length} {q.items.length === 1 ? 'line' : 'lines'}
                {by ? ` · by ${by.name.split(' ')[0]}` : ''}
                {q.sentAt ? ` · sent ${relative(q.sentAt)}` : ` · made ${relative(q.createdAt)}`}
                {q.status === 'accepted' && q.signature ? ` · signed “${q.signature}”${q.decidedAt ? ` ${relative(q.decidedAt)}` : ''}` : ''}
                {q.status === 'declined' && q.note ? ` · “${q.note}”` : ''}
                {q.validUntil && q.status === 'sent' ? ` · valid until ${day(q.validUntil)}` : ''}
              </p>
              <div className="qt-actions">
                {q.status === 'draft' && canEdit && (
                  <>
                    <button type="button" className="ghost-btn sm" onClick={() => setEditing(structuredClone(q))}>
                      Edit
                    </button>
                    <button type="button" className="primary-btn sm" disabled={!q.items.some((i) => i.title.trim())} onClick={() => onSend(q)}>
                      <Send size={13} /> Send to {client.name}
                    </button>
                  </>
                )}
                {q.status === 'sent' && canEdit && (
                  <button type="button" className="ghost-btn sm" onClick={() => onSave({ ...q, status: 'accepted', decidedAt: new Date().toISOString(), decidedBy: me, signature: 'Agreed outside the app' })}>
                    <Check size={13} /> They agreed elsewhere
                  </button>
                )}
                {q.status === 'accepted' && !q.briefId && canEdit && (
                  <button type="button" className="primary-btn sm" onClick={() => onBrief(q)}>
                    <FileSignature size={13} /> Turn into a brief
                  </button>
                )}
                {q.briefId && (
                  <button type="button" className="ghost-btn sm" onClick={() => onOpenBrief(q.briefId!)}>
                    Open the brief
                  </button>
                )}
                {canEdit && (
                  <button type="button" className="icon-btn sm" title="Duplicate" onClick={() => setEditing({ ...structuredClone(q), id: uid(), status: 'draft', createdAt: new Date().toISOString(), createdBy: me, sentAt: undefined, decidedAt: undefined, decidedBy: undefined, signature: undefined, note: undefined, briefId: undefined })}>
                    <Copy size={14} />
                  </button>
                )}
                {canEdit && q.status !== 'accepted' && (
                  <button type="button" className="icon-btn sm" title="Delete" onClick={() => confirm(`Delete “${q.title}”?`) && onDelete(q.id)}>
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
  const clean = (): Quote => ({ ...q, title: q.title.trim() || `${client.name}: quote`, items: q.items.filter((i) => i.title.trim()).map((i) => ({ ...i, title: i.title.trim(), qty: Math.max(1, i.qty || 1), price: Math.max(0, i.price || 0) })) });
  const ok = q.items.some((i) => i.title.trim());
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal qt-modal" role="dialog" aria-label="Quote" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="big-head">
          <FileSignature size={15} />
          <strong>{q.status === 'draft' && !q.sentAt ? 'Quote' : q.title}</strong>
          <span className="muted">{client.name}</span>
          <span className="spacer" />
          <button type="button" className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="qt-body">
          <input className="title-input" autoFocus value={q.title} onChange={(e) => set({ title: e.target.value })} placeholder="What this is, e.g. Q4 campaign" />
          <textarea className="qt-intro" rows={2} value={q.intro ?? ''} onChange={(e) => set({ intro: e.target.value })} placeholder="A few lines about the work (optional)" />
          <div className="qt-grid">
            <span className="qt-gh">What</span>
            <span className="qt-gh qt-num">How many</span>
            <span className="qt-gh qt-num">Each</span>
            <span className="qt-gh qt-num" title="When it becomes a task: due this many working days after the start">Days</span>
            <span />
            {q.items.map((i) => (
              <div key={i.id} className="qt-row">
                <input value={i.title} onChange={(e) => setItem(i.id, { title: e.target.value })} placeholder="e.g. 4 short videos for Instagram" />
                <input type="number" min={1} value={i.qty} onChange={(e) => setItem(i.id, { qty: Number(e.target.value) })} aria-label="How many" />
                <input type="number" min={0} step={q.currency === 'IDR' ? 50000 : 10} value={i.price} onChange={(e) => setItem(i.id, { price: Number(e.target.value) })} aria-label="Price each" />
                <input type="number" min={0} value={i.days ?? ''} onChange={(e) => setItem(i.id, { days: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="–" aria-label="Days" />
                <button type="button" className="icon-btn sm" aria-label="Remove line" disabled={q.items.length === 1} onClick={() => set({ items: q.items.filter((x) => x.id !== i.id) })}>
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          <div className="qt-foot-row">
            <button type="button" className="link-btn small" onClick={() => set({ items: [...q.items, { id: uid(), title: '', qty: 1, price: 0 }] })}>
              <Plus size={13} /> Add a line
            </button>
            <span className="spacer" />
            <strong>Total {money(quoteTotal(q), q.currency)}</strong>
          </div>
          <div className="qt-opts">
            <label className="team-field">
              <span>Currency</span>
              <Select<Quote['currency']> value={q.currency} onChange={(v) => set({ currency: v })} label="Currency" className="sel-flat" options={[{ value: 'IDR', label: 'Rupiah (IDR)' }, { value: 'USD', label: 'US dollars (USD)' }]} />
            </label>
            <label className="team-field">
              <span>Valid until</span>
              <DatePicker value={q.validUntil ?? ''} onChange={(d) => set({ validUntil: d || undefined })} label="Valid until" placeholder="No end date" className="sel-flat" />
            </label>
          </div>
          <textarea className="qt-terms" rows={3} value={q.terms ?? ''} onChange={(e) => set({ terms: e.target.value })} placeholder="Terms: payment (e.g. 50% to start, 50% on delivery), what’s included, revisions, timeline" />
        </div>
        <footer className="modal-foot">
          <button type="button" className="ghost-btn sm" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ghost-btn sm" disabled={!ok} onClick={() => onSave(clean())}>
            Save draft
          </button>
          <button type="button" className="primary-btn sm" disabled={!ok} onClick={() => onSend(clean())}>
            <Send size={13} /> Send to {client.name}
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
            <p className="muted small">From {company}{q.sentAt ? `, ${relative(q.sentAt)}` : ''}{q.validUntil ? ` · valid until ${day(q.validUntil)}` : ''}</p>
            {q.intro && <p className="gq-intro">{q.intro}</p>}
            <QuoteLines q={q} />
            {q.terms && (
              <p className="gq-terms">
                <b>Terms</b>
                <br />
                {q.terms}
              </p>
            )}
            {canApprove ? (
              expired ? (
                <p className="muted small">This quote has passed its date. Ask {company} for a new one.</p>
              ) : declining === q.id ? (
                <div className="gq-decide">
                  <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should change? (optional)" />
                  <div className="gq-btns">
                    <button type="button" className="ghost-btn sm" onClick={() => setDeclining(null)}>
                      Back
                    </button>
                    <button type="button" className="primary-btn sm" onClick={() => (onDecide(q.id, 'declined', note.trim()), setDeclining(null), setNote(''))}>
                      Decline
                    </button>
                  </div>
                </div>
              ) : (
                <div className="gq-decide">
                  <label className="gq-sign">
                    <span>Type your full name to accept</span>
                    <input value={name[q.id] ?? ''} onChange={(e) => setName({ ...name, [q.id]: e.target.value })} placeholder="Your name" />
                  </label>
                  <div className="gq-btns">
                    <button type="button" className="ghost-btn sm" onClick={() => setDeclining(q.id)}>
                      Decline
                    </button>
                    <button type="button" className="primary-btn sm" disabled={(name[q.id] ?? '').trim().length < 3} onClick={() => onDecide(q.id, 'accepted', (name[q.id] ?? '').trim())}>
                      <Check size={13} /> Accept
                    </button>
                  </div>
                  <small className="muted">Accepting means you agree to the lines and terms above. {company} is told straight away.</small>
                </div>
              )
            ) : (
              <p className="muted small">Someone with approval rights at your company can accept this.</p>
            )}
          </article>
        );
      })}
      {past.map((q) => (
        <article key={q.id} className={`gq-card side-card past ${q.status}`}>
          <h3>
            <FileSignature size={15} /> {q.title}
            <span className={`qt-status ${q.status}`}>{STATUS[q.status]}</span>
          </h3>
          <p className="muted small">
            {money(quoteTotal(q), q.currency)}
            {q.decidedAt ? ` · ${q.status === 'accepted' ? 'accepted' : 'declined'} ${relative(q.decidedAt)}` : ''}
            {q.signature ? ` · signed “${q.signature}”` : ''}
          </p>
        </article>
      ))}
    </div>
  );
}
