/** Languages the meeting recorder and voice notes understand (codes match recorder/transcribe.mjs). */
export const MEETING_LANGUAGES: { code: string; label: string; speech: string }[] = [
  { code: 'id', label: 'Indonesian', speech: 'id-ID' },
  { code: 'en', label: 'English', speech: 'en-US' },
  { code: 'ms', label: 'Malay', speech: 'ms-MY' },
  { code: 'nl', label: 'Dutch', speech: 'nl-NL' },
  { code: 'de', label: 'German', speech: 'de-DE' },
  { code: 'fr', label: 'French', speech: 'fr-FR' },
  { code: 'es', label: 'Spanish', speech: 'es-ES' },
  { code: 'pt', label: 'Portuguese', speech: 'pt-PT' },
  { code: 'ar', label: 'Arabic', speech: 'ar-SA' },
  { code: 'hi', label: 'Hindi', speech: 'hi-IN' },
  { code: 'ja', label: 'Japanese', speech: 'ja-JP' },
];
export const languageName = (code?: string) => MEETING_LANGUAGES.find((l) => l.code === code)?.label ?? 'Detect automatically';
/** "Indonesian and English" */
export const languagesText = (codes?: string[]) => (codes?.length ? codes.map(languageName).join(codes.length > 2 ? ', ' : ' and ') : 'Detect automatically');
