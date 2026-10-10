import { useEffect, useState, type ReactNode } from 'react';
import { Check, Download, Infinity as InfinityIcon, Sparkles, Zap, HardDrive, ChevronRight } from 'lucide-react';
import { server } from '../../sync';
import type { User, Workspace } from '../../types';
import { Badge, PersonCell } from '../ui/Person';
import { Sheet } from '../ui/Sheet';
import { SmoothHeight } from '../ui/Smooth';
import { brand as product } from '../../terms';
import { t } from '../../i18n';
import { fmtDate, fmtMoney, fmtNumber, fmtPercent } from '../../i18n/format';

type Unit = 'usd' | 'rp';
interface Rule {
  userId: string;
  ai: number | null;
  storageGB: number | null;
  aiOn: boolean;
  notetaker: boolean;
  boosted: boolean;
}
interface View {
  aiUnit: Unit;
  ai: { limit: number; used: number; paused: boolean };
  ses: { limit: number; used: number; paused: boolean };
  storage: { used: number; total: number; reserveReached: boolean };
  resets: string;
  people: { userId: string; rule: Rule | null; aiUsed: number; storageUsed: number }[];
  canManage: boolean;
}

const GB = 1024 ** 3;
/** "US$12.50" or "Rp 200.000". */
const money = (n: number, unit: Unit) => (unit === 'rp' ? fmtMoney(Math.round(n)) : `US$${fmtNumber(n, { maximumFractionDigits: 2, minimumFractionDigits: n > 0 && n < 100 && n % 1 ? 2 : 0 })}`);
const size = (n: number) => (n >= GB ? `${fmtNumber(n / GB, { maximumFractionDigits: n >= 100 * GB ? 0 : 1 })} GB` : `${fmtNumber(Math.max(0, Math.round(n / 1024 ** 2)))} MB`);
const day = (iso: string) => fmtDate(iso, { day: 'numeric', month: 'long' });

/** One monthly limit: what's used of it, as a bar that warns at 80% and is full at 100%. */
function Limit({ icon, title, used, limit, share, paused, resets }: { icon: ReactNode; title: string; used: string; limit: string; share: number; paused: boolean; resets: string }) {
  const tone = share >= 1 ? 'full' : share >= 0.8 ? 'warn' : '';
  return (
    <div className={`unl-limit ${tone}`}>
      <span className="unl-limit-head">
        {icon}
        <strong>{title}</strong>
        <span className="unl-limit-num">{t('{used} of {limit}', { used, limit })}</span>
      </span>
      <span className="unl-bar" role="meter" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, share) * 100)}>
        <span style={{ width: `${Math.min(100, share * 100)}%` }} />
      </span>
      <small>{paused ? t('Used up for this month: paused until {date}. Everything else keeps working.', { date: day(resets) }) : share >= 0.8 ? t('{share} used. It starts again on {date}.', { share: fmtPercent(Math.min(1, share)), date: day(resets) }) : t('Starts again on {date}.', { date: day(resets) })}</small>
    </div>
  );
}

/**
 * Settings, Plan & billing for a company on Unlimited (the operators' Whitelist): what's included, the two monthly
 * limits and what's used, and (owners and admins) each person's rules: a share of AI, a storage cap, and the notetaker,
 * Boosted sending and AI on or off. People without a rule share what's left.
 */
