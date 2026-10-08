import { useState } from 'react';
import { day } from '../api';
import { Empty, Failed, Loading, Page, Section, Stat, Stats, useApi } from '../ui';

interface GrowthData {
  days: number;
  funnel: { key: string; label: string; n: number }[];
  sources: { source: string; visits: number; signups: number }[];
  cohorts: { week: string; companies: number; weeks: (number | null)[] }[];
  apps: { total: number; rows: { label: string; companies: number }[] };
  trials: { ended: number; converted: number };
}

export function Growth() {
  const [days, setDays] = useState(30);
  const { data, error, reload } = useApi<GrowthData>(`growth?days=${days}`, [days]);
  return (
    <Page
      title="Growth"
      sub="Our own company and test companies are left out."
      actions={
        <div className="segmented sm">
          {[30, 90, 365].map((d) => (
            <button key={d} type="button" className={days === d ? 'on' : ''} onClick={() => setDays(d)}>
              {d === 365 ? '12 months' : `${d} days`}
            </button>
          ))}
        </div>
      }
    >
      {error ? <Failed error={error} retry={reload} /> : !data ? <Loading rows={8} /> : <Body d={data} />}
    </Page>
  );
}

function Body({ d }: { d: GrowthData }) {
  const top = Math.max(1, ...d.funnel.map((f) => f.n));
  const signups = d.funnel.find((f) => f.key === 'verified')?.n ?? 0;
  const companies = d.funnel.find((f) => f.key === 'company')?.n ?? 0;
  const paid = d.funnel.find((f) => f.key === 'paid')?.n ?? 0;
  const visits = d.funnel.find((f) => f.key === 'visits')?.n ?? 0;
  return (
    <>
      <Stats>
        <Stat label="Visits" value={visits} hint="landing page" />
        <Stat label="Sign-ups" value={signups} hint={visits ? `${((signups / visits) * 100).toFixed(1)}% of visits` : undefined} />
        <Stat label="New companies" value={companies} hint={`${paid} paying already`} />
        <Stat label="Trials that converted" value={d.trials.ended ? `${Math.round((d.trials.converted / d.trials.ended) * 100)}%` : 'none yet'} hint={`${d.trials.converted} of ${d.trials.ended} trials that ended`} />
      </Stats>
      <Section title="From visit to paying" hint={`Last ${d.days} days`}>
        <div className="adm-funnel">
          {d.funnel.map((f, i) => {
            const prev = i ? d.funnel[i - 1].n : null;
            return (
              <div key={f.key} className="adm-funnel-row" style={{ ['--i' as string]: i }}>
                <span className="adm-funnel-label">{f.label}</span>
                <span className="adm-funnel-bar">
                  <i style={{ width: `${Math.max(f.n ? 2 : 0, (f.n / top) * 100)}%` }} />
                </span>
                <strong>{f.n}</strong>
                <small className="muted">{prev ? `${Math.round((f.n / prev) * 100)}%` : ''}</small>
              </div>
            );
          })}
        </div>
      </Section>
      <div className="adm-split">
        <Section title="Where they came from" hint="utm_source, ?ref= or the site that linked">
          {d.sources.length === 0 ? (
            <Empty title="No visits yet" text="Share links with ?ref=name (e.g. sprint2go.com/?ref=instagram) to see what works." />
          ) : (
            <div className="adm-mini-list">
              <div className="adm-mini-row head">
                <span className="grow">Source</span>
                <span>Visits</span>
                <span>Sign-ups</span>
              </div>
              {d.sources.map((s) => (
                <div key={s.source} className="adm-mini-row">
                  <span className="grow">{s.source}</span>
                  <span className="adm-num-r">{s.visits}</span>
                  <span className="adm-num-r">{s.signups}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
        <Section title="What companies use" hint={`of ${d.apps.total}, last 30 days`}>
          {d.apps.total === 0 ? (
            <Empty title="No companies yet" />
          ) : (
            <div className="adm-parts">
              {d.apps.rows.map((a) => (
                <div key={a.label} className="adm-part">
                  <span>{a.label}</span>
                  <span className="adm-part-bar">
                    <i className="accent" style={{ width: `${(a.companies / d.apps.total) * 100}%` }} />
                  </span>
                  <small>{Math.round((a.companies / d.apps.total) * 100)}%</small>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
      <Section title="Do they come back?" hint="Companies by the week they started, and the share with anyone active in each week after">
        {d.cohorts.every((c) => !c.companies) ? (
          <Empty title="Not enough history yet" text="This fills in week by week as companies sign up and use the app." />
        ) : (
          <div className="adm-cohorts" role="table">
            <div className="adm-cohort head" role="row">
              <span>Started</span>
              <span>Companies</span>
              {Array.from({ length: 8 }, (_, k) => (
                <span key={k}>W{k}</span>
              ))}
            </div>
            {d.cohorts.map((c) => (
              <div key={c.week} className="adm-cohort" role="row">
                <span>{day(c.week)}</span>
                <span>{c.companies}</span>
                {Array.from({ length: 8 }, (_, k) => {
                  const v = c.weeks[k];
                  return (
                    <span key={k} className="adm-cell" style={v === null || v === undefined ? undefined : { ['--p' as string]: v / 100 }}>
                      {v === null || v === undefined ? '' : `${v}%`}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
