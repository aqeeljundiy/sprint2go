// Camera and screen share in a huddle (src/components/Huddle.tsx). Every line between two people carries two video
// slots from the first offer on: the camera and the screen. Turning either on or off only swaps the track in its slot
// (no new negotiation), and a note tells the others what's on, so a slot without frames shows the person's picture.

/** Video goes person to person (a mesh): past this many people a huddle is voice only, with screen share. */
export const VIDEO_MAX = 6;

export type Slot = 'cam' | 'screen';
const SLOTS: Slot[] = ['cam', 'screen'];

const videoMids = (sdp: string | undefined) => {
  if (!sdp) return [];
  const out: string[] = [];
  let video = false;
  for (const line of sdp.split(/\r?\n/)) {
    if (line.startsWith('m=')) video = line.startsWith('m=video');
    else if (video && line.startsWith('a=mid:')) out.push(line.slice(6).trim());
  }
  return out;
};

/**
 * The line's camera and screen slots: the first two video sections of the negotiated description, in order (the
 * caller's offer made them in that order). Before anything is negotiated, the first two video transceivers.
 */
export function slotsOf(pc: RTCPeerConnection): Partial<Record<Slot, RTCRtpTransceiver>> {
  const all = pc.getTransceivers().filter((t) => !(t as { stopped?: boolean }).stopped && (t.receiver.track?.kind === 'video' || t.sender.track?.kind === 'video'));
  const mids = videoMids(pc.remoteDescription?.sdp ?? pc.localDescription?.sdp);
  const picked = mids.length ? mids.map((mid) => all.find((t) => t.mid === mid)).filter((t): t is RTCRtpTransceiver => !!t) : all.filter((t) => !t.mid);
  return Object.fromEntries(SLOTS.map((s, i) => [s, picked[i]]).filter(([, t]) => t));
}
export const slotOfMid = (pc: RTCPeerConnection, mid: string | null): Slot | null => {
  const s = slotsOf(pc);
  return s.cam?.mid === mid ? 'cam' : s.screen?.mid === mid ? 'screen' : null;
};

/** The caller's side, before an offer: both slots exist, able to send and receive. */
export function ensureSlots(pc: RTCPeerConnection) {
  const have = pc.getTransceivers().filter((t) => t.receiver.track?.kind === 'video').length;
  for (let i = have; i < 2; i++) pc.addTransceiver('video', { direction: 'sendrecv' });
}
/** The answering side, after their offer: our slots send too, so a camera can go on later without asking again. */
export function openSlots(pc: RTCPeerConnection) {
  for (const t of Object.values(slotsOf(pc))) if (t && t.direction !== 'sendrecv') t.direction = 'sendrecv';
}

/** How hard the camera may push: lower with more people, and lower again when the network says it can't keep up. */
export type Level = 0 | 1 | 2;
const BITRATE: Record<Level, number> = { 0: 700_000, 1: 350_000, 2: 150_000 };
const SCALE: Record<Level, number> = { 0: 1, 1: 1.5, 2: 2.5 };

/** Puts our camera and screen into a line's slots (null: off), at the quality the call can carry. */
export async function attach(pc: RTCPeerConnection, tracks: { cam: MediaStreamTrack | null; screen: MediaStreamTrack | null }, level: Level) {
  const slots = slotsOf(pc);
  for (const s of SLOTS) {
    const t = slots[s];
    if (!t) continue;
    const track = tracks[s];
    if (t.sender.track !== track) await t.sender.replaceTrack(track).catch(() => {});
    if (!track) continue;
    try {
      const p = t.sender.getParameters();
      if (!p.encodings?.length) continue; // not negotiated yet: set on the next pass
      const enc = p.encodings[0];
      // Screens stay sharp (text) and slow; cameras give way to the voice.
      enc.maxBitrate = s === 'screen' ? 1_200_000 : BITRATE[level];
      enc.scaleResolutionDownBy = s === 'screen' ? 1 : SCALE[level];
      if (s === 'screen') enc.maxFramerate = 15;
      await t.sender.setParameters(p);
    } catch {
      /* this browser keeps its own rate */
    }
  }
}

/** Whether our camera is being held back by the network on this line (the browser's own verdict). */
export async function cameraStarved(pc: RTCPeerConnection): Promise<boolean> {
  const sender = slotsOf(pc).cam?.sender;
  if (!sender?.track) return false;
  try {
    const stats = await sender.getStats();
    let starved = false;
    stats.forEach((r) => {
      if (r.type === 'outbound-rtp' && (r as { qualityLimitationReason?: string }).qualityLimitationReason === 'bandwidth') starved = true;
    });
    return starved;
  } catch {
    return false;
  }
}

/** Screen share works in this browser (desktop browsers; phones don't have it, they get the camera only). */
export const canShareScreen = () => typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
