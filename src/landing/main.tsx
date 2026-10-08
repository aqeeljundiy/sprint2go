import { applyPricing, type PricingOverride } from '../data/pricing';
import { createRoot } from 'react-dom/client';
import { Landing } from './Landing';
import './landing.css';

// Prices set in the operator backend: wait briefly for them, never long.
const render = () => createRoot(document.getElementById('landing')!).render(<Landing />);
Promise.race([
  fetch('/api/pricing')
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { pricing?: PricingOverride } | null) => applyPricing(d?.pricing)),
  new Promise((ok) => setTimeout(ok, 700)),
])
  .catch(() => {})
  .finally(render);
