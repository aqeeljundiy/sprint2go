/** A short burst of confetti from a point (or the middle of the screen). Plain DOM, no library. */
export function celebrate(from?: { x: number; y: number }) {
  if (typeof document === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const x0 = from?.x ?? window.innerWidth / 2;
  const y0 = from?.y ?? window.innerHeight / 3;
  const colors = ['#2448ff', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444'];
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  document.body.appendChild(layer);
  for (let i = 0; i < 70; i++) {
    const p = document.createElement('i');
    const angle = Math.random() * Math.PI * 2;
    const speed = 120 + Math.random() * 260;
    p.style.left = x0 + 'px';
    p.style.top = y0 + 'px';
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--dx', Math.cos(angle) * speed + 'px');
    p.style.setProperty('--dy', Math.sin(angle) * speed - 120 + 'px');
    p.style.setProperty('--r', Math.random() * 720 - 360 + 'deg');
    p.style.animationDelay = Math.random() * 80 + 'ms';
    layer.appendChild(p);
  }
  setTimeout(() => layer.remove(), 1600);
}
