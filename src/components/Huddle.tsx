import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Headphones, Mic, MicOff, PhoneOff } from 'lucide-react';
import type { Channel, User } from '../types';
import { Avatar } from './Avatar';
import { sendSignal } from '../sync';
import { caps } from '../caps';
import { iceConfig, redacted } from '../ice';

type Note = { channelId: string; kind: 'offer' | 'answer' | 'ice' | 'bye'; sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit };
/** How the line to one person is doing. blocked: no route between the two networks; silent: they never answered. */
type Line = 'connecting' | 'connected' | 'retrying' | 'blocked' | 'silent';
const LINE_LABEL: Record<Line, string> = { connecting: 'Connecting', connected: '', retrying: 'Reconnecting', blocked: 'Can’t connect', silent: 'Not answering' };

interface Peer {
  pc: RTCPeerConnection;
  offeredAt: number; // when our offer that has no answer yet went out (0: none)
  early: RTCIceCandidateInit[]; // their candidates that came before their offer or answer
  restarted: boolean; // a fresh route was tried since the line last worked
  wasUp: boolean; // it has worked before: trying again is "reconnecting", not "connecting"
  status?: 'up' | 'failed' | 'down' | 'trying';
  timer?: ReturnType<typeof setTimeout>;
}

const CONNECT_WAIT = 15_000; // a new line that isn't up by then counts as failed (browsers can keep "checking" far longer)
const DISCONNECT_WAIT = 5_000; // a dropped line often comes back by itself within a few seconds
const RESTART_WAIT = 12_000; // time a fresh route gets before we say it didn't work
const STALE_OFFER = 2_500; // an offer with no answer by then went to someone who wasn't in the huddle yet

