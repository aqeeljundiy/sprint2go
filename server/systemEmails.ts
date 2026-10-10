// The system emails that used to be built inside index.ts (sign-up and password codes, guest notices, ticket
// receipts), here so they can be rendered on their own (scripts/email-previews.mjs, the unit tests) without starting
// the server. All of them use the shared layout (server/emailLayout.ts).
import * as lang from './lang.ts';
import * as platform from './platform.ts';
import * as emailLayout from './emailLayout.ts';
import { t, textOf } from '../src/i18n/index.ts';

/** The code email, in `l` (the language of the screen that asked for it): to finish signing up or to set a new password. */
export function codeMail(what: 'signup' | 'reset', code: string, l: lang.Lang) {
  return lang.inLang(l, () => {
    const line = what === 'signup' ? t('{code} is your code to finish signing up.', { code }) : t('{code} is your code to set a new password.', { code });
    // The code big and copyable, the old sentence as the inbox preview.
    const m = emailLayout.codeEmail({
      title: what === 'signup' ? t('Finish signing up') : t('Set a new password'),
      lead: what === 'signup' ? t('Enter this code where you signed up to finish creating your sprint2go account.') : t('Enter this code where you asked for it to set a new password.'),
      preheader: line,
      code,
      footer: [t('If this wasn’t you, ignore this email.')],
      lang: l,
    });
    return { subject: t('{code} is your sprint2go code', { code }), text: m.text, html: m.html };
  });
}

/** A notice for a guest, by email (guests don't live in the app): in the guest's language (theirs, else the company's). */
export function guestNoticeMail(n: { text: string; tr?: any; workspaceId: string }, to: string, brandName: string, origin: string) {
  const l = lang.langOfEmail(to, n.workspaceId);
  return lang.inLang(l, () => {
    const said = textOf(n);
    const open = t('Open your shared space');
    // In the company's own colours and logo (emailLayout.companyBrand), the notice quoted.
    const m = emailLayout.renderEmail({
      brand: emailLayout.companyBrand(n.workspaceId, brandName),
      preheader: said.slice(0, 140),
      title: t('News from {company}', { company: brandName }),
      blocks: [{ quote: said }, { button: { text: open, url: origin } }],
      footer: [t('You get this because {company} shares a space with you.', { company: brandName }), t('Didn’t ask for this? You can ignore it.')],
      lang: l,
    });
    return { subject: `${brandName}: ${said.slice(0, 80)}`, text: m.text, html: m.html };
  });
}

/** The receipt for a ticket that came by email: in the language of the person who wrote (their account's, else English). */
export function ticketReceipt(email: string, number: number, body = '') {
  const l = lang.langOfEmail(email);
  return lang.inLang(l, () => {
    const said = t('Thanks, we have your message (ticket #{number}) and will reply here. Reply to this email to add anything.', { number });
    const quoted = body.trim().split('\n').slice(0, 8).join('\n').slice(0, 600);
    const m = emailLayout.renderEmail({
      preheader: said,
      title: t('We have your message'),
      blocks: [{ p: said }, ...(quoted ? [{ quote: quoted, by: t('Ticket #{number}', { number }) }] : [])],
      footer: [t('You get this because you wrote to {name}.', { name: platform.settings().supportName })],
      lang: l,
    });
    return { text: m.text, html: m.html };
  });
}
