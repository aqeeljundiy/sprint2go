// Smart compose without AI: everyday phrases (greetings, thanks, sign-offs) in English and Indonesian, finished once
// their start is typed. Pure, so the unit checks can run it (scripts/mail-extras-tests.mjs).

/** Everyday phrases, completed once the start of one is typed. The writer's own words always win. */
export const PHRASES = [
  // English
  'Thank you for your email.',
  'Thank you for your help.',
  'Thank you for getting back to me.',
  'Thanks for your help!',
  'Thanks for getting back to me.',
  'Thanks in advance.',
  'I hope this email finds you well.',
  'I hope you are doing well.',
  'Hope you are well.',
  'Please let me know if you have any questions.',
  'Let me know if you have any questions.',
  'Let me know what you think.',
  'Looking forward to hearing from you.',
  'Looking forward to working with you.',
  'Please find attached',
  'Please see attached',
  'Sorry for the late reply.',
  'Sorry for the delay.',
  'Have a great day!',
  'Have a great weekend!',
  'Have a nice day!',
  'Kind regards,',
  'Best regards,',
  'Warm regards,',
  'Many thanks,',
  'Talk soon,',
  'Good morning,',
  'Good afternoon,',
  'Just following up on my last email.',
  'Just checking in on this.',
  'As discussed,',
  'Feel free to reach out if you need anything else.',
  // Indonesian
  'Terima kasih atas emailnya.',
  'Terima kasih atas bantuannya.',
  'Terima kasih sebelumnya.',
  'Terima kasih banyak.',
  'Semoga harimu menyenangkan.',
  'Semoga sehat selalu.',
  'Mohon maaf atas keterlambatan balasan saya.',
  'Mohon maaf mengganggu waktunya.',
  'Mohon konfirmasinya.',
  'Mohon informasinya.',
  'Silakan kabari saya jika ada pertanyaan.',
  'Kabari saya jika ada pertanyaan.',
  'Saya tunggu kabar baiknya.',
  'Berikut saya lampirkan',
  'Bersama email ini saya lampirkan',
  'Dengan hormat,',
  'Hormat saya,',
  'Salam hangat,',
  'Selamat pagi,',
  'Selamat siang,',
  'Selamat sore,',
  'Sesuai pembicaraan kita,',
  'Menindaklanjuti email saya sebelumnya,',
];

/** The phrase the end of the text starts, and the rest of it; null when none does (or it's already finished). */
export function localSuggestion(before: string): string | null {
  // Only what's typed since the last sentence ended, as one line.
  const tail = before.split(/[.!?\n]\s*| {2,}/).pop()?.replace(/^\s+/, '').replace(/ /g, ' ') ?? '';
  if (tail.length < 3 || tail.length > 80) return null;
  const low = tail.toLowerCase();
  const hit = PHRASES.find((p) => p.length > tail.length && p.toLowerCase().startsWith(low));
  if (!hit) return null;
  const rest = hit.slice(tail.length);
  // Keep the case the writer used for what they typed; never suggest just punctuation.
  return /[\p{L}\p{N}]/u.test(rest) ? rest : null;
}

