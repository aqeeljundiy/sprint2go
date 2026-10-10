import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root';
import { startExitAnimations } from './exitAnimations';
import { startSlidingTabs } from './slidingTabs';
import { startKeyboard } from './mobile/keyboard';
import { diagnostics, reportCrash, startDiagnostics } from './diagnostics';
import { startTryOut, trying } from './tryOut';
import { deviceLang, setLang, t } from './i18n';
import { useLang } from './i18n/useLang';
import './tokens.css'; // the one source of tokens: first
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
import './home.css';
import './mail.css';
import './admin.css';
import './notify.css';
import './security.css';
import './jobs.css';
import './notes.css';
import './unlimited.css'; // Settings, Plan & billing on Unlimited (the operators' Whitelist)
import './system.css';
import './mobile/index.css'; // the phone layer: always last

startTryOut(); // /try: the demo in this tab, nothing sent to our server
startExitAnimations();
startSlidingTabs();
startKeyboard();
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
      .then(async (r) => this.setState({ sent: r.ok ? t('Sent as ticket #{number}. We’ll reply in Settings, Help & support.', { number: ((await r.json()) as { number: number }).number }) : t('Couldn’t send it. Sign in, then try again.') }))
      .catch(() => this.setState({ sent: t('Couldn’t send it. Check your connection.') }));
  };
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <div className="crash-card">
          <h1>{t('Something went wrong on this screen')}</h1>
          <p>{t('Your work is saved on the server. Reload to carry on; if it happens again, tell us what you were doing.')}</p>
          <p className="crash-detail">{String(this.state.error.message).slice(0, 200)}</p>
          <div className="crash-actions">
            <button className="ghost-btn" disabled={!!this.state.sent} onClick={this.report}>
              {this.state.sent === 'sending' ? t('Sending…') : t('Send a report')}
            </button>
            <button className="primary-btn" onClick={() => location.reload()}>
              {t('Reload')}
            </button>
          </div>
          {this.state.sent && this.state.sent !== 'sending' && <p className="crash-sent">{this.state.sent}</p>}
        </div>
      </div>
    );
  }
}

/** Re-renders the whole app when the language changes, so every t() runs again (docs/i18n.md). */
function Speaking() {
  useLang();
  return (
    <Crash>
      <Root />
    </Crash>
  );
}

// The words first (only Indonesian has any to fetch), then the app: nobody sees English flash before their language.
void setLang(deviceLang()).finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Speaking />
    </StrictMode>,
  ),
);

// Installable on phones and desktops (Add to Home Screen). Only in the built app, so development never gets a stale worker.
// Not in the try-out: nothing installs and nothing asks for notifications there.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !trying) void navigator.serviceWorker.register('/sw.js').catch(() => {});
