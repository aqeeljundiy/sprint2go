import type { ReactNode } from 'react';
import { term } from '../../terms';
import { RotateCcw } from 'lucide-react';
import { DEFAULT_CLIENT_ACCESS, type ClientAccess, type Team } from '../../types';
import { Select } from '../ui/Select';
import { t } from '../../i18n';
import { usePhone } from '../../mobile/media';
import { ChoiceRow, TextRow } from '../ui/Grouped';

type Key = keyof ClientAccess;

// Getters, so the words are read in the person's language (and the company's words) each time (docs/i18n.md).
const LABEL: Record<Key, [string, string]> = {
  get teamNames() { return [t('Show who’s doing the work'), t('On tasks, requests and in chat')] as [string, string]; },
  get requests() { return [t('Requests'), t('{Whos} send requests that land in your team’s queue, like tickets', { whos: term.whos })] as [string, string]; },
  get requestsTo() { return [t('Requests go to'), t('Who picks them up first')] as [string, string]; },
  get meetingNotes() { return [t('Meeting notes'), t('For meetings the {who} was in', { who: term.who })] as [string, string]; },
  get recordings() { return [t('Meeting recordings'), t('Only for meetings they attended')] as [string, string]; },
  get invites() { return [t('{Whos} invite colleagues', { whos: term.whos }), t('People at the same company')] as [string, string]; },
  get ai() { return [t('AI for {whos}', { whos: term.whos }), t('Answers only from what the {who} can see. Uses your AI allowance or keys', { who: term.who })] as [string, string]; },
  get aiQuestions() { return [t('AI questions per month'), t('For each {project}', { project: term.one })] as [string, string]; },
  get uploads() { return [t('{Whos} upload files', { whos: term.whos }), t('Into a “From {who}” folder you can see', { who: term.who })] as [string, string]; },
  get hideBranding() { return [t('Hide “Made with sprint2go”'), t('Needs the branding add-on (Plan & billing)')] as [string, string]; },
};

/**
 * The client access settings. For the company (all fields), or for one client: then each setting shows the company's
 * choice and "Use company setting" to drop the client's own.
 */
