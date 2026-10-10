import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';

export interface CreateChoice {
  id: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
}

/**
 * Google Calendar's + menu on phones: the choices rise as pills above the round + (which turns into an X), over a
 * whitened page. Tap one, the page or the X to close it. Mount it while open; it fades out on close
 * (`.cal-create-menu` is in src/exitAnimations.ts).
 */
export function CreateMenu({ choices, onClose }: { choices: CreateChoice[]; onClose: () => void }) {
  // The + turns into an X and stays above the page while the menu is open.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('cal-create-open');
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => {
      root.classList.remove('cal-create-open');
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return createPortal(
    <div className="cal-create-menu" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ccm-list" role="menu">
        {/* Bottom to top: the first choice sits nearest the button. */}
        {[...choices].reverse().map((c, i) => (
          <button
            key={c.id}
            type="button"
            role="menuitem"
            className="ccm-pill"
            style={{ ['--i' as string]: choices.length - 1 - i }}
            onClick={() => {
              onClose();
              c.run();
            }}
          >
            <c.icon size={22} />
            <span>{c.label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
