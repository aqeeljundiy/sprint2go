import { useEffect, useState } from 'react';
import { MoreVertical, Plus, Share, X } from 'lucide-react';
import { brand as product } from '../terms';

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const KEY = 's2g-install-later';
const LATER_DAYS = 14;

const ua = () => navigator.userAgent;
const isIOS = () => /iPhone|iPad|iPod/i.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isPhone = () => matchMedia('(max-width: 760px)').matches || /Android|iPhone|iPad|iPod/i.test(ua());
const installed = () => matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const snoozed = () => {
  try {
    const t = Number(localStorage.getItem(KEY) ?? 0);
    return Date.now() - t < LATER_DAYS * 86_400_000;
  } catch {
    return false;
  }
};

/**
 * On a phone, nudges people to add Sprint2go to their home screen (there's no App Store app yet). Android and
 * Chrome get a real Install button; iPhone gets the three taps for Safari. "Not now" waits two weeks.
 * Add ?install=1 to the address to see it on any screen.
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
    const t = setTimeout(() => {
      if (forced || (isPhone() && !installed() && !snoozed())) setShow(true);
    }, forced ? 300 : 4000);
    return () => (clearTimeout(t), removeEventListener('beforeinstallprompt', onBip), removeEventListener('appinstalled', onInstalled));
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
              <span>1</span> Tap <Share size={16} /> <b>Share</b> in Safari’s toolbar
            </li>
            <li>
              <span>2</span> Choose <Plus size={16} /> <b>Add to Home Screen</b>
            </li>
            <li>
              <span>3</span> Tap <b>Add</b>
            </li>
          </ol>
        ) : (
          <ol className="install-steps">
            <li>
              <span>1</span> Open your browser menu <MoreVertical size={16} />
            </li>
            <li>
              <span>2</span> Choose <b>Install app</b> or <b>Add to Home screen</b>
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