export function ClientAccessForm({
  value,
  company,
  overrides,
  teams,
  canManage,
  brandingAvailable,
  onChange,
  onReset,
}: {
  value: ClientAccess; // what applies
  company?: ClientAccess; // set when editing one client
  overrides?: Partial<ClientAccess>;
  teams: Team[];
  canManage: boolean;
  brandingAvailable: boolean;
  onChange: (p: Partial<ClientAccess>) => void;
  onReset?: (k: Key) => void;
}) {
  const sel = <V extends string>(k: Key, options: { value: V; label: string; hint?: string }[]) => (
    <Select<V> value={String(value[k]) as V} onChange={(v) => onChange({ [k]: v } as Partial<ClientAccess>)} label={LABEL[k][0]} options={options} disabled={!canManage} width={280} />
  );
  const toggle = (k: Key, disabled = false) => (
    <button role="switch" aria-checked={!!value[k]} className={`switch ${value[k] ? 'on' : ''}`} disabled={!canManage || disabled} onClick={() => onChange({ [k]: !value[k] } as Partial<ClientAccess>)}>
      <span />
    </button>
  );
  const show = (k: Key, v: ClientAccess[Key]) => {
    const words: Partial<Record<Key, Record<string, string>>> = {
      teamNames: { full: t('Full names'), first: t('First names'), hide: t('Hidden') },
      meetingNotes: { auto: t('Shared automatically'), manual: t('When you share them') },
      recordings: { off: t('Off'), audio: t('Audio'), video: t('Video') },
      invites: { direct: t('Yes'), approve: t('With approval'), off: t('No') },
      requestsTo: { owner: t('Account manager'), ...Object.fromEntries(teams.map((tm) => [tm.id, tm.name])) },
    };
    if (typeof v === 'boolean') return v ? t('On') : t('Off');
    return words[k]?.[String(v)] ?? String(v);
  };
  const sub = (k: Key) => (
    <>
      {LABEL[k][1]}
      {company && (
        <>
          {' · '}
          {overrides && k in overrides ? (
            <button className="link-btn" onClick={(e) => (e.stopPropagation(), onReset?.(k))} disabled={!canManage}>
              <RotateCcw size={11} /> {t('Use company setting ({value})', { value: show(k, company[k]) })}
            </button>
          ) : (
            <span className="ca-company">{t('company setting')}</span>
          )}
        </>
      )}
    </>
  );
  const row = (k: Key, control: ReactNode) => (
    <div className="set-row ca-row" key={k}>
      <span>
        <strong>{LABEL[k][0]}</strong>
        <small>{sub(k)}</small>
      </span>
      {control}
    </div>
  );
  // Phones (iOS Settings): a choice is a row with the current one on the right and a sheet with a tick.
  const phone = usePhone();
  // One guest's own page: their own choice says so, and the sheet offers the company's back (no button inside the row).
  const RESET = '__company';
  const pick = <V extends string>(k: Key, options: { value: V; label: string; hint?: string }[]) => {
    if (!phone) return row(k, sel(k, options));
    const own = !!company && !!overrides && k in overrides;
    const opts: { value: string; label: string; hint?: string }[] = own ? [...options, { value: RESET, label: t('Use company setting ({value})', { value: show(k, company![k]) }) }] : options;
    return (
      <ChoiceRow
        key={k}
        label={LABEL[k][0]}
        sub={company ? `${LABEL[k][1]} · ${own ? t('Own setting') : t('company setting')}` : LABEL[k][1]}
        value={String(value[k])}
        options={opts}
        onChange={(v) => (v === RESET ? onReset?.(k) : onChange({ [k]: v } as Partial<ClientAccess>))}
        disabled={!canManage}
      />
    );
  };

  return (
    <div className="ca-form">
      {pick('teamNames', [
        { value: 'full', label: t('Full names and photos') },
        { value: 'first', label: t('First names and photos') },
        { value: 'hide', label: t('Hide'), hint: t('Shows your company name instead') },
      ])}
      {row('requests', toggle('requests'))}
      {value.requests && pick('requestsTo', [{ value: 'owner', label: t('The {project}’s account manager', { project: term.one }) }, ...teams.map((tm) => ({ value: tm.id, label: t('{team} team queue', { team: tm.name }) }))])}
      {pick('meetingNotes', [
        { value: 'auto', label: t('Shared automatically'), hint: t('Meetings they attended') },
        { value: 'manual', label: t('Only when we share each one') },
      ])}
      {pick('recordings', [
        { value: 'off', label: t('Off') },
        { value: 'audio', label: t('Audio') },
      ])}
      {pick('invites', [
        { value: 'direct', label: t('Yes, straight away') },
        { value: 'approve', label: t('Yes, an admin approves') },
        { value: 'off', label: t('No') },
      ])}
      {row('uploads', toggle('uploads'))}
      {row('ai', toggle('ai'))}
      {value.ai && phone && (
        <TextRow
          key="aiQuestions"
          label={LABEL.aiQuestions[0]}
          sub={LABEL.aiQuestions[1]}
          value={String(value.aiQuestions)}
          disabled={!canManage}
          inputMode="numeric"
          allowEmpty={false}
          validate={(v) => (/^\d+$/.test(v) && +v >= 1 && +v <= 1000 ? null : t('A number from 1 to 1000'))}
          onSave={(v) => onChange({ aiQuestions: Math.max(1, Number(v) || DEFAULT_CLIENT_ACCESS.aiQuestions) })}
        />
      )}
      {value.ai &&
        !phone &&
        row(
          'aiQuestions',
          <input
            type="number"
            className="ca-num"
            min={1}
            max={1000}
            value={value.aiQuestions}
            disabled={!canManage}
            onChange={(e) => onChange({ aiQuestions: Math.max(1, Number(e.target.value) || DEFAULT_CLIENT_ACCESS.aiQuestions) })}
          />,
        )}
      {row('hideBranding', toggle('hideBranding', !brandingAvailable))}
    </div>
  );
}