export function UnlimitedSection({ ws, users, me, canManage, onExport, toast }: { ws: Workspace; users: User[]; me: string; canManage: boolean; onExport: () => void; toast: (text: string) => void }) {
  const [view, setView] = useState<View | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => {
    if (!server.on) return;
    let on = true;
    fetch(`/api/unlimited?ws=${encodeURIComponent(ws.id)}`)
      .then((r) => (r.ok ? (r.json() as Promise<View>) : Promise.reject()))
      .then((v) => on && (setView(v), setFailed(false)), () => on && setFailed(true));
    return () => {
      on = false;
    };
  }, [ws.id, ws]);
  const unit = view?.aiUnit ?? 'usd';
  const mine = view?.people.find((p) => p.userId === me);
  const person = (id: string) => users.find((u) => u.id === id);
  const ruleWords = (p: View['people'][number]) => {
    const r = p.rule;
    const parts: string[] = [];
    parts.push(r?.ai !== null && r?.ai !== undefined ? t('AI {used} of {share}', { used: money(p.aiUsed, unit), share: money(r.ai, unit) }) : t('AI {used}, from what’s shared', { used: money(p.aiUsed, unit) }));
    parts.push(r?.storageGB ? t('{used} of {cap} storage', { used: size(p.storageUsed), cap: `${fmtNumber(r.storageGB)} GB` }) : t('{used} storage', { used: size(p.storageUsed) }));
    return parts.join(' · ');
  };
  const offWords = (r: Rule | null) => [r && !r.aiOn && t('AI off'), r && !r.notetaker && t('Notetaker off'), r && !r.boosted && t('Boosted off')].filter(Boolean) as string[];
  const editingPerson = editing ? view?.people.find((p) => p.userId === editing) : null;

  return (
    <>
      <h2>{t('Plan & billing')}</h2>
      <p className="set-intro">{t('{company} is on Unlimited: every feature, with nothing to pay and no plan limits.', { company: ws.name })}</p>

      <div className="plan-card unl-card">
        <div className="pc-main">
          <span className="pc-kicker">{t('Current plan')}</span>
          <h3>
            <InfinityIcon size={20} /> {t('Unlimited')}
          </h3>
          <p className="muted">{t('No limit on people, mailboxes, meeting-bot hours or imports. Never billed.')}</p>
        </div>
        <div className="pc-price">
          <b>Rp 0</b>
          <small>{t('no invoices')}</small>
        </div>
      </div>

      <div className="set-block">
        <h3>{t('What’s included')}</h3>
        <ul className="unl-included">
          <li>
            <Check size={15} /> {t('Every app and every add-on, including your own address for guests without “Made with {product}”', { product: product.name })}
          </li>
          <li>
            <Check size={15} /> {t('As many people, guests and hosted mailboxes as you need')}
          </li>
          <li>
            <Check size={15} /> {t('The notetaker with no hour limit')}
          </li>
          <li>
            <Check size={15} /> {t('AI included, up to the monthly limit below')}
          </li>
          <li>
            <Check size={15} /> {t('Boosted sending, up to the monthly limit below')}
          </li>
          <li>
            <Check size={15} /> {view ? t('Drive storage as the server has room: {left} free now', { left: size(Math.max(0, view.storage.total - view.storage.used)) }) : t('Drive storage as the server has room')}
          </li>
        </ul>
      </div>

      <div className="set-block">
        <h3>{t('This month')}</h3>
        <SmoothHeight>
          {view ? (
            <div className="unl-limits">
              <Limit icon={<Sparkles size={15} />} title={t('AI')} used={money(view.ai.used, unit)} limit={money(view.ai.limit, unit)} share={view.ai.limit > 0 ? view.ai.used / view.ai.limit : 1} paused={view.ai.paused} resets={view.resets} />
              <Limit icon={<Zap size={15} />} title={t('Boosted sending')} used={fmtNumber(view.ses.used)} limit={t('{n} emails', { n: fmtNumber(view.ses.limit) })} share={view.ses.limit > 0 ? view.ses.used / view.ses.limit : 1} paused={view.ses.paused} resets={view.resets} />
              <div className="unl-limit">
                <span className="unl-limit-head">
                  <HardDrive size={15} />
                  <strong>{t('Storage')}</strong>
                  <span className="unl-limit-num">{t('{used} used', { used: size(view.storage.used) })}</span>
                </span>
                <small>{view.storage.reserveReached ? t('The server is nearly full, so uploads are stopped for now. We’ve been told and are making room.') : t('No limit of its own: as much as the server has room for.')}</small>
              </div>
            </div>
          ) : failed || !server.on ? (
            <p className="muted small">{t('The monthly limits show here once they can be read. Try again in a moment.')}</p>
          ) : (
            <div className="lazy-wait" aria-hidden />
          )}
        </SmoothHeight>
        {view && <p className="muted small unl-foot">{t('Past a limit only that part pauses until the 1st; everything else keeps working. Ask us if you need more.')}</p>}
      </div>

      {view && !view.canManage && mine?.rule && (
        <div className="set-block">
          <h3>{t('Yours')}</h3>
          <p className="small">{ruleWords(mine)}</p>
          {offWords(mine.rule).length > 0 && <p className="muted small">{t('Switched off for you: {what}. Ask your admin.', { what: offWords(mine.rule).join(', ') })}</p>}
        </div>
      )}

      {view?.canManage && canManage && (
        <div className="set-block">
          <h3>{t('People')}</h3>
          <div className="unl-people">
            {view.people
              .map((p) => ({ p, u: person(p.userId) }))
              .filter((x) => !!x.u)
              .map(({ p, u }) => (
                <button key={p.userId} type="button" className="unl-person" onClick={() => setEditing(p.userId)}>
                  <PersonCell person={u!} sub={ruleWords(p)} badges={offWords(p.rule).map((w) => <Badge key={w} small>{w}</Badge>)} />
                  <ChevronRight size={16} className="unl-go" />
                </button>
              ))}
          </div>
          <p className="muted small unl-foot">{t('Split what the company has: a share of AI or a storage cap for someone, or the notetaker, Boosted sending or AI off for them. Everyone without a rule shares what’s left.')}</p>
        </div>
      )}

      <div className="set-block">
        <div className="set-row">
          <span>
            <strong>{t('Your data')}</strong>
            <small>{t('Everything the company has, to keep a copy.')}</small>
          </span>
          <button type="button" className="ghost-btn sm" onClick={onExport}>
            <Download size={13} /> {t('Export everything')}
          </button>
        </div>
      </div>

      {editingPerson && view && (
        <RulesSheet
          key={editingPerson.userId}
          ws={ws}
          view={view}
          person={editingPerson}
          name={person(editingPerson.userId)?.name ?? ''}
          onClose={() => setEditing(null)}
          onSaved={(v) => (setView((x) => (x ? { ...x, ...v } : x)), setEditing(null), toast(t('Saved. It applies at once.')))}
        />
      )}
    </>
  );
}

