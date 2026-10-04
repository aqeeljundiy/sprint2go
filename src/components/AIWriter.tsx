import { useState } from 'react';
import { Loader2, Sparkles, Wand2, X } from 'lucide-react';
import { ai, AI_LIVE, type RewriteStyle } from '../ai';

interface Props {
  hasText: boolean;
  currentText: string; // what the user has written (signature excluded)
  me: string;
  to?: string;
  subject?: string;
  onResult: (text: string) => void;
  onClose: () => void;
}

const TONES = ['Friendly', 'Professional', 'Short'];
const REWRITES: [RewriteStyle, string][] = [
  ['shorter', 'Shorter'],
  ['formal', 'More formal'],
  ['friendly', 'Friendlier'],
  ['fix', 'Fix grammar'],
];

/** "Write with AI" panel in Compose: draft from a prompt, or rewrite what's there. */
export function AIWriter({ hasText, currentText, me, to, subject, onResult, onClose }: Props) {
  const [prompt, setPrompt] = useState('');
  const [tone, setTone] = useState('Friendly');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (label: string, job: () => Promise<string>) => {
    setBusy(label);
    setError(null);
    try {
      onResult(await job());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ai-writer" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}>
      <div className="aw-head">
        <Sparkles size={15} />
        <strong>Write with AI</strong>
        {!AI_LIVE && <span className="demo-tag">Demo</span>}
        <button className="icon-btn sm" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>
      <textarea
        autoFocus
        rows={2}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && prompt.trim()) {
            e.preventDefault();
            run('draft', () => ai.draft({ instruction: prompt, tone, me, to, subject }));
          }
        }}
        placeholder={to ? `What should the email to ${to.split(' ')[0]} say?` : 'What should this email say?'}
      />
      <div className="aw-row">
        <div className="aw-tones">
          {TONES.map((t) => (
            <button key={t} className={tone === t ? 'on' : ''} onClick={() => setTone(t)}>
              {t}
            </button>
          ))}
        </div>
        <button className="primary-btn sm" disabled={!prompt.trim() || !!busy} onClick={() => run('draft', () => ai.draft({ instruction: prompt, tone, me, to, subject }))}>
          {busy === 'draft' ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} {hasText ? 'Rewrite from prompt' : 'Generate'}
        </button>
      </div>
      {hasText && (
        <div className="aw-rewrite">
          <Wand2 size={13} />
          <span>Improve what you wrote:</span>
          {REWRITES.map(([style, label]) => (
            <button key={style} disabled={!!busy} onClick={() => run(style, () => ai.rewrite(currentText, style))}>
              {busy === style ? <Loader2 size={12} className="spin" /> : null}
              {label}
            </button>
          ))}
        </div>
      )}
      {error && <p className="aw-error">{error}</p>}
    </div>
  );
}
