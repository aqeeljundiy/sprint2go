import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { server } from '../../sync';
import { catalogList, type ModelEntry, type ModelList } from '../../data/aiModels';
import { Select, type Option } from '../ui/Select';

// The models each of a company's keys can use. With the server: the provider's own list (GET /api/ai/models, which
// keeps it about an hour). In the demo: our catalogue. Kept here for the visit, so pickers don't wait twice.
const kept = new Map<string, ModelList>();
const loading = new Set<string>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());
const k = (ws: string, provider: string) => `${ws}|${provider}`;

/** Reads one key's list from the server (refresh: from the provider again). The catalogue when there's no server. */
export async function loadModels(ws: string, provider: string, refresh = false): Promise<ModelList> {
  if (!server.on) return catalogList(provider);
  loading.add(k(ws, provider));
  changed();
  try {
    const r = await fetch(`/api/ai/models?workspaceId=${encodeURIComponent(ws)}&provider=${encodeURIComponent(provider)}${refresh ? '&refresh=1' : ''}`);
    const d = r.ok ? ((await r.json()) as ModelList) : null;
    if (d && Array.isArray(d.models)) kept.set(k(ws, provider), d);
    return d && Array.isArray(d.models) ? d : catalogList(provider);
  } catch {
    return catalogList(provider);
  } finally {
    loading.delete(k(ws, provider));
    changed();
  }
}
/** A list the server sent with something else (a key just saved). */
export function keepModels(ws: string, provider: string, list: ModelList) {
  kept.set(k(ws, provider), list);
  changed();
}

/** The lists of these providers' keys: the catalogue until the provider's own list arrives. */
export function useModelLists(ws: string, providers: string[]) {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    return () => void listeners.delete(f);
  }, []);
  const key = providers.join(',');
  useEffect(() => {
    if (!server.on) return;
    for (const p of providers) if (!kept.has(k(ws, p)) && !loading.has(k(ws, p))) void loadModels(ws, p);
  }, [ws, key]); // the providers, as a string

  const lists: Record<string, ModelList> = {};
  for (const p of providers) lists[p] = kept.get(k(ws, p)) ?? catalogList(p);
  return { lists, loading: (p: string) => loading.has(k(ws, p)) };
}

const usd = (n: number) => `US$${n.toLocaleString('en-US', { maximumFractionDigits: 3 })}`;
/** A model's price, short: "US$2 in, US$10 out per 1M tokens", or that it isn't known. */
export const priceHint = (p: [number, number] | null | undefined) => (p ? `${usd(p[0])} in, ${usd(p[1])} out per 1M tokens` : 'Price unknown');

/** The text models a list offers. */
export const textModels = (list: ModelList | undefined) => (list?.models ?? []).filter((m: ModelEntry) => m.kind === 'text');

/** Options for a key's model: recommended first, then by family; a typed id on top when it's in use. */
export function keyModelOptions(list: ModelList, extra?: string | null): Option[] {
  const text = textModels(list);
  const opts: Option[] = text.map((m) => ({ value: m.id, label: m.name, hint: priceHint(m.price), group: m.recommended ? 'Recommended' : m.family, keywords: `${m.id} ${m.family}` }));
  if (extra && !text.some((m) => m.id === extra)) opts.unshift({ value: extra, label: extra, hint: 'Your model id, checked with one call', group: 'Typed in' });
  return opts;
}

/**
 * Picks the model a key uses: a searchable list of what the provider offers, and (where it makes sense) "Other model
 * id", which is tried with one tiny call before it's taken.
 */
export function ModelPicker({
  list,
  value,
  typed,
  onPick,
  check,
  label,
  flat,
  width = 360,
  disabled,
}: {
  list: ModelList;
  value: string | null;
  typed?: boolean;
  onPick: (id: string, typed: boolean) => void;
  check: ((id: string) => Promise<string | null>) | null;
  label: string;
  flat?: boolean;
  width?: number;
  disabled?: boolean;
}) {
  const [checking, setChecking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onList = (id: string) => list.models.some((m) => m.id === id);
  const shown = checking ?? value;
  const opts = keyModelOptions(list, shown && (typed || checking || !onList(shown)) ? shown : null);
  const choose = (id: string) => {
    setError(null);
    if (onList(id) || (id === value && typed)) return onPick(id, id === value ? !!typed : false);
    if (!check) return;
    setChecking(id);
    void check(id).then((err) => {
      setChecking(null);
      if (err) setError(err);
      else onPick(id, true);
    });
  };
  return (
    <span className="model-pick">
      <Select
        value={shown}
        options={opts}
        onChange={choose}
        searchable
        label={label}
        title={label}
        width={width}
        className={flat ? 'sel-flat' : ''}
        disabled={disabled || !!checking}
        placeholder="Choose a model"
        create={check ? { label: 'Other model id', placeholder: 'The id exactly as the provider writes it', make: (s) => s.trim() || null } : undefined}
      />
      {(checking || error) && (
        <small className={`model-pick-note ${error ? 'err' : 'muted'}`} role={error ? 'alert' : 'status'}>
          {checking ? (
            <>
              <Loader2 size={12} className="spin" /> Trying “{checking}” with one tiny call…
            </>
          ) : (
            error
          )}
        </small>
      )}
    </span>
  );
}
