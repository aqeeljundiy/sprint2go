import { useEffect, useState } from 'react';
import { MicOff, ScreenShare } from 'lucide-react';
import type { User } from '../../types';
import { Avatar } from '../Avatar';
import { t } from '../../i18n';

/** One person in the call: their camera when it's on and coming through, otherwise their picture. */
export type TileInfo = {
  id: string;
  name: string;
  person?: User;
  video: MediaStream | null; // their camera (ours: the local preview)
  self: boolean;
  muted: boolean;
  speaking: boolean;
  dim: boolean; // their line isn't up (connecting, reconnecting, can't connect)
};
export type ScreenInfo = { id: string; name: string; video: MediaStream | null; self: boolean };

/** Whether a video track is sending frames right now: a remote one is "muted" until frames arrive, and when they stop. */
function useLive(stream: MediaStream | null) {
  const track = stream?.getVideoTracks()[0] ?? null;
  const [live, setLive] = useState(() => !!track && !track.muted);
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!track) return setLive(false);
    const on = () => (setLive(true), setStalled(false));
    const off = () => setLive(false);
    setLive(!track.muted);
    track.addEventListener('unmute', on);
    track.addEventListener('mute', off);
    track.addEventListener('ended', off);
    return () => {
      track.removeEventListener('unmute', on);
      track.removeEventListener('mute', off);
      track.removeEventListener('ended', off);
    };
  }, [track]);
  // No frames for a few seconds while the camera is on: the network can't carry it; say so on the tile.
  useEffect(() => {
    if (live || !track) return setStalled(false);
    const timer = setTimeout(() => setStalled(true), 4000);
    return () => clearTimeout(timer);
  }, [live, track]);
  return { live, stalled };
}

/** A <video> for a stream (always silent: voices play through the call's own audio). */
export function VideoEl({ stream, mirror = false, className = '' }: { stream: MediaStream; mirror?: boolean; className?: string }) {
  return (
    <video
      className={`${className}${mirror ? ' mirror' : ''}`}
      autoPlay
      playsInline
      muted
      ref={(el) => {
        if (el && el.srcObject !== stream) el.srcObject = stream;
      }}
    />
  );
}

function Tile({ x, float }: { x: TileInfo; float: { emoji: string; key: number }[] }) {
  const { live, stalled } = useLive(x.self ? null : x.video);
  const showVideo = !!x.video && (x.self || live);
  return (
    <div className={`ht-tile${showVideo ? ' has-video' : ''}${x.speaking ? ' speaking' : ''}${x.dim ? ' dim' : ''}`}>
      {showVideo ? (
        <VideoEl stream={x.video!} mirror={x.self} className="ht-video" />
      ) : (
        <span className="ht-face">{x.person ? <Avatar person={x.person} size={56} /> : null}</span>
      )}
      <span className="ht-name">
        {x.muted && <MicOff size={14} aria-label={t('Muted')} />}
        <span>{x.name}</span>
        {!x.self && x.video && !live && stalled && <small>{t('Video paused: weak connection')}</small>}
      </span>
      {float.map((f) => (
        <i key={f.key} className="huddle-float" aria-hidden>
          {f.emoji}
        </i>
      ))}
    </div>
  );
}

/**
 * The call's people as tiles (Slack): a grid of cameras and pictures; while someone shares their screen, the screen
 * takes the stage and the people sit in a row under it.
 */
export function HuddleStage({ tiles, screen, floating, phone }: { tiles: TileInfo[]; screen: ScreenInfo | null; floating: { id: string; emoji: string; key: number }[]; phone: boolean }) {
  const n = tiles.length;
  const cols = screen ? n : phone ? (n <= 2 ? 1 : 2) : n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const { live } = useLive(screen && !screen.self ? screen.video : null);
  return (
    <div className={`huddle-stage${screen ? ' with-screen' : ''}`}>
      {screen && (
        <div className="hs-screen">
          {screen.video && (screen.self || live) ? <VideoEl stream={screen.video} className="ht-video screen" /> : <span className="hs-screen-wait">{t('Waiting for the screen…')}</span>}
          <span className="ht-name">
            <ScreenShare size={14} aria-hidden />
            <span>{screen.name}</span>
          </span>
        </div>
      )}
      <div className="ht-grid" style={{ ['--cols' as string]: cols }}>
        {tiles.map((x) => (
          <Tile key={x.id} x={x} float={floating.filter((f) => f.id === x.id)} />
        ))}
      </div>
    </div>
  );
}
