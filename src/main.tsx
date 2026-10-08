import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root';
import { startExitAnimations } from './exitAnimations';
import { startSlidingTabs } from './slidingTabs';
import { diagnostics, reportCrash, startDiagnostics } from './diagnostics';
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
import './tasks.css';
import './admin.css';
import './notify.css';

startExitAnimations();
startSlidingTabs();
startDiagnostics();

/** A crash somewhere shows this instead of a blank page; nothing is lost, the data lives on the server. */
class Crash extends Component<{ children: ReactNode }, { error: Error | null; sent: string | null }> {
  state = { error: null as Error | null, sent: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(error);
    reportCrash(error);
  }
  /** Turns the crash into a support ticket with what we need to fix it. */
  report = () => {
    const e = this.state.error!;
    this.setState({ sent: 'sending' });
    void fetch('/api/support', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel: 'crash', subject: `The app crashed: ${e.message.slice(0, 120)}`, body: `${e.message}\n\n${(e.stack ?? '').slice(0, 3000)}`, context: diagnostics() }) })
      .then(async (r) => this.setState({ sent: r.ok ? `Sent as ticket #${((await r.json()) as { number: number }).number}. We’ll reply in Settings, Help & support.` : 'Couldn’t send it. Sign in, then try again.' }))
      .catch(() => this.setState({ sent: 'Couldn’t send it. Check your connection.' }));
  };
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <div className="crash-card">
          <h1>Something went wrong on this screen</h1>
          <p>Your work is saved on the server. Reload to carry on; if it happens again, tell us what you were doing.</p>
          <p className="crash-detail">{String(this.state.error.message).slice(0, 200)}</p>
          <div className="crash-actions">
            <button className="ghost-btn" disabled={!!this.state.sent} onClick={this.report}>
              {this.state.sent === 'sending' ? 'Sending…' : 'Send a report'}
            </button>
            <button className="primary-btn" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
          {this.state.sent && this.state.sent !== 'sending' && <p className="crash-sent">{this.state.sent}</p>}
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
