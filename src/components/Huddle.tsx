import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Headphones, Maximize2, MessageSquare, Mic, MicOff, Minimize2, PhoneOff, ScreenShare, ScreenShareOff, SmilePlus, Video, VideoOff } from 'lucide-react';
import type { Channel, User } from '../types';
import { Avatar } from './Avatar';
import { sendSignal } from '../sync';
import { caps } from '../caps';
import { iceConfig, redacted } from '../ice';
import { usePhone } from '../mobile/media';
import { PushScreen } from './ui/PushScreen';
import { useHuddleDock } from './chat/huddleDock';
import { chanName } from './chat/Sheets';
import { mark, t, tn } from '../i18n';
import { fmtList, fmtNumber } from '../i18n/format';
import { attach, cameraStarved, canShareScreen, ensureSlots, openSlots, slotOfMid, VIDEO_MAX, type Level, type Slot } from './chat/huddleVideo';
import { HuddleStage, VideoEl, type TileInfo } from './chat/HuddleStage';

// media: what someone has on (camera, screen), so a slot without frames shows their picture instead of black.
type Note = { channelId: string; kind: 'offer' | 'answer' | 'ice' | 'bye' | 'react' | 'media'; sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit; emoji?: string; cam?: boolean; screen?: boolean };
type Media = { cam: boolean; screen: boolean };
const REACTIONS = ['👍', '😂', '👏', '❤️', '🎉', '👀'];

