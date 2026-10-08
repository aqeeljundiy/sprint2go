import { useEffect, useState } from 'react';
import type { User, Workspace } from './types';
import { SIGNED_IN_DEFAULT, USERS, WORKSPACES } from './data/workspaces';
import { usePersisted, useSettings } from './settings';
import { applyRemote, useStored } from './store';
import { connect, loadMailInfo, probe, server, signIn, signOut, type Session } from './sync';
import { setAIWorkspace } from './ai';
import App from './App';
import { clientActions } from './clientActions';
import { accessFor, afterEnd, clientInbox, portalsFor } from './clientView';
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher';
import { ActingBanner, AdminApp, ClientApp, Onboarding, SharedHome } from './lazy';
import { setPhotos } from './photos';
import { Wordmark } from './components/Logo';
import { AcceptInvite, SignIn, SignUp } from './components/SignIn';
import { TwoStepGate } from './components/TwoStep';
import { InstallPrompt } from './components/InstallPrompt';
import { brand as product, brandOf, setBrandName } from './terms';
import { registerStages } from './stages';
import { applyPricing, type PricingOverride } from './data/pricing';
import { loadCaps } from './caps';

/**
 * With the local server: real sign-in, data from the database, live updates.
 * Without it (the standalone demo file): pick any demo person, data stays in this tab.
 */
export default function Root() {
  const [mode, setMode] = useState<'probing' | 'demo' | 'signed-out' | 'two-step' | 'ready'>('probing');
  const [session, setSession] = useState<Session | null>(null);
  const invite = new URLSearchParams(location.search).get('invite');
  const [signingUp, setSigningUp] = useState(() => location.pathname === '/signup');
  const admin = location.pathname.startsWith('/admin'); // the operator backend: its own screens, its own API

  // Before the app opens (sign-in, the two-step code, an invite), nobody's settings apply yet: follow the device.
  const preApp = mode === 'signed-out' || mode === 'two-step' || !!invite;
  useEffect(() => {
    if (!preApp) return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => (document.documentElement.dataset.theme = mq.matches ? 'dark' : 'light');
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [preApp]);

  useEffect(() => {
    if (invite) return;
    // Prices changed from the backend apply before anything shows a price.
    void fetch('/api/pricing')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { pricing?: PricingOverride } | null) => applyPricing(d?.pricing), () => {});
    void probe().then(async (r) => {
      if (r === 'none') return setMode('demo');
      await loadCaps(); // what this server can do, before anything shows (features that can't work stay hidden)
      if (r === 'signed-out') return setMode('signed-out');
      setSession(r);
      if (r.twoStep) return setMode('two-step'); // the password is done; the code (or setting it up) comes first
      server.operator = !!r.operator;
      server.flags = r.flags ?? [];
      void loadMailInfo();
      if (!r.suspended && !admin) await connect(applyRemote);
      setMode('ready');
    });
  }, [invite, admin]);

  if (invite) return <AcceptInvite token={invite} onDone={() => location.replace('/')} />;
  if (mode === 'probing') return <div className="boot" />;
  if (mode === 'signed-out' && signingUp) return <SignUp onDone={() => location.replace('/')} onSignIn={() => (setSigningUp(false), history.replaceState(null, '', '/signin'))} />;
  if (mode === 'signed-out')
    return (
      <SignIn
        onCreate={() => (setSigningUp(true), history.replaceState(null, '', '/signup'))}
        users={[]}
        signedIn={[]}
        realPasswords
        onPick={() => {}}
        onForget={() => {}}
        onSignIn={async (email, password) => {
          const r = await signIn(email, password);
          if ('error' in r) return r.error;
          // Two-step sign-in next: straight to the code (or setup) screen, without reloading.
          if (r.twoStep) return (setSession({ me: r.me, twoStep: r.twoStep, email, companies: r.companies }), setMode('two-step'), null);
          location.reload();
          return null;
        }}
      />
    );
  if (mode === 'two-step' && session?.twoStep) return <TwoStepGate need={session.twoStep} email={session.email} companies={session.companies} />;
  if (mode === 'ready' && session?.suspended) return <Suspended reason={session.suspended.reason} />;
  if (admin && (mode === 'ready' || mode === 'demo')) return <AdminApp />;
  if (mode === 'ready' && session)
    return (
      <>
        <ServerRoot me={session.me} />
        <InstallPrompt />
        {session.actingAs && <ActingBanner operator={session.actingAs} />}
        {session.maintenance && (
          <div className="maint-banner" role="status">
            {session.maintenance}
          </div>
        )}
        {!session.actingAs && !!session.suspendedIn?.length && (
          <div className="op-banner warn" role="status">
            <span>
              {session.suspendedIn.map((w) => w.name).join(', ')} {session.suspendedIn.length === 1 ? 'is' : 'are'} suspended{session.suspendedIn[0].reason ? `: ${session.suspendedIn[0].reason}` : ''}. Everything stays, nothing can be changed until it is lifted.
            </span>
          </div>
        )}
      </>
    );
  return <DemoRoot />;
}

