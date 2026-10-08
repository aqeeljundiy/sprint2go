import { useEffect, useRef, useState } from 'react';
import { Headphones, Mic, MicOff, PhoneOff } from 'lucide-react';
import type { Channel, User } from '../types';
import { Avatar } from './Avatar';
import { sendSignal } from '../sync';

type Note = { channelId: string; kind: 'offer' | 'answer' | 'ice' | 'bye'; sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit };
const ICE: RTCConfiguration = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

/**
 * A huddle: a quick voice call in a channel, docked bottom-left while you keep working. Audio goes browser to
 * browser (WebRTC, one connection per other person); the server only relays the setup notes.
 */
export function Huddle({ channel, users, me, onLeave }: { channel: Channel; users: User[]; me: string; onLeave: () => void }) {
  const [muted, setMuted] = useState(false);
  const [mic, setMic] = useState<'asking' | 'on' | 'denied'>('asking');
  const [streams, setStreams] = useState<Record<string, MediaStream>>({});
  const local = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<string, RTCPeerConnection>());
  const members = channel.huddle?.members ?? [];
  const others = members.filter((id) => id !== me);

  const peerFor = (id: string) => {
    let pc = peers.current.get(id);
    if (pc) return pc;
    pc = new RTCPeerConnection(ICE);
    peers.current.set(id, pc);
    local.current?.getTracks().forEach((t) => pc!.addTrack(t, local.current!));
    pc.onicecandidate = (e) => e.candidate && sendSignal(id, { channelId: channel.id, kind: 'ice', ice: e.candidate.toJSON() } satisfies Note);
    pc.ontrack = (e) => setStreams((s) => ({ ...s, [id]: e.streams[0] }));
    pc.onconnectionstatechange = () => pc!.connectionState === 'failed' && drop(id);
    return pc;
  };
  const drop = (id: string) => {
    peers.current.get(id)?.close();
    peers.current.delete(id);
    setStreams((s) => {
      const n = { ...s };
      delete n[id];
      return n;
    });
  };
  const call = async (id: string) => {
    const pc = peerFor(id);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal(id, { channelId: channel.id, kind: 'offer', sdp: offer } satisfies Note);
  };

  // Microphone, then a call to everyone already in.
  useEffect(() => {
    let gone = false;
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((s) => {
        if (gone) return s.getTracks().forEach((t) => t.stop());
        local.current = s;
        setMic('on');
        others.forEach((id) => void call(id));
      })
      .catch(() => setMic('denied'));
    return () => {
      gone = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Notes from the others: answer their offers, take their answers and candidates, drop whoever says bye.
  useEffect(() => {
    const on = async (e: Event) => {
      const { from, data } = (e as CustomEvent<{ from: string; data: Note }>).detail;
      if (data.channelId !== channel.id) return;
      if (data.kind === 'bye') return drop(from);
      const pc = peerFor(from);
      if (data.kind === 'offer' && data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal(from, { channelId: channel.id, kind: 'answer', sdp: answer } satisfies Note);
      } else if (data.kind === 'answer' && data.sdp) await pc.setRemoteDescription(data.sdp);
      else if (data.kind === 'ice' && data.ice) await pc.addIceCandidate(data.ice).catch(() => {});
    };
    window.addEventListener('s2g:signal', on);
    return () => window.removeEventListener('s2g:signal', on);
  }, [channel.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Someone left the channel's huddle: close their line.
  useEffect(() => {
    for (const id of [...peers.current.keys()]) if (!others.includes(id)) drop(id);
  }, [others.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const leave = () => {
    others.forEach((id) => sendSignal(id, { channelId: channel.id, kind: 'bye' } satisfies Note));
    peers.current.forEach((pc) => pc.close());
    peers.current.clear();
    local.current?.getTracks().forEach((t) => t.stop());
    onLeave();
  };
  useEffect(() => () => local.current?.getTracks().forEach((t) => t.stop()), []);
  const toggleMute = () => {
    const next = !muted;
    local.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  };
  const name = channel.kind === 'dm' ? 'Direct message' : `#${channel.name}`;

  return (
    <aside className="huddle" role="region" aria-label={`Huddle in ${name}`}>
      <header>
        <Headphones size={15} />
        <strong>{name}</strong>
        <small className="muted">{mic === 'denied' ? 'No microphone: listening only' : mic === 'asking' ? 'Asking for your microphone…' : others.length ? `${others.length + 1} in the huddle` : 'Waiting for others'}</small>
      </header>
      <div className="huddle-people">
        {members.map((id) => {
          const u = users.find((x) => x.id === id);
          return u ? (
            <span key={id} className={`huddle-av${id === me && muted ? ' muted' : ''}`} title={u.name}>
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
