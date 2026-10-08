import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root';
import { startExitAnimations } from './exitAnimations';
import { startSlidingTabs } from './slidingTabs';
import './styles.css';
import './calendar.css';
import './shell.css';
import './brand.css';
import './apps.css';
import './ui.css';
import './round2.css';
import './tables.css';
import './teams.css';
import './polish.css';

startExitAnimations();
startSlidingTabs();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

// Installable on phones and desktops (Add to Home Screen). Only in the built app, so development never gets a stale worker.
if (import.meta.env.PROD && 'serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});
