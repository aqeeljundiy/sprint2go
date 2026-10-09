import { useState } from 'react';
import { day } from '../api';
import { Empty, Failed, Loading, Page, Section, Stat, Stats, useApi } from '../ui';
import { t, tn } from '../../i18n';
import { fmtPercent } from '../../i18n/format';

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
      title={t('Growth')}
      sub={t('Our own company and test companies are left out.')}
      actions={
        <div className="segmented sm">
          {[30, 90, 365].map((d) => (
            <button key={d} type="button" className={days === d ? 'on' : ''} onClick={() => setDays(d)}>
              {d === 365 ? t('12 months') : tn(d, '{n} day', '{n} days')}
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
        <Stat label={t('Visits')} value={visits} hint={t('landing page')} />
        <Stat label={t('Sign-ups')} value={signups} hint={visits ? t('{share} of visits', { share: fmtPercent(signups / visits, 1) }) : undefined} />
        <Stat label={t('New companies')} value={companies} hint={t('{n} paying already', { n: paid })} />
        <Stat label={t('Trials that converted')} value={d.trials.ended ? fmtPercent(d.trials.converted / d.trials.ended) : t('none yet')} hint={t('{n} of {total} trials that ended', { n: d.trials.converted, total: d.trials.ended })} />
      </Stats>
      <Section title={t('From visit to paying')} hint={tn(d.days, 'Last {n} day', 'Last {n} days')}>
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
        <Section title={t('Where they came from')} hint={t('utm_source, ?ref= or the site that linked')}>
          {d.sources.length === 0 ? (
            <Empty title={t('No visits yet')} text={t('Share links with ?ref=name (e.g. sprint2go.com/?ref=instagram) to see what works.')} />
          ) : (
            <div className="adm-mini-list">
              <div className="adm-mini-row head">
                <span className="grow">{t('Source')}</span>
                <span>{t('Visits')}</span>
                <span>{t('Sign-ups')}</span>
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
        <Section title={t('What companies use')} hint={t('of {n}, last 30 days', { n: d.apps.total })}>
          {d.apps.total === 0 ? (
            <Empty title={t('No companies yet')} />
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
      <Section title={t('Do they come back?')} hint={t('Companies by the week they started, and the share with anyone active in each week after')}>
        {d.cohorts.every((c) => !c.companies) ? (
          <Empty title={t('Not enough history yet')} text={t('This fills in week by week as companies sign up and use the app.')} />
        ) : (
          <div className="adm-cohorts" role="table">
            <div className="adm-cohort head" role="row">
              <span>{t('Started')}</span>
              <span>{t('Companies')}</span>
              {Array.from({ length: 8 }, (_, k) => (
                <span key={k}>{t('W{n}', { n: k })}</span>
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
