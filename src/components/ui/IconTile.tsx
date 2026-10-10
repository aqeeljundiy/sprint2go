import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * One tile family for icons and things that aren't people (the launcher's look): a rounded square (22% radius) in a
 * pale tint of a colour, with the icon or an initial in that colour. Use it for app icons (launcher, Settings rows,
 * app headers) and for projects and teams (an initial), so the same object looks the same everywhere. People are
 * always round avatars (Avatar), never this.
 *
 *   <IconTile icon={Mail} app="mail" />                 an app, in its colour ([data-app] in launcher.css)
 *   <IconTile letter="S" color={project.color} />       a project or team
 *   <IconTile icon={Bell} color="var(--accent)" size={32} />
 */
export function IconTile({ icon: Icon, letter, app, color, size = 32, className = '', children }: { icon?: LucideIcon; letter?: string; app?: string; color?: string; size?: 24 | 32 | 40 | 56; className?: string; children?: ReactNode }) {
  const style = { '--tile': `${size}px`, ...(color ? { '--c': color } : {}) } as CSSProperties;
  const glyph = size >= 56 ? 28 : size >= 40 ? 20 : size >= 32 ? 18 : 14;
  return (
    <span className={`icon-tile ${className}`} data-app={app} style={style} aria-hidden={!children}>
      {Icon ? <Icon size={glyph} strokeWidth={1.75} /> : <b>{(letter ?? '').trim().charAt(0).toUpperCase()}</b>}
      {children}
    </span>
  );
}
