import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HardDrive, X } from 'lucide-react';
import { fmtSize } from '../data/drive';
import { t } from '../i18n';
import { tj } from '../i18n/tj';
import { useLang } from '../i18n/useLang';

/*
 * "Ask before saving big files" (Settings, Storage): before an upload over the company's limit, a small question with
 * the file's size and the storage the company has left. Called from uploadFile (src/sync.ts), so Drive, chat, tables
 * and guests' uploads all ask the same way. It lives in its own spot on the page and answers with a promise.
 */

type Ask = { name: string; size: number; left: number | null; total: number | null; resolve: (save: boolean) => void };
let show: ((a: Ask | null) => void) | null = null;
let mounted = false;

function BigFileHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  useLang(); // its own root, outside the app's: re-render on a language switch
  useEffect(() => {
    show = setAsk;
    return () => void (show = null);
  }, []);
  if (!ask) return null;
  const done = (save: boolean) => (setAsk(null), ask.resolve(save));
  const known = ask.left !== null && ask.total !== null && ask.total > 0;
  const used = known ? ask.total! - ask.left! : 0;
  const pct = (n: number) => `${Math.min(100, Math.max(0.5, (n / ask.total!) * 100))}%`;
  return (
    <div className="modal-scrim" onMouseDown={() => done(false)}>
      <div className="modal big-file-modal" role="dialog" aria-label={t('Save a big file')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && done(false)}>
        <header className="modal-head">
          <span className="dump-title">
            <HardDrive size={15} /> {t('Save a big file?')}
          </span>
          <button className="icon-btn sm" onClick={() => done(false)} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <p className="bf-name">
            {tj('{file} is {size}.', { file: <strong>{ask.name}</strong>, size: fmtSize(ask.size) })}
          </p>
          {known && (
            <>
              <div className="bf-meter" aria-hidden="true">
                <span className="bf-used" style={{ width: used > 0 ? pct(used) : 0 }} />
                <span className="bf-this" style={{ width: pct(Math.min(ask.size, ask.left!)) }} />
              </div>
              <p className="bf-room">
                {t('The company has {left} free of {total}, shared by everyone.', { left: fmtSize(ask.left!), total: fmtSize(ask.total!) })}{' '}
                {ask.size > ask.left! ? t('This file doesn’t fit.') : ask.size / ask.left! >= 0.05 ? t('This leaves {rest}.', { rest: fmtSize(ask.left! - ask.size) }) : ''}
              </p>
            </>
          )}
        </div>
        <footer className="modal-foot">
          <button type="button" className="ghost-btn" onClick={() => done(false)}>
            {t('Don’t upload')}
          </button>
          <button type="button" className="primary-btn" autoFocus disabled={known && ask.size > ask.left!} onClick={() => done(true)}>
            {t('Save it here')}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Asks whether to save this big file. True: go ahead. */
export function askBigFile(a: Omit<Ask, 'resolve'>): Promise<boolean> {
  if (!mounted) {
    mounted = true;
    const host = document.createElement('div');
    host.className = 'big-file-host';
    document.body.appendChild(host);
    createRoot(host).render(<BigFileHost />);
  }
  return new Promise((resolve) => {
    const open = () => (show ? show({ ...a, resolve }) : setTimeout(open, 16));
    open();
  });
}
