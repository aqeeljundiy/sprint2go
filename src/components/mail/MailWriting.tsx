// Settings, Mail & signature: a signature for each address you send from (a mailbox or an alias; switching From in
// Compose switches it), smart compose on or off, and whether Reply answers the sender or everyone. Desktop and phone.
import { useState } from 'react';
import type { Settings } from '../../settings';
import type { Workspace } from '../../types';
import { RichEditor } from '../RichEditor';
import { Select } from '../ui/Select';
import { SmoothHeight } from '../ui/Smooth';
import { EditScreen, GRow, Group, ChoiceRow, SwitchRow } from '../ui/Grouped';
import { sendersOf } from './composeExtras';
import { t } from '../../i18n';

/** The addresses this person sends from: each mailbox of theirs, then its aliases. */
export function myAddresses(ws: Workspace, me: string): string[] {
  const boxes = ws.accounts.filter((a) => a.users.includes(me) && (!a.provider || a.provider === 'sprint2go' || a.connected));
  return [...new Set(boxes.flatMap((a) => sendersOf(ws, a)))];
}

const textOf = (html: string) => {
  const d = document.createElement('div');
  d.innerHTML = html.replace(/<(br|\/div|\/p|\/li)[^>]*>/gi, ' $&');
  return (d.textContent ?? '').replace(/\s+/g, ' ').trim();
};
/** An address's own signature, or nothing (it uses the default). */
const own = (s: Settings, addr: string) => (s.signatures && addr in s.signatures ? s.signatures[addr] : undefined);
const withOwn = (s: Settings, addr: string, html: string | undefined) => {
  const next = { ...(s.signatures ?? {}) };
  if (html === undefined) delete next[addr];
  else next[addr] = html;
  return { signatures: next };
};

/** Desktop: the signature editor, with a picker for which address it's for when there are several. */
export function SignaturesDesktop({ s, update, ws, me }: { s: Settings; update: (p: Partial<Settings>) => void; ws: Workspace; me: string }) {
  const addresses = myAddresses(ws, me);
  const [addr, setAddr] = useState('');
  const mine = addr ? own(s, addr) : undefined;
  return (
    <>
      {addresses.length > 1 && (
        <div className="sig-for">
          <span>{t('Signature for')}</span>
          <Select value={addr} onChange={setAddr} label={t('Signature for')} className="sel-flat" width={320} options={[{ value: '', label: t('Every address (default)') }, ...addresses.map((a) => ({ value: a, label: a, hint: own(s, a) !== undefined ? t('Own signature') : undefined }))]} />
        </div>
      )}
      <SmoothHeight>
      {addr && mine === undefined ? (
        <div className="set-row sig-default">
          <span>
            <strong>{t('Uses the default signature')}</strong>
            <small>{textOf(s.signature) || t('None')}</small>
          </span>
          <button type="button" className="ghost-btn outline sm" onClick={() => update(withOwn(s, addr, s.signature))}>
            {t('Write one for this address')}
          </button>
        </div>
      ) : (
        <div className="signature-box" key={addr || 'default'}>
          <RichEditor initialHtml={addr ? (mine ?? '') : s.signature} placeholder={addr ? t('The signature for {address}', { address: addr }) : t('Your signature')} onChange={(html) => update(addr ? withOwn(s, addr, html) : { signature: html })} />
        </div>
      )}
      {addr && mine !== undefined && (
        <button type="button" className="link-btn sig-reset" onClick={() => update(withOwn(s, addr, undefined))}>
          {t('Use the default signature for {address}', { address: addr })}
        </button>
      )}
      </SmoothHeight>
    </>
  );
}

