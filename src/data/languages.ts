// The server imports this file (server/index.ts): the i18n files by their full path, and no React here (docs/i18n.md).
import { mark, t } from '../i18n/index';
import { fmtList } from '../i18n/format';

/** Languages the meeting recorder and voice notes understand (codes match recorder/transcribe.mjs). Labels: show them with t(). */
export const MEETING_LANGUAGES: { code: string; label: string; speech: string }[] = [
  { code: 'id', label: mark('Indonesian'), speech: 'id-ID' },
  { code: 'en', label: mark('English'), speech: 'en-US' },
  { code: 'ms', label: mark('Malay'), speech: 'ms-MY' },
  { code: 'nl', label: mark('Dutch'), speech: 'nl-NL' },
  { code: 'de', label: mark('German'), speech: 'de-DE' },
  { code: 'fr', label: mark('French'), speech: 'fr-FR' },
  { code: 'es', label: mark('Spanish'), speech: 'es-ES' },
  { code: 'pt', label: mark('Portuguese'), speech: 'pt-PT' },
  { code: 'ar', label: mark('Arabic'), speech: 'ar-SA' },
  { code: 'hi', label: mark('Hindi'), speech: 'hi-IN' },
  { code: 'ja', label: mark('Japanese'), speech: 'ja-JP' },
];
const DETECT = mark('Detect automatically');

/** English, for the server's logs and the recorder. On screen, use languageLabel. */
export const languageName = (code?: string) => MEETING_LANGUAGES.find((l) => l.code === code)?.label ?? DETECT;
/** "Indonesian and English", in English, for the server. On screen, use languagesLabel. */
export const languagesText = (codes?: string[]) => (codes?.length ? codes.map(languageName).join(codes.length > 2 ? ', ' : ' and ') : DETECT);

/** A meeting language's name in the reader's language: "Indonesian" / "Indonesia". */
export const languageLabel = (code?: string) => t(languageName(code));
/** Meeting languages in the reader's language: "Indonesian and English" / "Indonesia dan Inggris". */
export const languagesLabel = (codes?: string[]) => (codes?.length ? fmtList(codes.map(languageLabel)) : t(DETECT));
