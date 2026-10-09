import { useEffect, useState } from 'react';
import { MoreVertical, Plus, Share, X } from 'lucide-react';
import { brand as product } from '../terms';
import { PHONE } from '../mobile/media';

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const KEY = 's2g-install-later';
const LATER_DAYS = 14;

const ua = () => navigator.userAgent;
const isIOS = () => /iPhone|iPad|iPod/i.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isPhone = () => matchMedia(PHONE).matches || /Android|iPhone|iPad|iPod/i.test(ua());
const installed = () => matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const snoozed = () => {
  try {
    const t = Number(localStorage.getItem(KEY) ?? 0);
    return Date.now() - t < LATER_DAYS * 86_400_000;
  } catch {
    return false;
  }
};

/** Counts visits (once per browser session), so the prompt waits for the second one. */
const VISITS = 's2g-visits';
function countVisit(): number {
  try {
    const n = Number(localStorage.getItem(VISITS) ?? 0);
    if (sessionStorage.getItem(VISITS)) return n;
    sessionStorage.setItem(VISITS, '1');
    localStorage.setItem(VISITS, String(n + 1));
    return n + 1;
  } catch {
    return 1;
  }
}

/** Something else is open on top (a sheet, a dialog, the keyboard): the prompt waits for a calmer moment. */
const busy = () => document.documentElement.classList.contains('kb-open') || !!document.querySelector('.sheet-scrim, .modal-scrim, .pop-scrim, .palette-scrim, .push-screen, .compose');

/** Tell the install prompt that someone just finished something (a task done): a good moment to offer it. */
export const offerInstall = () => window.dispatchEvent(new CustomEvent('s2g:finished'));

/**
 * On a phone, nudges people to add sprint2go to their home screen (there's no App Store app yet). Android and
 * Chrome get a real Install button; iPhone gets the three taps for Safari. "Not now" waits two weeks.
 * It never interrupts a first look: it's offered right after someone finishes a task, or on their second visit once
 * they move to another app. Add ?install=1 to the address to see it on any screen.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BIP | null>(null);
  const [show, setShow] = useState(false);
  const forced = new URLSearchParams(location.search).has('install');

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault(); // we show our own, nicer prompt
      setDeferred(e as BIP);
    };
    addEventListener('beforeinstallprompt', onBip);
    const onInstalled = () => setShow(false);
    addEventListener('appinstalled', onInstalled);
    const visits = countVisit();
    let t = 0;
    const offer = (ms: number) => {
      if (!forced && (!isPhone() || installed() || snoozed())) return;
      clearTimeout(t);
      t = window.setTimeout(() => (busy() ? undefined : setShow(true)), ms);
    };
    const onFinished = () => offer(1200); // after the tick and its toast
    const onMoved = () => visits >= 2 && offer(900);
    addEventListener('s2g:finished', onFinished);
    addEventListener('s2g:app', onMoved);
    if (forced) offer(300);
    return () => (clearTimeout(t), removeEventListener('beforeinstallprompt', onBip), removeEventListener('appinstalled', onInstalled), removeEventListener('s2g:finished', onFinished), removeEventListener('s2g:app', onMoved));
  }, [forced]);

  if (!show) return null;
  const later = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* storage blocked: it will ask again next visit */
    }
    setShow(false);
  };
  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    if (outcome === 'accepted') setShow(false);
  };
  const ios = isIOS();

  return (
    <div className="install-scrim" onMouseDown={later}>
      <div className="install-sheet" role="dialog" aria-label={`Install ${product.name}`} onMouseDown={(e) => e.stopPropagation()}>
        <button className="icon-btn sm install-x" onClick={later} aria-label="Not now">
          <X size={16} />
        </button>
        <img src="/icon-192.png" alt="" className="install-icon" />
        <h2>Get the {product.name} app</h2>
        <p>Add it to your home screen. It opens full screen with its own icon, like any app, and keeps you signed in. No app store needed.</p>
        {deferred ? (
          <button className="primary-btn install-go" onClick={() => void install()}>
            Install {product.name}
          </button>
        ) : ios ? (
          <ol className="install-steps">
            <li>
              <span>1</span> <i className="install-step">Tap <Share size={16} /> <b>Share</b> in Safari’s toolbar</i>
            </li>
            <li>
              <span>2</span> <i className="install-step">Choose <Plus size={16} /> <b>Add to Home Screen</b></i>
            </li>
            <li>
              <span>3</span> <i className="install-step">Tap <b>Add</b></i>
            </li>
          </ol>
        ) : (
          <ol className="install-steps">
            <li>
              <span>1</span> <i className="install-step">Open your browser menu <MoreVertical size={16} /></i>
            </li>
            <li>
              <span>2</span> <i className="install-step">Choose <b>Install app</b> or <b>Add to Home screen</b></i>
            </li>
          </ol>
        )}
        <button className="ghost-btn install-later" onClick={later}>
          {deferred ? 'Not now' : 'Got it'}
        </button>
      </div>
    </div>
  );
}
