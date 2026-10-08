import { Component, StrictMode, type ReactNode } from 'react';
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

/** A crash somewhere shows this instead of a blank page; nothing is lost, the data lives on the server. */
class Crash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <div className="crash-card">
          <h1>Something went wrong on this screen</h1>
          <p>Your work is saved on the server. Reload to carry on; if it happens again, tell us what you were doing.</p>
          <p className="crash-detail">{String(this.state.error.message).slice(0, 200)}</p>
          <button className="primary-btn" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Crash>
      <Root />
    </Crash>
  </StrictMode>,
);

// Installable on phones and desktops (Add to Home Screen). Only in the built app, so development never gets a stale worker.
if (import.meta.env.PROD && 'serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});
