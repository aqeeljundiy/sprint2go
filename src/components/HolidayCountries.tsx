import { Globe } from 'lucide-react';
import { MultiSelect } from './ui/MultiSelect';
import { HOLIDAY_COUNTRIES } from '../data/holidays';

/** "Countries you see": whose public holidays show on this person's calendar, from every country we have. */
export function HolidayCountries({ regions, company, companyName, onChange, field }: { regions: string[]; company?: string; companyName: string; onChange: (codes: string[]) => void; field?: boolean }) {
  const options = HOLIDAY_COUNTRIES.map((c) => ({ value: c.code, label: c.name, hint: c.code === company ? `${companyName}’s country` : undefined }));
  return (
    <MultiSelect
      values={regions}
      options={options}
      onChange={onChange}
      label="Countries you see"
      title="Whose public holidays you see"
      none="No countries"
      searchable
      className={field ? '' : 'nav-item hol-countries'}
      trigger={
        field
          ? undefined
          : (summary) => (
              <>
                <Globe size={15} />
                <span className="sb-label">
                  Countries you see
                  <small>{summary}</small>
                </span>
              </>
            )
      }
      footer="Just for you. Everyone else sees their own choice."
    />
  );
}