/** The account itself is suspended by an operator: nothing to do here but sign out. */
function Suspended({ reason }: { reason: string }) {
  return (
    <div className="signin">
      <div className="signin-card">
        <Wordmark height={30} />
        <h1>This account is suspended</h1>
        <p className="signin-sub">{reason || 'Contact support to find out why.'}</p>
        <button className="primary-btn signin-btn" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}

/** Signed in to the local server: one person per browser, everything saved in the database. */
function ServerRoot({ me }: { me: string }) {
  const [users, setUsers] = useStored('users');
  const [workspaces, setWorkspaces] = useStored('workspaces');
  const user = users.find((u) => u.id === me);
  // Only a client somewhere (no workspace of their own): straight to their portal.
  if (user && !workspaces.some((w) => w.members.some((m) => m.userId === me))) return <ClientRoot me={user} />;
  if (!user) return <NoWorkspace email="" onBack={() => void signOut()} />;
  return (
    <App
      key={user.id}
      user={user}
      signedInUsers={[user]}
      allUsers={users}
      workspaces={workspaces}
      setWorkspaces={setWorkspaces}
      onWorkspace={setAIWorkspace}
      onSwitchUser={() => {}}
      onAddUser={() => void signOut()}
      onSignOut={() => void signOut()}
      onInvite={async (u) => {
        setUsers((list) => (list.some((x) => x.id === u.id) ? list : [...list, u]));
        const r = await fetch('/api/invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: u.id, email: u.email }) });
        if (!r.ok) return null;
      const { link } = (await r.json()) as { link: string | null };
      return link ? `${location.origin}${link}` : null; // null: they already sign in, nothing to send
      }}
      onUpdateUser={(patch) => setUsers((list) => list.map((x) => (x.id === user.id ? { ...x, ...patch } : x)))}
    />
  );
}

/** The demo: several people signed in on one device, switch between them freely. */
function DemoRoot() {
  const [users, setUsers] = usePersisted<User[]>('s2g-users', USERS);
  const [workspaces, setWorkspaces] = usePersisted<Workspace[]>('s2g-workspaces', WORKSPACES);
  const [signedIn, setSignedIn] = usePersisted<string[]>('s2g-signed-in', SIGNED_IN_DEFAULT);
  const [current, setCurrent] = usePersisted<string | null>('s2g-user', USERS[0].id);

  const user = users.find((u) => u.id === current && signedIn.includes(u.id));
  const signedInUsers = signedIn.map((id) => users.find((u) => u.id === id)).filter(Boolean) as User[];

  if (!user)
    return (
      <SignIn
        users={users}
        signedIn={signedInUsers}
        onPick={setCurrent}
        onForget={(id) => setSignedIn((s) => s.filter((x) => x !== id))}
        onSignIn={(email) => {
          const u = users.find((x) => x.email.toLowerCase() === email.toLowerCase());
          if (!u) return `No ${product.name} user with that email. Ask your company admin to invite you.`;
          setSignedIn((s) => (s.includes(u.id) ? s : [...s, u.id]));
          setCurrent(u.id);
          return null;
        }}
      />
    );

  if (!workspaces.some((w) => w.members.some((m) => m.userId === user.id))) return <NoWorkspace email={user.email} onBack={() => setCurrent(null)} />;

  return (
    <App
      key={user.id}
      user={user}
      signedInUsers={signedInUsers}
      allUsers={users}
      workspaces={workspaces}
      setWorkspaces={setWorkspaces}
      onSwitchUser={setCurrent}
      onAddUser={() => setCurrent(null)}
      onSignOut={() => {
        setSignedIn((s) => s.filter((x) => x !== user.id));
        setCurrent(null);
      }}
      onInvite={(u) => {
        setUsers((list) => [...list, u]);
        return Promise.resolve(null);
      }}
      onUpdateUser={(patch) => setUsers((list) => list.map((x) => (x.id === user.id ? { ...x, ...patch } : x)))}
    />
  );
}

function NoWorkspace({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <div className="signin">
      <div className="signin-card">
        <h1>No workspace yet</h1>
        <p className="signin-sub">{email} isn’t in any workspace. Ask an admin to invite you.</p>
        <button className="primary-btn signin-btn" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

/** A brand-new account with no company and nothing shared with them yet: set up their company. */
function FirstRun({ me, existingEmails }: { me: User; existingEmails: string[] }) {
  useSettings(me);
  const [open, setOpen] = useState(true);
  return (
    <div className="signin">
      <div className="signin-card">
        <Wordmark height={30} />
        <h1>Welcome, {me.name.split(' ')[0]}</h1>
        <p className="signin-sub">Set up your company in about a minute: name and logo, which apps you want, your email and your team.</p>
        <button className="primary-btn signin-btn" onClick={() => setOpen(true)}>
          Set up my company
        </button>
        <p className="signin-switch">
          Joining a team instead? Ask them to invite {me.email}, then{' '}
          <button type="button" className="link-btn" onClick={() => void signOut()}>
            sign out
          </button>{' '}
          and open their link.
        </p>
      </div>
      {open && (
        <Onboarding
          me={me}
          existingEmails={existingEmails}
          onClose={() => setOpen(false)}
          onCreate={async (w, newUsers) => {
            const r = await fetch('/api/workspace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace: w, users: newUsers }) });
            if (r.ok) location.replace('/');
            else alert(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Couldn’t create the workspace. Try again.');
          }}
        />
      )}
    </div>
  );
}

/** Someone at a client, signed in: their portal, with only what the company shares (the server enforces it). */
function ClientRoot({ me }: { me: User }) {
  const [settings, updateSettings] = useSettings(me); // light or dark, like the team app
  const [users, setUsers] = useStored('users');
  setPhotos(users);
  const self = users.find((u) => u.id === me.id) ?? me;
  const [workspaces] = useStored('workspaces');
  const [clients, setClients] = useStored('clients');
  const [teams] = useStored('teams');
  const [todos, setTodos] = useStored('todos');
  const [quotes, setQuotes] = useStored('quotes');
  const [channels, setChannels] = useStored('channels');
  const [messages, setMessages] = useStored('messages');
  const [meetings] = useStored('meetings');
  const [drive, setDrive] = useStored('drive');
  const [notices, setNotices] = useStored('notices');
  // Someone can be a client of more than one company: one portal at a time, with a switcher.
  const portals = portalsFor(me.email, [], workspaces, clients, channels);
  registerStages(workspaces); // each company's task stages (kinds only for guests): what "In progress" or "Waiting on you" means
  const [key, setKey] = usePersisted(`s2g-portal:${me.id}`, '');
  const [starting, setStarting] = useState(false);
  // More than one project shared with them: start on "Shared with you" (grouped by company), unless one is open.
  const home = portals.length > 1 && !portals.some((pt) => pt.key === key);
  const portal = portals.find((pt) => pt.key === key) ?? portals[0];
  const ws = portal?.ws;
  const client = portal?.client;
  useEffect(() => {
    if (ws) setAIWorkspace(ws.id);
  }, [ws?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!portal || !ws || !client) return <FirstRun me={me} existingEmails={users.map((u) => u.email.toLowerCase())} />;
  const start = (
    starting && (
      <Onboarding
        me={me}
        existingEmails={users.map((u) => u.email.toLowerCase())}
        onClose={() => setStarting(false)}
        onCreate={async (w, newUsers) => {
          const r = await fetch('/api/workspace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace: w, users: newUsers }) });
          if (r.ok) location.reload();
          else alert(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Couldn’t create the workspace. Try again.');
        }}
      />
    )
  );
  if (home)
    return (
      <>
        <SharedHome name={me.name} portals={portals} todos={todos} channels={channels} messages={messages} onOpen={setKey} onStart={() => setStarting(true)} onSignOut={() => void signOut()} />
        {start}
      </>
    );
  setBrandName(brandOf(ws)); // the inviting company's brand (an agency's own, when white-labelled)
  const { person, access } = afterEnd(client, portal.person, accessFor(ws, client));
  const team = users.filter((u) => !u.clientOf);
  const actions = clientActions({
    ws,
    client,
    person,
    access,
    team,
    teams,
    todos,
    channels,
    messages,
    meetings,
    drive,
    setTodos,
    setMessages,
    setDrive,
    setClients,
    setNotices,
    setChannels,
    makeInvite: async (p) => {
      const r = await fetch('/api/client-invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, clientId: client.id, ...p }) });
      if (!r.ok) return null;
      const { link } = (await r.json()) as { link: string | null };
      return link ? `${location.origin}${link}` : null; // null: they already sign in, nothing to send
    },
  });
  const inbox = [me.id, clientInbox(me.email)];
  return (
    <ClientApp
      ws={ws}
      client={client}
      person={person}
      access={access}
      team={team}
      actions={actions}
      messages={messages}
      allTasks={todos}
      quotes={quotes.filter((q) => q.workspaceId === ws.id)}
      onDecideQuote={(id, status, text) => setQuotes((qs) => qs.map((x) => (x.id === id ? { ...x, status, decidedAt: new Date().toISOString(), decidedBy: me.email, signature: status === 'accepted' ? text || me.name : undefined, note: status === 'declined' && text ? text : undefined } : x)))}
      notices={notices.filter((n) => inbox.includes(n.userId))}
      onReadNotices={() => setNotices((ns) => ns.map((n) => (inbox.includes(n.userId) ? { ...n, read: true } : n)))}
      onSignOut={() => void signOut()}
      account={{ me: self, theme: settings.theme, onTheme: (t) => updateSettings({ theme: t }), onProfile: (patch) => setUsers((list) => list.map((u) => (u.id === me.id ? { ...u, ...patch } : u))) }}
      switcher={<WorkspaceSwitcher workspaces={[]} current={ws} currentPortal={portal.key} unread={{}} portals={portals} onPortal={setKey} onSwitch={() => {}} onHome={portals.length > 1 ? () => setKey('') : undefined} onAdd={() => setStarting(true)} addLabel="Start your own workspace (free)" />}
    />
  );
}