/** Who's talking right now: the level of each voice, checked a few times a second (live status, so it may move). */
function useSpeaking(streams: Record<string, MediaStream>, local: MediaStream | null, me: string, muted: boolean) {
  const [speaking, setSpeaking] = useState<string[]>([]);
  useEffect(() => {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const all = { ...streams, ...(local && !muted ? { [me]: local } : {}) };
    if (!Object.keys(all).length) return setSpeaking([]);
    const ctx = new AC();
    void ctx.resume().catch(() => {});
    const meters = Object.entries(all).flatMap(([id, st]) => {
      if (!st.getAudioTracks().length) return [];
      try {
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        ctx.createMediaStreamSource(st).connect(an);
        return [{ id, an, buf: new Uint8Array(an.fftSize) }];
      } catch {
        return [];
      }
    });
    const t = setInterval(() => {
      const now = meters
        .filter(({ an, buf }) => {
          an.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += ((v - 128) / 128) ** 2;
          return Math.sqrt(sum / buf.length) > 0.035;
        })
        .map((x) => x.id);
      setSpeaking((was) => (was.join() === now.join() ? was : now));
    }, 200);
    return () => (clearInterval(t), void ctx.close().catch(() => {}));
  }, [streams, local, me, muted]);
  return speaking;
}
/** How the line to one person is doing. blocked: no route between the two networks; silent: they never answered. */
type Line = 'connecting' | 'connected' | 'retrying' | 'blocked' | 'silent';
const LINE_LABEL: Record<Line, string> = { connecting: mark('Connecting'), connected: '', retrying: mark('Reconnecting'), blocked: mark('Can’t connect'), silent: mark('Not answering') };

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
export function Huddle({ channel, users, me, onLeave, onOpenChannel }: { channel: Channel; users: User[]; me: string; onLeave: () => void; onOpenChannel?: () => void }) {
  const phone = usePhone();
  const dock = useHuddleDock();
  const [full, setFull] = useState(false); // phones: the call screen over everything
  const [floating, setFloating] = useState<{ id: string; emoji: string; key: number }[]>([]);
  const [reacting, setReacting] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [mic, setMic] = useState<'asking' | 'on' | 'denied'>('asking');
  const [streams, setStreams] = useState<Record<string, MediaStream>>({});
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [relay, setRelay] = useState(caps.relay);
  // Video: our camera and screen, what the others have on, and their video as it arrives (huddleVideo.ts).
  const [cam, setCam] = useState<'off' | 'asking' | 'on'>('off');
  const [sharing, setSharing] = useState(false);
  const [videoNote, setVideoNote] = useState<string | null>(null);
  const [media, setMedia] = useState<Record<string, Media>>({});
  const [vids, setVids] = useState<Record<string, Partial<Record<Slot, MediaStream>>>>({});
  const [expanded, setExpanded] = useState(false); // wider screens: the call as a full view over the app
  const camTrack = useRef<MediaStreamTrack | null>(null);
  const screenTrack = useRef<MediaStreamTrack | null>(null);
  const level = useRef<Level>(0);
  const [mine, setMine] = useState<{ cam: MediaStream | null; screen: MediaStream | null }>({ cam: null, screen: null });
  const local = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<string, Peer>());
  const queues = useRef(new Map<string, Promise<void>>());
  const alive = useRef(true);
  const members = channel.huddle?.members ?? [];
  const others = members.filter((id) => id !== me);
  const othersNow = useRef(others);
  othersNow.current = others;
  const tooMany = members.length > VIDEO_MAX;

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
    pc.ontrack = (e) => {
      if (e.track.kind !== 'video') return setStreams((st) => ({ ...st, [id]: e.streams[0] ?? new MediaStream([e.track]) }));
      const slot = slotOfMid(pc, e.transceiver.mid);
      if (slot) setVids((v) => ({ ...v, [id]: { ...v[id], [slot]: new MediaStream([e.track]) } }));
    };
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
      note(id, { kind: 'media', ...ourMedia() });
      void attach(p.pc, ourTracks(), level.current);
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
    if (!pc.getTransceivers().some((t) => t.receiver.track?.kind === 'audio')) pc.addTransceiver('audio', { direction: 'recvonly' }); // no microphone: listen only
    ensureSlots(pc); // the camera and the screen, from the first offer on
    await attach(pc, ourTracks(), level.current);
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
      openSlots(pc);
      await attach(pc, ourTracks(), level.current);
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
    setVids((v) => {
      const n = { ...v };
      delete n[id];
      return n;
    });
    setMedia((m) => {
      const n = { ...m };
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
      camTrack.current?.stop();
      screenTrack.current?.stop();
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
        setLocalStream(s);
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
      if (data.channelId !== channel.id) return;
      if (data.kind === 'react') return void (data.emoji && REACTIONS.includes(data.emoji) && float(from, data.emoji));
      if (data.kind === 'media') return setMedia((m) => ({ ...m, [from]: { cam: !!data.cam, screen: !!data.screen } }));
      enqueue(from, () => receive(from, data));
    };
    window.addEventListener('s2g:signal', on);
    return () => window.removeEventListener('s2g:signal', on);
  }, [channel.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Someone left the channel's huddle: close their line.
  useEffect(() => {
    for (const id of [...peers.current.keys()]) if (!others.includes(id)) drop(id);
  }, [others.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // The channel's header (phones) opens the call screen.
  useEffect(() => {
    const on = () => setFull(true);
    window.addEventListener('s2g:huddle-open', on);
    return () => window.removeEventListener('s2g:huddle-open', on);
  }, []);
  /** A reaction floats up from someone's picture for a moment. */
  const float = (id: string, emoji: string) => {
    const key = Date.now() + Math.random();
    setFloating((f) => [...f.slice(-5), { id, emoji, key }]);
    setTimeout(() => setFloating((f) => f.filter((x) => x.key !== key)), 1800);
  };
  const react = (emoji: string) => {
    for (const id of others) note(id, { kind: 'react', emoji });
    float(me, emoji);
    setReacting(false);
  };
  const speaking = useSpeaking(streams, localStream, me, muted);

  const leave = () => {
    for (const id of new Set([...others, ...peers.current.keys()])) note(id, { kind: 'bye' });
    peers.current.forEach((p) => (clearTimeout(p.timer), p.pc.close()));
    peers.current.clear();
    local.current?.getTracks().forEach((t) => t.stop());
    camTrack.current?.stop();
    screenTrack.current?.stop();
    onLeave();
  };
  const toggleMute = () => {
    const next = !muted;
    local.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  };
  /* ---------- Camera and screen ---------- */
  function ourTracks() {
    return { cam: camTrack.current, screen: screenTrack.current };
  }
  function ourMedia(): Media {
    return { cam: !!camTrack.current, screen: !!screenTrack.current };
  }
  /** Our camera and screen into every line, and the others told. */
  const publish = () => {
    for (const p of peers.current.values()) void attach(p.pc, ourTracks(), level.current);
    const m = ourMedia();
    for (const id of othersNow.current) note(id, { kind: 'media', ...m });
    setMine({ cam: camTrack.current ? new MediaStream([camTrack.current]) : null, screen: screenTrack.current ? new MediaStream([screenTrack.current]) : null });
  };
  const camOff = (why?: string) => {
    camTrack.current?.stop();
    camTrack.current = null;
    setCam('off');
    publish();
    if (why) setVideoNote(why);
  };
  const toggleCam = async () => {
    if (cam === 'on') return camOff();
    if (tooMany) return setVideoNote(t('Video is for up to {n} people. With more it’s voice only; screen share still works.', { n: fmtNumber(VIDEO_MAX) }));
    setCam('asking');
    setVideoNote(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 } } });
      if (!alive.current) return s.getTracks().forEach((x) => x.stop());
      const track = s.getVideoTracks()[0];
      track.onended = () => camTrack.current === track && camOff(t('Your camera stopped. Turn it on again when it’s back.'));
      camTrack.current = track;
      level.current = members.length > 3 ? 1 : 0;
      setCam('on');
      publish();
    } catch (e) {
      setCam('off');
      const name = (e as DOMException)?.name;
      setVideoNote(name === 'NotAllowedError' || name === 'SecurityError' ? t('Camera blocked. Allow it in your browser’s settings for this site, then try again.') : name === 'NotFoundError' || name === 'OverconstrainedError' ? t('No camera found on this device.') : name === 'NotSupportedError' ? t('This browser can’t use a camera here.') : t('Your camera didn’t start. Another app may be using it.'));
    }
  };
  const stopShare = () => {
    screenTrack.current?.stop();
    screenTrack.current = null;
    setSharing(false);
    publish();
  };
  const toggleShare = async () => {
    if (sharing) return stopShare();
    const other = others.find((id) => media[id]?.screen);
    if (other) return setVideoNote(t('{name} is sharing their screen. One screen at a time.', { name: first(other) }));
    setVideoNote(null);
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 15 } }, audio: false });
      if (!alive.current) return s.getTracks().forEach((x) => x.stop());
      const track = s.getVideoTracks()[0];
      if ('contentHint' in track) track.contentHint = 'detail';
      track.onended = () => screenTrack.current === track && stopShare(); // the browser's own "Stop sharing"
      screenTrack.current = track;
      setSharing(true);
      setExpanded(true);
      publish();
    } catch (e) {
      if ((e as DOMException)?.name !== 'NotAllowedError') setVideoNote(t('Screen share didn’t start. Try again, or pick another window.'));
    }
  };
  // More than VIDEO_MAX people: cameras go off (voice only), screen share stays.
  useEffect(() => {
    if (tooMany && camTrack.current) camOff(t('Video is for up to {n} people. With more it’s voice only; screen share still works.', { n: fmtNumber(VIDEO_MAX) }));
  }, [tooMany]); // eslint-disable-line react-hooks/exhaustive-deps
  // A weak network: the camera steps down twice, then goes off so the voice keeps going.
  useEffect(() => {
    if (cam !== 'on') return;
    let starved = 0;
    const timer = setInterval(async () => {
      const lines = [...peers.current.values()].filter((p) => isUp(p.pc));
      if (!lines.length) return;
      const any = (await Promise.all(lines.map((p) => cameraStarved(p.pc)))).some(Boolean);
      starved = any ? starved + 1 : 0;
      if (starved < 2) return;
      starved = 0;
      if (level.current < 2) {
        level.current = (level.current + 1) as Level;
        for (const p of peers.current.values()) void attach(p.pc, ourTracks(), level.current);
      } else camOff(t('Your connection is weak, so your camera is off. Your voice stays on.'));
    }, 3000);
    return () => clearInterval(timer);
  }, [cam]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const name = channel.kind === 'dm' ? chanName(channel, users, me) : `#${channel.name}`;
  const lineOf = (id: string): Line => lines[id] ?? 'connecting';
  const first = (id: string) => users.find((u) => u.id === id)?.name.split(' ')[0] ?? t('Someone');
  const names = (ids: string[]) => (ids.length <= 2 ? fmtList(ids.map(first)) : t('{name} and {n} others', { name: first(ids[0]), n: fmtNumber(ids.length - 1) }));
  const blocked = others.filter((id) => lineOf(id) === 'blocked');
  const silent = others.filter((id) => lineOf(id) === 'silent');
  const problem = blocked.length
    ? relay
      ? t('Couldn’t connect to {names}, even through the call relay. Try again, or switch to another network.', { names: names(blocked) })
      : t('This network blocks direct calls. Ask your admin to turn on the call relay.')
    : silent.length
      ? silent.length === 1
        ? t('{names} isn’t answering. They may have lost their connection.', { names: names(silent) })
        : t('{names} aren’t answering. They may have lost their connection.', { names: names(silent) })
      : null;
  const shown = useRef(problem); // keeps the words while the note folds away
  if (problem) shown.current = problem;
  const any = (l: Line) => others.some((id) => lineOf(id) === l);
  const status = (() => {
    if (mic === 'asking') return t('Asking for your microphone…');
    if (any('retrying')) return t('Reconnecting…');
    if (any('connecting') && !any('connected')) return t('Connecting…');
    if (mic === 'denied') return t('No microphone: listening only');
    return others.length ? tn(others.length + 1, '{n} in the huddle', '{n} in the huddle') : t('Waiting for others');
  })();

  const audio = Object.entries(streams).map(([id, st]) => (
    <audio
      key={id}
      autoPlay
      ref={(el) => {
        if (el && el.srcObject !== st) el.srcObject = st;
      }}
    />
  ));
  const avatar = (id: string, size: number) => {
    const u = users.find((x) => x.id === id);
    const l = id === me ? 'connected' : lineOf(id);
    return u ? (
      <span key={id} className={`huddle-av is-${l}${id === me && muted ? ' muted' : ''}${speaking.includes(id) ? ' speaking' : ''}`} title={LINE_LABEL[l] ? `${u.name}: ${t(LINE_LABEL[l]).toLowerCase()}` : u.name}>
        <Avatar person={u} size={size} />
        {id === me && muted && <MicOff size={size > 40 ? 14 : 10} />}
        {floating
          .filter((f) => f.id === id)
          .map((f) => (
            <i key={f.key} className="huddle-float" aria-hidden>
              {f.emoji}
            </i>
          ))}
      </span>
    ) : null;
  };
  const talking = speaking.filter((id) => id !== me);
  const line = talking.length ? (talking.length === 1 ? t('{names} is talking', { names: names(talking) }) : t('{names} are talking', { names: names(talking) })) : status;
  const problemNote = (
    <div className={`fold huddle-fold${problem ? ' open' : ''}`} role="status" aria-live="polite">
      <div className="fold-in">
        <div className="huddle-note">
          <AlertTriangle size={14} />
          <span>{shown.current}</span>
          <button type="button" className="ghost-btn sm" onClick={retry}>
            {t('Try again')}
          </button>
        </div>
      </div>
    </div>
  );
  // What went wrong with the camera or screen, and why (dismissable; it folds away like the line note).
  const videoShown = useRef(videoNote);
  if (videoNote) videoShown.current = videoNote;
  const videoNoteEl = (
    <div className={`fold huddle-fold${videoNote ? ' open' : ''}`} role="status" aria-live="polite">
      <div className="fold-in">
        <div className="huddle-note">
          <VideoOff size={14} />
          <span>{videoShown.current}</span>
          <button type="button" className="ghost-btn sm" onClick={() => setVideoNote(null)} tabIndex={videoNote ? 0 : -1}>
            {t('OK')}
          </button>
        </div>
      </div>
    </div>
  );
  const reactRow = (
    <div className={`fold hs-react-fold${reacting ? ' open' : ''}`} aria-hidden={!reacting}>
      <div>
        <div className="hs-react" role="group" aria-label={t('React')}>
          {REACTIONS.map((e) => (
            <button key={e} type="button" tabIndex={reacting ? 0 : -1} onClick={() => react(e)} aria-label={t('React {emoji}', { emoji: e })}>
              {e}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  /* The call's tiles: everyone's camera or picture; a shared screen takes the stage. */
  const sharer = sharing ? me : others.find((id) => media[id]?.screen && vids[id]?.screen);
  const screen = sharer ? { id: sharer, self: sharer === me, name: sharer === me ? t('Your screen') : t('{name}’s screen', { name: first(sharer) }), video: sharer === me ? mine.screen : (vids[sharer]?.screen ?? null) } : null;
  const tiles: TileInfo[] = members.map((id) => {
    const self = id === me;
    const camOn = self ? cam === 'on' : !!media[id]?.cam;
    return { id, self, name: self ? t('You') : first(id), person: users.find((u) => u.id === id), video: camOn ? (self ? mine.cam : (vids[id]?.cam ?? null)) : null, muted: self && muted, speaking: speaking.includes(id), dim: !self && lineOf(id) !== 'connected' };
  });
  const anyVideo = !!screen || tiles.some((x) => x.video);
  const stage = <HuddleStage tiles={tiles} screen={screen} floating={floating} phone={phone} />;
  // The small picture for the minimised call: the shared screen, else someone else's camera, else ours.
  const peek = screen?.video ?? tiles.find((x) => !x.self && x.video)?.video ?? (cam === 'on' ? mine.cam : null);
  const peekSelf = !screen && !tiles.some((x) => !x.self && x.video);
  const shareOk = canShareScreen();
  const camLabel = cam === 'on' ? t('Stop video') : t('Video');
  const camHint = tooMany ? t('Video is for up to {n} people', { n: fmtNumber(VIDEO_MAX) }) : camLabel;
  const shareBusy = !sharing && others.some((id) => media[id]?.screen);

  /** The round controls under the call (phones, and the full view on wider screens). */
  const controls = (extra?: React.ReactNode) => (
    <div className="hs-controls">
      <button type="button" className={`hs-ctl${muted ? ' on' : ''}`} onClick={toggleMute} disabled={mic !== 'on'} aria-pressed={muted}>
        <span>{muted ? <MicOff size={22} /> : <Mic size={22} />}</span>
        {muted ? t('Unmute') : t('Mute')}
      </button>
      <button type="button" className={`hs-ctl${cam === 'on' ? ' on' : ''}`} onClick={() => void toggleCam()} disabled={cam === 'asking'} aria-pressed={cam === 'on'} title={camHint}>
        <span>{cam === 'on' ? <Video size={22} /> : <VideoOff size={22} />}</span>
        {camLabel}
      </button>
      {shareOk && (
        <button type="button" className={`hs-ctl${sharing ? ' on' : ''}`} onClick={() => void toggleShare()} aria-pressed={sharing} title={shareBusy ? t('Someone else is sharing') : undefined}>
          <span>{sharing ? <ScreenShareOff size={22} /> : <ScreenShare size={22} />}</span>
          {sharing ? t('Stop sharing') : t('Share')}
        </button>
      )}
      <button type="button" className={`hs-ctl${reacting ? ' on' : ''}`} onClick={() => setReacting((r) => !r)} aria-expanded={reacting}>
        <span>
          <SmilePlus size={22} />
        </span>
        {t('React')}
      </button>
      {extra}
    </div>
  );

  // Wider screens: Escape takes the full view back to the small card.
  useEffect(() => {
    if (!expanded || phone) return;
    const on = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [expanded, phone]);

  /* Phones: a slim bar in its own row (under the channel's header, or under the top bar elsewhere), never over the
     message box. Tapping it opens the call screen. */
  if (phone)
    return (
      <>
        {audio}
        {dock &&
          createPortal(
            <div className="huddle-bar" role="region" aria-label={t('Huddle in {name}', { name })}>
              <button type="button" className="hb-main" onClick={() => setFull(true)} aria-label={t('Huddle in {name}: {status}. Open the call', { name, status: line })}>
                {peek ? <VideoEl stream={peek} mirror={peekSelf} className="hb-video" /> : <Headphones size={16} className="hb-icon" />}
                <span className="hb-text">
                  <strong>{name}</strong>
                  <small>{screen ? screen.name : line}</small>
                </span>
                <span className="hb-avs">{members.slice(0, 3).map((id) => avatar(id, 24))}</span>
              </button>
              <button type="button" className={`icon-btn hb-mic${muted ? ' on' : ''}`} onClick={toggleMute} disabled={mic !== 'on'} aria-label={muted ? t('Unmute') : t('Mute')} aria-pressed={muted}>
                {muted ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
              <button type="button" className="icon-btn hb-leave" onClick={leave} aria-label={t('Leave the huddle')}>
                <PhoneOff size={18} />
              </button>
            </div>,
            dock,
          )}
        {full && (
          // The call itself: a full screen (Slack). Back makes it the slim bar again; Leave is the red pill.
          <PushScreen
            className="huddle-push"
            backLabel={t('Back')}
            onBack={() => setFull(false)}
            title={
              <span className="push-title-2">
                {name}
                <small>{line}</small>
              </span>
            }
            actions={
              <button type="button" className="hp-leave" onClick={() => (setFull(false), leave())}>
                {t('Leave')}
              </button>
            }
            footer={controls(
              onOpenChannel && (
                <button type="button" className="hs-ctl" onClick={() => (setFull(false), onOpenChannel())}>
                  <span>
                    <MessageSquare size={22} />
                  </span>
                  {t('Chat')}
                </button>
              ),
            )}
          >
            {problemNote}
            {videoNoteEl}
            {anyVideo ? (
              stage
            ) : (
              <div className="hs-people">
                {members.map((id) => (
                  <div key={id} className="hs-person">
                    {avatar(id, 72)}
                    <span>{id === me ? t('You') : first(id)}</span>
                  </div>
                ))}
              </div>
            )}
            {reactRow}
          </PushScreen>
        )}
      </>
    );

  return (
    <>
      <aside className={`huddle${peek ? ' has-video' : ''}`} role="region" aria-label={t('Huddle in {name}', { name })}>
        <header>
          <Headphones size={15} />
          {onOpenChannel ? (
            <button type="button" className="huddle-name" onClick={onOpenChannel} title={t('Open {name}', { name })}>
              {name}
            </button>
          ) : (
            <strong>{name}</strong>
          )}
          <button type="button" className="icon-btn sm huddle-expand" onClick={() => setExpanded(true)} aria-label={t('Open the full view')} title={t('Open the full view')}>
            <Maximize2 size={14} />
          </button>
          <small className="muted">{screen ? screen.name : line}</small>
          {problemNote}
          {videoNoteEl}
        </header>
        <div className={`fold huddle-peek-fold${peek && !expanded ? ' open' : ''}`}>
          <div className="fold-in">
            {peek && (
              <button type="button" className="huddle-peek" onClick={() => setExpanded(true)} aria-label={t('Open the full view')}>
                <VideoEl stream={peek} mirror={peekSelf} className="hp-video" />
              </button>
            )}
          </div>
        </div>
        <div className="huddle-people">{members.map((id) => avatar(id, 32))}</div>
        {audio}
        <div className="huddle-actions">
          <button type="button" className={`ghost-btn sm huddle-react${reacting ? ' on' : ''}`} onClick={() => setReacting((r) => !r)} aria-expanded={reacting} aria-label={t('React')} title={t('React')}>
            <SmilePlus size={14} />
          </button>
          <button type="button" className={`ghost-btn sm${cam === 'on' ? ' on' : ''}`} onClick={() => void toggleCam()} disabled={cam === 'asking'} aria-pressed={cam === 'on'} aria-label={camLabel} title={camHint}>
            {cam === 'on' ? <Video size={14} /> : <VideoOff size={14} />}
          </button>
          {shareOk && (
            <button type="button" className={`ghost-btn sm${sharing ? ' on' : ''}`} onClick={() => void toggleShare()} aria-pressed={sharing} aria-label={sharing ? t('Stop sharing') : t('Share your screen')} title={sharing ? t('Stop sharing') : shareBusy ? t('Someone else is sharing') : t('Share your screen')}>
              {sharing ? <ScreenShareOff size={14} /> : <ScreenShare size={14} />}
            </button>
          )}
          <button type="button" className={`ghost-btn sm${muted ? ' on' : ''}`} onClick={toggleMute} disabled={mic !== 'on'} aria-pressed={muted} aria-label={muted ? t('Unmute') : t('Mute')} title={muted ? t('Unmute') : t('Mute')}>
            {muted ? <MicOff size={14} /> : <Mic size={14} />}
          </button>
          <button type="button" className="primary-btn sm danger" onClick={leave}>
            <PhoneOff size={14} /> {t('Leave')}
          </button>
        </div>
        {!expanded && reactRow}
      </aside>
      {expanded &&
        createPortal(
          // The full view: the tiles, the shared screen, the controls. Minimise (or Escape) goes back to the card.
          <div className="huddle-full" role="dialog" aria-modal="false" aria-label={t('Huddle in {name}', { name })}>
            <header className="hf-head">
              <Headphones size={18} />
              <span className="hf-title">
                <strong>{name}</strong>
                <small>{line}</small>
              </span>
              <button type="button" className="icon-btn" onClick={() => setExpanded(false)} aria-label={t('Make it small')} title={t('Make it small')}>
                <Minimize2 size={18} />
              </button>
              <button type="button" className="hp-leave" onClick={() => (setExpanded(false), leave())}>
                {t('Leave')}
              </button>
            </header>
            <div className="hf-body">
              {problemNote}
              {videoNoteEl}
              {stage}
              {reactRow}
            </div>
            <footer className="hf-foot">{controls()}</footer>
          </div>,
          document.body,
        )}
    </>
  );
}
