import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import type { Client } from '../types';
import { squarePhoto } from '../photos';

/** A project's picture: its photo or logo when it has one, otherwise its first letter on its colour. */
export function ProjectBadge({ p, kind = 'client-dot', className = '' }: { p: Pick<Client, 'name' | 'color' | 'photo'>; kind?: 'client-dot' | 'client-dot sm' | 'client-badge'; className?: string }) {
  return (
    <span className={`${kind} ${p.photo ? 'has-photo' : ''} ${className}`} style={{ background: p.photo ? undefined : p.color }}>
      {p.photo ? <img src={p.photo} alt="" draggable={false} /> : p.name.charAt(0)}
    </span>
  );
}

/** The badge as a button that changes the picture (cropped square and kept small, like profile photos). */
export function ProjectPhotoButton({ p, onChange, disabled }: { p: Pick<Client, 'name' | 'color' | 'photo'>; onChange: (photo: string | undefined) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');
  if (disabled) return <ProjectBadge p={p} kind="client-badge" />;
  return (
    <>
      <button type="button" className="proj-photo-btn" onClick={() => input.current?.click()} title={err || (p.photo ? 'Change picture (right-click to remove)' : 'Add a picture or logo')} onContextMenu={(e) => p.photo && (e.preventDefault(), confirm('Remove this picture?') && onChange(undefined))}>
        <ProjectBadge p={p} kind="client-badge" />
        <span className="pp-over">
          <Camera size={13} />
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            setErr('');
            onChange(await squarePhoto(f));
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      />
    </>
  );
}