const isUp = (pc: RTCPeerConnection) => (pc.connectionState ? pc.connectionState === 'connected' : pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed');
const statusOf = (pc: RTCPeerConnection): NonNullable<Peer['status']> =>
  isUp(pc) ? 'up' : pc.connectionState === 'failed' || pc.iceConnectionState === 'failed' ? 'failed' : pc.connectionState === 'disconnected' || pc.iceConnectionState === 'disconnected' ? 'down' : 'trying';

/**
 * A huddle: a quick voice call in a channel, docked bottom-left while you keep working. Audio goes browser to
 * browser (WebRTC, one connection per other person), through our call relay when the server has one and the two
 * networks can't reach each other directly; the server only relays the setup notes. A line that fails gets one
 * fresh route (an ICE restart); if that fails too, the huddle says so instead of staying silent.
 */
export function Huddle({ channel, users, me, onLeave }: { channel: Channel; users: User[]; me: string; onLeave: () => void }) {
  const [muted, setMuted] = useState(false);
  const [mic, setMic] = useState<'asking' | 'on' | 'denied'>('asking');
  const [streams, setStreams] = useState<Record<string, MediaStream>>({});
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [relay, setRelay] = useState(caps.relay);
  const local = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<string, Peer>());
  const queues = useRef(new Map<string, Promise<void>>());
  const alive = useRef(true);
  const members = channel.huddle?.members ?? [];
  const others = members.filter((id) => id !== me);
  const othersNow = useRef(others);
  othersNow.current = others;

  const note = (to: string, n: Omit<Note, 'channelId'>) => sendSignal(to, { channelId: channel.id, ...n } satisfies Note);
  const setLine = (id: string, l: Line | null) =>
    setLines((s) => {
      if ((s[id] ?? null) === l) return s;
      const n = { ...s };
      if (l) n[id] = l;
      else delete n[id];
      return n;
    });
  /** When both sides start a negotiation at once, the polite one gives way (decided the same way on both ends). */
  const polite = (id: string) => me < id;
  /** Work on one person's line one step at a time, in order: their notes and our own offers. */
  const enqueue = (id: string, step: () => Promise<void>) =>
    queues.current.set(
      id,
      (queues.current.get(id) ?? Promise.resolve()).then(step).catch((e) => {
        if (import.meta.env.DEV) console.warn('[huddle]', e);
      }),
    );

  const peerFor = async (id: string) => {
    const ice = await iceConfig();
    if (!alive.current) return null;
    const had = peers.current.get(id);
    if (had) return had;
    setRelay(ice.relay);
    if (import.meta.env.DEV) console.info('[huddle] RTCPeerConnection config', redacted(ice.config));
    const pc = new RTCPeerConnection(ice.config);
    const p: Peer = { pc, offeredAt: 0, early: [], restarted: false, wasUp: false };
    peers.current.set(id, p);
    const s = local.current;
    s?.getTracks().forEach((t) => pc.addTrack(t, s));
    pc.onicecandidate = (e) => e.candidate && note(id, { kind: 'ice', ice: e.candidate.toJSON() });
    pc.ontrack = (e) => setStreams((st) => ({ ...st, [id]: e.streams[0] ?? new MediaStream([e.track]) }));
    pc.oniceconnectionstatechange = () => watch(id);
    pc.onconnectionstatechange = () => watch(id);
    setLine(id, 'connecting');
    arm(id, CONNECT_WAIT);
    return p;
  };

  /** Checks the line again after a while; still not up means it failed. */
  const arm = (id: string, ms: number) => {
    const p = peers.current.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    p.timer = setTimeout(() => peers.current.get(id) === p && !isUp(p.pc) && recover(id), ms);
  };
  const watch = (id: string) => {
    const p = peers.current.get(id);
    if (!p) return;
    const s = statusOf(p.pc);
    if (s === p.status) return;
    p.status = s;
    if (import.meta.env.DEV) console.info('[huddle] line to', id, s, `(ice ${p.pc.iceConnectionState}, connection ${p.pc.connectionState})`);
    if (s === 'up') {
      clearTimeout(p.timer);
      p.restarted = false;
      p.wasUp = true;
      setLine(id, 'connected');
    } else if (s === 'failed') recover(id);
    else if (s === 'down') {
      setLine(id, p.wasUp ? 'retrying' : 'connecting');
      if (!p.restarted) arm(id, DISCONNECT_WAIT);
    }
  };
  /** The line failed: try a fresh route once (with new relay credentials if they're due), then say so. */
  const recover = (id: string) => {
    const p = peers.current.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    // Our last offer still has no answer: they're gone (closed the app, lost their connection). Answered: no route.
    if (p.restarted) return setLine(id, p.pc.signalingState === 'have-local-offer' || !p.pc.remoteDescription ? 'silent' : 'blocked');
    p.restarted = true;
    setLine(id, p.wasUp ? 'retrying' : 'connecting');
    arm(id, RESTART_WAIT);
    enqueue(id, () => offer(id, true));
  };

  /** Our offer to one person: the first call, adding our voice later, or a fresh route (ICE restart). */
  const offer = async (id: string, iceRestart = false) => {
    if (!peers.current.has(id) && !othersNow.current.includes(id)) return; // they left before this step came up
    const p = await peerFor(id);
    if (!p) return;
    const { pc } = p;
    if (iceRestart) {
      const ice = await iceConfig();
      try {
        pc.setConfiguration({ ...pc.getConfiguration(), iceServers: ice.config.iceServers });
      } catch {
        /* keep the list it has */
      }
    }
    if (!pc.getTransceivers().length) pc.addTransceiver('audio', { direction: 'recvonly' }); // no microphone: listen only
    await pc.setLocalDescription(await pc.createOffer({ iceRestart }));
    const d = pc.localDescription;
    if (!d) return;
    note(id, { kind: 'offer', sdp: { type: d.type, sdp: d.sdp } });
    p.offeredAt = Date.now();
  };

  /** A note from someone in the huddle. Only an offer opens a line; the rest belongs to one that exists. */
  const receive = async (from: string, n: Note) => {
    if (n.kind === 'bye') return drop(from);
    const p = n.kind === 'offer' ? await peerFor(from) : peers.current.get(from);
    if (!p) return;
    const { pc } = p;
    if (n.kind === 'offer' && n.sdp) {
      // Both called at once: the polite side gives way, and the other answers its offer. An offer of ours that has
      // waited this long never reached them (they weren't in the huddle yet), so theirs goes ahead.
      const glare = pc.signalingState !== 'stable';
      const stale = p.offeredAt > 0 && Date.now() - p.offeredAt > STALE_OFFER;
      if (glare && !polite(from) && !stale) return;
      if (glare) await pc.setLocalDescription({ type: 'rollback' });
      p.offeredAt = 0;
      await pc.setRemoteDescription(n.sdp);
      await addEarly(p);
      await pc.setLocalDescription(await pc.createAnswer());
      const d = pc.localDescription;
      if (d) note(from, { kind: 'answer', sdp: { type: d.type, sdp: d.sdp } });
    } else if (n.kind === 'answer' && n.sdp) {
      if (pc.signalingState !== 'have-local-offer') return; // the answer to an offer that was set aside
      await pc.setRemoteDescription(n.sdp);
      p.offeredAt = 0;
      await addEarly(p);
    } else if (n.kind === 'ice' && n.ice) {
      if (!pc.remoteDescription) p.early.push(n.ice);
      else await pc.addIceCandidate(n.ice).catch(() => {}); // one from an offer that was set aside
    }
  };
  const addEarly = async (p: Peer) => {
    for (const c of p.early.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
  };

  const drop = (id: string) => {
    const p = peers.current.get(id);
    if (p) {
      clearTimeout(p.timer);
      p.pc.close();
    }
    peers.current.delete(id);
    queues.current.delete(id);
    setStreams((s) => {
      const n = { ...s };
      delete n[id];
      return n;
    });
    setLine(id, null);
  };

  /** Call everyone in the huddle. Lines that already exist (they called while we were asking for the microphone) get our voice added. */
  const callAll = () => {
    for (const id of new Set([...othersNow.current, ...peers.current.keys()]))
      enqueue(id, async () => {
        const p = peers.current.get(id);
        const s = local.current;
        if (p && s) s.getTracks().forEach((t) => p.pc.getSenders().some((x) => x.track === t) || p.pc.addTrack(t, s));
        if (!p || s) await offer(id);
      });
  };

  // Open and close: everything this huddle holds goes when it does.
  useEffect(() => {
    alive.current = true;
    const all = peers.current;
    return () => {
      alive.current = false;
      all.forEach((p) => (clearTimeout(p.timer), p.pc.close()));
      all.clear();
      local.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Microphone, then a call to everyone already in. Without a microphone we still call, to listen.
  useEffect(() => {
    let gone = false;
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((s) => {
        if (gone) return s.getTracks().forEach((t) => t.stop());
        local.current = s;
        setMic('on');
        callAll();
      })
      .catch(() => {
        if (gone) return;
        setMic('denied');
        callAll();
      });
    return () => {
      gone = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Notes from the others, handled in the order they were sent.
  useEffect(() => {
    const on = (e: Event) => {
      const { from, data } = (e as CustomEvent<{ from: string; data: Note }>).detail;
      if (data.channelId === channel.id) enqueue(from, () => receive(from, data));
    };
    window.addEventListener('s2g:signal', on);
    return () => window.removeEventListener('s2g:signal', on);
  }, [channel.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Someone left the channel's huddle: close their line.
  useEffect(() => {
    for (const id of [...peers.current.keys()]) if (!others.includes(id)) drop(id);
  }, [others.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const leave = () => {
    for (const id of new Set([...others, ...peers.current.keys()])) note(id, { kind: 'bye' });
    peers.current.forEach((p) => (clearTimeout(p.timer), p.pc.close()));
    peers.current.clear();
    local.current?.getTracks().forEach((t) => t.stop());
    onLeave();
  };
  const toggleMute = () => {
    const next = !muted;
    local.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  };
  /** Try the failed lines again, each with a fresh route. */
  const retry = () => {
    for (const id of others) {
      if (lines[id] !== 'blocked' && lines[id] !== 'silent') continue;
      const p = peers.current.get(id);
      if (!p) continue;
      p.restarted = false;
      p.status = undefined;
      recover(id);
    }
  };

  const name = channel.kind === 'dm' ? 'Direct message' : `#${channel.name}`;
  const lineOf = (id: string): Line => lines[id] ?? 'connecting';
  const first = (id: string) => users.find((u) => u.id === id)?.name.split(' ')[0] ?? 'Someone';
  const names = (ids: string[]) => (ids.length === 1 ? first(ids[0]) : ids.length === 2 ? `${first(ids[0])} and ${first(ids[1])}` : `${first(ids[0])} and ${ids.length - 1} others`);
  const blocked = others.filter((id) => lineOf(id) === 'blocked');
  const silent = others.filter((id) => lineOf(id) === 'silent');
  const problem = blocked.length
    ? relay
      ? `Couldn’t connect to ${names(blocked)}, even through the call relay. Try again, or switch to another network.`
      : 'This network blocks direct calls. Ask your admin to turn on the call relay.'
    : silent.length
      ? `${names(silent)} ${silent.length === 1 ? 'isn’t' : 'aren’t'} answering. They may have lost their connection.`
      : null;
  const shown = useRef(problem); // keeps the words while the note folds away
  if (problem) shown.current = problem;
  const any = (l: Line) => others.some((id) => lineOf(id) === l);
  const status = (() => {
    if (mic === 'asking') return 'Asking for your microphone…';
    if (any('retrying')) return 'Reconnecting…';
    if (any('connecting') && !any('connected')) return 'Connecting…';
    if (mic === 'denied') return 'No microphone: listening only';
    return others.length ? `${others.length + 1} in the huddle` : 'Waiting for others';
  })();

  return (
    <aside className="huddle" role="region" aria-label={`Huddle in ${name}`}>
      <header>
        <Headphones size={15} />
        <strong>{name}</strong>
        <small className="muted">{status}</small>
        <div className={`fold huddle-fold${problem ? ' open' : ''}`} role="status" aria-live="polite">
          <div className="fold-in">
            <div className="huddle-note">
              <AlertTriangle size={14} />
              <span>{shown.current}</span>
              <button type="button" className="ghost-btn sm" onClick={retry}>
                Try again
              </button>
            </div>
          </div>
        </div>
      </header>
      <div className="huddle-people">
        {members.map((id) => {
          const u = users.find((x) => x.id === id);
          const l = id === me ? 'connected' : lineOf(id);
          return u ? (
            <span key={id} className={`huddle-av is-${l}${id === me && muted ? ' muted' : ''}`} title={LINE_LABEL[l] ? `${u.name}: ${LINE_LABEL[l].toLowerCase()}` : u.name}>
              <Avatar person={u} size={32} />
              {id === me && muted && <MicOff size={10} />}
            </span>
          ) : null;
        })}
      </div>
      {Object.entries(streams).map(([id, s]) => (
        <audio
          key={id}
          autoPlay
          ref={(el) => {
            if (el && el.srcObject !== s) el.srcObject = s;
          }}
        />
      ))}
      <div className="huddle-actions">
        <button type="button" className={`ghost-btn sm${muted ? ' on' : ''}`} onClick={toggleMute} disabled={mic !== 'on'}>
          {muted ? <MicOff size={14} /> : <Mic size={14} />} {muted ? 'Unmute' : 'Mute'}
        </button>
        <button type="button" className="primary-btn sm danger" onClick={leave}>
          <PhoneOff size={14} /> Leave
        </button>
      </div>
    </aside>
  );
}
