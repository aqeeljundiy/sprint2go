import type { User, Workspace } from './types';
import { SIGNED_IN_DEFAULT, USERS, WORKSPACES } from './data/workspaces';
import { usePersisted } from './settings';
import App from './App';
import { SignIn } from './components/SignIn';

/** Who is signed in on this device, and which of them is using the app right now. */
export default function Root() {
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
          if (!u) return 'No Sprint2go user with that email. Ask your company admin to invite you.';
          setSignedIn((s) => (s.includes(u.id) ? s : [...s, u.id]));
          setCurrent(u.id);
          return null;
        }}
      />
    );

  if (!workspaces.some((w) => w.members.some((m) => m.userId === user.id)))
    return (
      <div className="signin">
        <div className="signin-card">
          <h1>No workspace yet</h1>
          <p className="signin-sub">{user.email} isn’t in any workspace. Ask an admin to invite you.</p>
          <button className="primary-btn signin-btn" onClick={() => setCurrent(null)}>
            Back to accounts
          </button>
        </div>
      </div>
    );

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
      onInvite={(u) => setUsers((list) => [...list, u])}
      onUpdateUser={(patch) => setUsers((list) => list.map((x) => (x.id === user.id ? { ...x, ...patch } : x)))}
    />
  );
}