/** One person's rules, in a sheet (a centred panel on wider screens). */
function RulesSheet({ ws, view, person, name, onClose, onSaved }: { ws: Workspace; view: View; person: View['people'][number]; name: string; onClose: () => void; onSaved: (v: Partial<View>) => void }) {
  const r = person.rule;
  const unit = view.aiUnit;
  const [ai, setAi] = useState(r?.ai !== null && r?.ai !== undefined ? String(r.ai) : '');
  const [storage, setStorage] = useState(r?.storageGB ? String(r.storageGB) : '');
  const [aiOn, setAiOn] = useState(r?.aiOn ?? true);
  const [notetaker, setNotetaker] = useState(r?.notetaker ?? true);
  const [boosted, setBoosted] = useState(r?.boosted ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const others = view.people.filter((p) => p.userId !== person.userId);
  const sharedAI = others.reduce((n, p) => n + (p.rule?.ai ?? 0), 0);
  const aiRoom = Math.max(0, view.ai.limit - sharedAI);
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/\./g, unit === 'rp' ? '' : '.').replace(',', '.')));
  const save = async () => {
    setBusy(true);
    setError('');
    const rules = [...view.people.filter((p) => p.rule && p.userId !== person.userId).map((p) => p.rule!), { userId: person.userId, ai: num(ai), storageGB: num(storage), aiOn, notetaker, boosted }];
    const res = await fetch('/api/unlimited/rules', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, rules }) }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError((d as { error?: string }).error ? t((d as { error: string }).error) : t('That didn’t save. Try again.'));
    onSaved(d as Partial<View>);
  };
  const toggle = (on: boolean, set: (v: boolean) => void, label: string, hint: string) => (
    <div className="set-row">
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={() => set(!on)}>
        <span />
      </button>
    </div>
  );
  return (
    <Sheet
      title={t('Rules for {name}', { name })}
      onClose={onClose}
      className="unl-sheet"
      footer={
        <div className="unl-sheet-foot">
          <button type="button" className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="primary-btn" disabled={busy} onClick={() => void save()}>
            {busy ? t('Saving…') : t('Save')}
          </button>
        </div>
      }
    >
      <div className="unl-rules">
        <label className="unl-field">
          <span>{t('AI a month')}</span>
          <span className="unl-input">
            <em>{unit === 'rp' ? 'Rp' : 'US$'}</em>
            <input inputMode="decimal" value={ai} onChange={(e) => setAi(e.target.value.replace(/[^\d.,]/g, ''))} placeholder={t('Shares what’s left')} aria-label={t('AI a month')} />
          </span>
          <small>{t('Up to {room} is free to give. Used this month: {used}.', { room: money(aiRoom, unit), used: money(person.aiUsed, unit) })}</small>
        </label>
        <label className="unl-field">
          <span>{t('Storage cap')}</span>
          <span className="unl-input">
            <input inputMode="decimal" value={storage} onChange={(e) => setStorage(e.target.value.replace(/[^\d.,]/g, ''))} placeholder={t('Shares what’s left')} aria-label={t('Storage cap')} />
            <em>GB</em>
          </span>
          <small>{t('Uses {used} now.', { used: size(person.storageUsed) })}</small>
        </label>
        {toggle(aiOn, setAiOn, t('AI'), t('Ask AI, summaries, drafts and the rest'))}
        {toggle(notetaker, setNotetaker, t('Notetaker'), t('Sending the meeting bot, by hand or from the calendar'))}
        {toggle(boosted, setBoosted, t('Boosted sending'), t('When off, their mail goes out from our server'))}
        {error && <p className="err small">{error}</p>}
      </div>
    </Sheet>
  );
}
