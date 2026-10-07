// Profile photos, by email. Set from the people list on each render, so every Avatar (even ones built from
// just a name and an email) shows the photo without passing it around.
const byEmail = new Map<string, string>();

export function setPhotos(users: { email: string; photo?: string }[]) {
  byEmail.clear();
  for (const u of users) if (u.photo) byEmail.set(u.email.toLowerCase(), u.photo);
}

export const photoOf = (email?: string) => (email ? byEmail.get(email.toLowerCase()) : undefined);

/** Reads an image file, crops it square and shrinks it to 256px, as a small JPEG data URL (about 20 KB). */
export function squarePhoto(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Pick an image (JPG, PNG or WebP).'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => (URL.revokeObjectURL(url), reject(new Error('That image couldn’t be read.')));
    img.src = url;
  });
}
