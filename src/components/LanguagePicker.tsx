import { MEETING_LANGUAGES } from '../data/languages';
import { t } from '../i18n';

/**
 * Which languages meetings are spoken in. The first one picked is the main one (Meet's captions use it,
 * and anything the speech service isn't sure about falls back to it). Nothing picked = detect automatically.
 */
export function LanguagePicker({ value, onChange, max = 4 }: { value: string[]; onChange: (v: string[]) => void; max?: number }) {
  const toggle = (code: string) => onChange(value.includes(code) ? value.filter((c) => c !== code) : value.length >= max ? value : [...value, code]);
  return (
    <div className="team-toggles lang-chips" role="group" aria-label={t('Meeting languages')}>
      {MEETING_LANGUAGES.map((l) => {
        const at = value.indexOf(l.code);
        return (
          <button key={l.code} type="button" className={at >= 0 ? 'on' : ''} aria-pressed={at >= 0} onClick={() => toggle(l.code)} title={at === 0 ? t('Main language') : undefined}>
            {t(l.label)}
            {at === 0 && value.length > 1 && <em className="lang-main">{t('main')}</em>}
          </button>
        );
      })}
    </div>
  );
}