/** Desktop: smart compose and the default reply. */
export function WritingDesktop({ s, update }: { s: Settings; update: (p: Partial<Settings>) => void }) {
  const smart = s.smartCompose !== false;
  return (
    <>
      <h3>{t('Writing')}</h3>
      <label className="set-row toggle-row">
        <span>
          <strong>{t('Smart compose')}</strong>
          <small>{t('Suggests the next words as you write; press Tab (or tap them on a phone) to take them. Uses your company’s AI when it’s on, everyday phrases when it isn’t.')}</small>
        </span>
        <button type="button" role="switch" aria-checked={smart} className={`switch ${smart ? 'on' : ''}`} onClick={() => update({ smartCompose: !smart })} aria-label={t('Smart compose')}>
          <span />
        </button>
      </label>
      <div className="set-row">
        <span>
          <strong>{t('Default reply')}</strong>
          <small>{t('What the main reply button and R do when an email went to several people.')}</small>
        </span>
        <div className="segmented">
          {(['reply', 'all'] as const).map((k) => (
            <button key={k} type="button" className={(s.defaultReply ?? 'reply') === k ? 'on' : ''} onClick={() => update({ defaultReply: k })}>
              {k === 'all' ? t('Reply all') : t('Reply')}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/** Phones: a row per address (and the default), each opening its editor on a screen of its own. */
export function SignaturesPhone({ s, update, ws, me }: { s: Settings; update: (p: Partial<Settings>) => void; ws: Workspace; me: string }) {
  const addresses = myAddresses(ws, me);
  const [open, setOpen] = useState<string | null>(null); // '' is the default
  return (
    <>
      <Group title={addresses.length > 1 ? t('Signatures') : undefined} footer={addresses.length > 1 ? t('Each address can have its own. Switching From in a new email switches the signature.') : t('Added to the end of every new email and reply.')}>
        <GRow label={addresses.length > 1 ? t('Default signature') : t('Signature')} value={textOf(s.signature) || t('None')} onClick={() => setOpen('')} />
        {addresses.length > 1 &&
          addresses.map((a) => {
            const html = own(s, a);
            return <GRow key={a} label={a} value={html === undefined ? t('Default') : textOf(html) || t('None')} onClick={() => setOpen(a)} />;
          })}
      </Group>
      {open !== null && <SignatureEdit s={s} addr={open} onSave={(html) => update(open ? withOwn(s, open, html) : { signature: html ?? '' })} onBack={() => setOpen(null)} />}
    </>
  );
}

function SignatureEdit({ s, addr, onSave, onBack }: { s: Settings; addr: string; onSave: (html: string | undefined) => void; onBack: () => void }) {
  const start = addr ? (own(s, addr) ?? s.signature) : s.signature;
  const [v, setV] = useState(start);
  const [useDefault, setUseDefault] = useState(!!addr && own(s, addr) === undefined);
  const before = addr ? own(s, addr) : s.signature;
  const after = useDefault ? undefined : v;
  return (
    <EditScreen title={addr ? t('Signature') : t('Default signature')} onBack={onBack} canSave={after !== before} onSave={() => onSave(after)}>
      {addr && (
        <Group>
          <SwitchRow label={t('Use the default signature')} on={useDefault} onChange={setUseDefault} />
        </Group>
      )}
      {!useDefault && (
        <div className="signature-box set-sig">
          <RichEditor initialHtml={start} placeholder={t('Your signature')} onChange={setV} autoFocus />
        </div>
      )}
      <p className="g-foot">{addr ? t('Added to new emails and replies from {address}.', { address: addr }) : t('Added to the end of every new email and reply.')}</p>
    </EditScreen>
  );
}

/** Phones: smart compose and the default reply, as rows. */
export function WritingPhone({ s, update }: { s: Settings; update: (p: Partial<Settings>) => void }) {
  return (
    <Group title={t('Writing')} footer={t('Smart compose suggests the next words as you write; tap them to take them.')}>
      <SwitchRow label={t('Smart compose')} on={s.smartCompose !== false} onChange={(v) => update({ smartCompose: v })} />
      <ChoiceRow label={t('Default reply')} value={s.defaultReply ?? 'reply'} onChange={(v) => update({ defaultReply: v as 'reply' | 'all' })} options={[{ value: 'reply', label: t('Reply') }, { value: 'all', label: t('Reply all') }]} />
    </Group>
  );
}
