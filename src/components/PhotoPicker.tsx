import { useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { squarePhoto } from '../photos';
import { Avatar } from './Avatar';
import { t } from '../i18n';

/** A profile photo you can click to change: crops square, keeps it small. Falls back to initials on a colour. */
export function PhotoPicker({ name, email, color, photo, size = 72, onChange }: { name: string; email: string; color: string; photo?: string; size?: number; onChange: (photo: string | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');
  const pick = async (f?: File) => {
    if (!f) return;
    try {
      setErr('');
      onChange(await squarePhoto(f));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="photo-picker">
      <button type="button" className="pp-avatar" onClick={() => input.current?.click()} title={t('Change photo')} style={{ width: size, height: size }}>
        <Avatar person={{ name, email, color, photo: photo ?? '' }} size={size} />
        <span className="pp-over">
          <Camera size={Math.round(size / 4)} />
        </span>
      </button>
      <div className="pp-actions">
        <button type="button" className="ghost-btn sm outline" onClick={() => input.current?.click()}>
          <Camera size={13} /> {photo ? t('Change photo') : t('Add a photo')}
        </button>
        {photo && (
          <button type="button" className="ghost-btn sm" onClick={() => onChange(undefined)}>
            <Trash2 size={13} /> {t('Remove')}
          </button>
        )}
        {err && <small className="err">{t(err)}</small>}
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => (void pick(e.target.files?.[0]), (e.target.value = ''))} />
    </div>
  );
}
