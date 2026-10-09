import { useEffect, useRef } from 'react';
import { Sparkles } from 'lucide-react';
import { usePersisted } from '../settings';
import '../connector.css';

/** A message an AI app the person connected wrote for a channel that guests read (server/mcpTools.ts, post_message). */
export interface ChatDraft {
  text: string;
  at: string;
  via?: string; // the app's name, "Claude"
}

/**
 * Drafts AI apps leave for channels with guests: nothing goes to guests from an AI app, so the message waits here, in
 * the person's own settings (only they see it, on every device), for them to check and send. The channel's message
 * box fills with it when the channel opens, or when it arrives while the box is empty. Sending what came from it, or
 * Discard, clears it; a message of their own typed meanwhile leaves it waiting.
 */
export function useChatDraft(me: string, channelId: string | undefined, setText: (f: (t: string) => string) => void) {
  const [drafts, setDrafts] = usePersisted<Record<string, ChatDraft>>(`s2g-chat-drafts:${me}`, {});
  const draft = channelId ? drafts[channelId] : undefined;
  const key = draft && channelId ? `${channelId}:${draft.at}` : '';
  const filled = useRef('');
  const used = useRef('');
  useEffect(() => {
    if (!key || !draft || filled.current === key) return;
    filled.current = key;
    setText((t) => {
      if (t.trim()) return t;
      used.current = key;
      return draft.text;
    });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = () => {
    if (!channelId) return;
    setDrafts((d) => {
      if (!d[channelId]) return d;
      const { [channelId]: _gone, ...rest } = d;
      return rest;
    });
  };
  return {
    draft,
    /** Puts the draft in the box (it waited while they were typing something else). */
    use: () => {
      if (!draft) return;
      used.current = key;
      setText(() => draft.text);
    },
    /** A message went from the box: if it started as the draft, the draft is done. */
    sent: () => void (key && used.current === key && done()),
    discard: () => {
      if (!draft) return;
      if (used.current === key) setText((t) => (t.trim() === draft.text.trim() ? '' : t));
      done();
    },
  };
}

/** The line above the message box while a draft waits: where it came from, Use it (when the box holds something else) and Discard. */
export function DraftNote({ draft, text, onUse, onDiscard }: { draft: ChatDraft | undefined; text: string; onUse: () => void; onDiscard: () => void }) {
  // The last draft stays while the line folds away, so it closes with its words instead of going blank.
  const last = useRef(draft);
  if (draft) last.current = draft;
  const d = draft ?? last.current;
  const inBox = !!d && text.trim() === d.text.trim();
  return (
    <div className={`fold chat-draft-fold ${draft ? 'open' : ''}`} aria-hidden={!draft}>
      <div>
        {d && (
          <div className="chat-draft" role="status">
            <Sparkles size={14} />
            <span>{inBox ? `Drafted in ${d.via ?? 'an AI app'}. Guests read this channel, so it waits for you: check it, then send.` : `${d.via ?? 'An AI app'} left a draft for this channel.`}</span>
            {!inBox && (
              <button type="button" className="link-btn" tabIndex={draft ? 0 : -1} onClick={onUse}>
                Use it
              </button>
            )}
            <button type="button" className="link-btn" tabIndex={draft ? 0 : -1} onClick={onDiscard}>
              Discard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
