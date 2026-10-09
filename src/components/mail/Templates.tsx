import type { RefObject } from 'react';
import { BookmarkPlus, FileText, X } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { Popover } from '../ui/Popover';
import { usePhone } from '../../mobile/media';
import { usePersisted } from '../../settings';
import { uid } from '../../utils';

export interface MailTemplate {
  id: string;
  name: string;
  text: string;
}

/** Ready to use, for everyone. The person's own come first (saved from what they wrote). */
export const BUILT_IN_TEMPLATES: MailTemplate[] = [
  { id: 'thanks', name: 'Thanks, received', text: 'Thanks, received! I’ll come back to you soon.' },
  { id: 'check', name: 'Let me check', text: 'Let me check and get back to you by tomorrow.' },
  { id: 'yes', name: 'Sounds good', text: 'Sounds good, let’s do it.' },
  { id: 'follow', name: 'Following up', text: 'Hi, just following up on my last email. Is there anything you need from me to move this forward?' },
  { id: 'times', name: 'Times to talk', text: 'Would one of these times work for a quick call?\n\n- \n- \n- \n\nHappy to work around you.' },
];

/** The reader's quick replies: short, always there, no AI. */
export const QUICK_REPLIES = ['Thanks, received!', 'Let me check and get back to you.', 'Sounds good, let’s do it.'];

export const useOwnTemplates = (userId: string) => usePersisted<MailTemplate[]>(`s2g-mail-templates:${userId}`, []);

/**
 * Templates: tap one to put it in the email. "Save as a template" keeps what you wrote for next time. A sheet on
 * phones, a menu by the button on desktop.
 */
export function TemplatesPicker({ open, onClose, anchor, userId, current, onInsert }: { open: boolean; onClose: () => void; anchor?: RefObject<HTMLElement | null>; userId: string; current: string; onInsert: (text: string) => void }) {
  const phone = usePhone();
  const [own, setOwn] = useOwnTemplates(userId);
  if (!open) return null;
  const text = current.trim();
  const saved = own.some((t) => t.text === text);
  const pick = (t: MailTemplate) => (onClose(), onInsert(t.text));
  const row = (t: MailTemplate, mine: boolean) => (
    <div key={t.id} className="mtpl-row" role="none">
      <button type="button" role="menuitem" className="as-item" onClick={() => pick(t)}>
        <FileText size={18} className="as-icon" />
        <span className="as-label">
          {t.name}
          <small className="mtpl-line">{t.text.replace(/\s+/g, ' ')}</small>
        </span>
      </button>
      {mine && (
        <button type="button" className="icon-btn sm mtpl-del" onClick={() => setOwn((l) => l.filter((x) => x.id !== t.id))} aria-label={`Remove the template “${t.name}”`} title="Remove">
          <X size={15} />
        </button>
      )}
    </div>
  );
  const body = (
    <div className="mtpl-pick">
      <div className="as-list" role="menu">
        {own.map((t) => row(t, true))}
        {own.length > 0 && <div className="as-sep" />}
        {BUILT_IN_TEMPLATES.map((t) => row(t, false))}
      </div>
      {text && !saved && (
        <button type="button" className="ghost-btn mtpl-save" onClick={() => setOwn((l) => [{ id: uid(), name: text.split('\n')[0].slice(0, 48), text }, ...l].slice(0, 30))}>
          <BookmarkPlus size={15} /> Save what you wrote as a template
        </button>
      )}
    </div>
  );
  if (phone || !anchor)
    return (
      <Sheet onClose={onClose} title="Templates" className="mail-pick">
        {body}
      </Sheet>
    );
  return (
    <Popover anchor={anchor} open onClose={onClose} width={320} title="Templates">
      <div className="mail-pick in-pop">
        <div className="mp-title">Templates</div>
        {body}
      </div>
    </Popover>
  );
}
