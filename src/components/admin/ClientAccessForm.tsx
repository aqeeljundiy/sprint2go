import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { DEFAULT_CLIENT_ACCESS, type ClientAccess, type Team } from '../../types';
import { Select } from '../ui/Select';

type Key = keyof ClientAccess;

const LABEL: Record<Key, [string, string]> = {
  teamNames: ['Show who’s doing the work', 'On tasks, requests and in chat'],
  requests: ['Requests', 'Clients send requests that land in your team’s queue, like tickets'],
  requestsTo: ['Requests go to', 'Who picks them up first'],
  meetingNotes: ['Meeting notes', 'For meetings the client was in'],
  recordings: ['Meeting recordings', 'Only for meetings they attended'],
  invites: ['Clients invite colleagues', 'People at the same company'],
  ai: ['AI for clients', 'Answers only from what the client can see. Uses your AI allowance or keys'],
  aiQuestions: ['AI questions per month', 'For each client'],
  uploads: ['Clients upload files', 'Into a “From client” folder you can see'],
  hideBranding: ['Hide “Made with Sprint2go”', 'Needs the branding add-on (Plan & billing)'],
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
      teamNames: { full: 'Full names', first: 'First names', hide: 'Hidden' },
      meetingNotes: { auto: 'Shared automatically', manual: 'When you share them' },
      recordings: { off: 'Off', audio: 'Audio', video: 'Video' },
      invites: { direct: 'Yes', approve: 'With approval', off: 'No' },
      requestsTo: { owner: 'Account manager', ...Object.fromEntries(teams.map((t) => [t.id, t.name])) },
    };
    if (typeof v === 'boolean') return v ? 'On' : 'Off';
    return words[k]?.[String(v)] ?? String(v);
  };
  const row = (k: Key, control: ReactNode) => (
    <div className="set-row ca-row" key={k}>
      <span>
        <strong>{LABEL[k][0]}</strong>
        <small>
          {LABEL[k][1]}
          {company && (
            <>
              {' · '}
              {overrides && k in overrides ? (
                <button className="link-btn" onClick={() => onReset?.(k)} disabled={!canManage}>
                  <RotateCcw size={11} /> Use company setting ({show(k, company[k])})
                </button>
              ) : (
                <span className="ca-company">company setting</span>
              )}
            </>
          )}
        </small>
      </span>
      {control}
    </div>
  );

  return (
    <div className="ca-form">
      {row(
        'teamNames',
        sel('teamNames', [
          { value: 'full', label: 'Full names and photos' },
          { value: 'first', label: 'First names and photos' },
          { value: 'hide', label: 'Hide', hint: 'Shows your company name instead' },
        ]),
      )}
      {row('requests', toggle('requests'))}
      {value.requests &&
        row(
          'requestsTo',
          sel('requestsTo', [{ value: 'owner', label: 'The client’s account manager' }, ...teams.map((t) => ({ value: t.id, label: `${t.name} team queue` }))]),
        )}
      {row(
        'meetingNotes',
        sel('meetingNotes', [
          { value: 'auto', label: 'Shared automatically', hint: 'Meetings they attended' },
          { value: 'manual', label: 'Only when we share each one' },
        ]),
      )}
      {row(
        'recordings',
        sel('recordings', [
          { value: 'off', label: 'Off' },
          { value: 'audio', label: 'Audio' },
          { value: 'video', label: 'Video' },
        ]),
      )}
      {row(
        'invites',
        sel('invites', [
          { value: 'direct', label: 'Yes, straight away' },
          { value: 'approve', label: 'Yes, an admin approves' },
          { value: 'off', label: 'No' },
        ]),
      )}
      {row('uploads', toggle('uploads'))}
      {row('ai', toggle('ai'))}
      {value.ai &&
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
