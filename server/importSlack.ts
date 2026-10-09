// A Slack workspace export (the .zip from Slack's Import/Export Data) into channels and messages.
// The zip has users.json and channels.json (groups.json, dms.json and mpims.json only when Slack included private
// channels and direct messages), and a folder per conversation with a JSON file per day. Here:
//  - public channels become channels; private channels private ones; direct messages stay direct messages between the
//    people in them who are here; group messages become private channels named after their people
//  - a channel with the same name as one here (#general) adds its history to that one
//  - messages keep who wrote them, when, their threads and their reactions; Slack's markup becomes plain text
//  - files are fetched from the links in the export when those still work, otherwise the message keeps the file's
//    name and the summary lists it as not in the export
import * as db from './db.ts';
import { readEntryText, readZip, type ZipEntry } from './zip.ts';
import { ImportError, download, dropFile, fileId, limits, matchPerson, mbText, newId, suggest, typeOf, type AnalyzeCtx, type RunCtx } from './importKit.ts';
import type { ImportChannel, ImportPreview } from '../src/importTypes.ts';
import type { ChatFile } from '../src/types.ts';

const NOT_SLACK = 'This isn’t a Slack export. In Slack, open Tools & settings, Workspace settings, Import/Export Data, then Export, and upload the zip Slack sends you.';
/** Slack's housekeeping lines (joins, leaves, topic changes): not brought in. */
const NOISE = new Set([
  'channel_join', 'channel_leave', 'channel_topic', 'channel_purpose', 'channel_name', 'channel_archive', 'channel_unarchive', 'channel_convert_to_private', 'channel_convert_to_public',
  'group_join', 'group_leave', 'group_topic', 'group_purpose', 'group_name', 'group_archive', 'group_unarchive',
  'bot_add', 'bot_remove', 'pinned_item', 'unpinned_item', 'reminder_add', 'joiner_notification', 'tombstone', 'sh_room_created', 'huddle_thread', 'channel_canvas_updated',
]);

type SUser = { id: string; name?: string; real_name?: string; deleted?: boolean; is_bot?: boolean; is_app_user?: boolean; profile?: { email?: string; real_name?: string; display_name?: string } };
type SFile = { id?: string; name?: string; title?: string; mimetype?: string; size?: number; url_private?: string; url_private_download?: string; mode?: string };
type SMsg = { type?: string; subtype?: string; user?: string; bot_id?: string; username?: string; text?: string; ts?: string; thread_ts?: string; reactions?: { name: string; users?: string[] }[]; files?: SFile[]; user_profile?: { real_name?: string; display_name?: string; name?: string }; bot_profile?: { name?: string }; edited?: unknown; hidden?: boolean; attachments?: { fallback?: string; text?: string }[] };
interface Conv {
  key: string;
  kind: ImportChannel['kind'];
  name: string;
  folder: string;
  members: string[];
  archived: boolean;
  created?: number;
  creator?: string;
  about?: string;
}

const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
const str = (x: unknown) => (typeof x === 'string' ? x : '');
const base = (n: string) => n.split('/').pop() ?? n;
const dirOf = (n: string) => n.split('/').slice(0, -1).join('/');
const tsMs = (ts: unknown) => Math.round(Number(ts) * 1000) || 0;
const keep = (m: SMsg) => !!m && typeof m === 'object' && !!m.ts && !m.hidden && !NOISE.has(m.subtype ?? '') && (m.type ?? 'message') === 'message';
const fileUrl = (f: SFile) => (f.mode === 'hidden_by_limit' || f.mode === 'tombstone' ? '' : str(f.url_private_download) || str(f.url_private));
/** "general" stays; "Design Team" becomes "design-team". */
export const slugName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'channel';

/** Where the export's files are: the folder holding users.json and channels.json, and each conversation's days. */
async function layoutOf(file: string) {
  const entries = await readZip(file, { maxFiles: limits().files, maxTotal: limits().unzipped });
  const metaNames = ['users.json', 'channels.json', 'groups.json', 'dms.json', 'mpims.json'];
  const metas = entries.filter((e) => !e.dir && metaNames.includes(base(e.name)));
  if (!metas.some((e) => base(e.name) === 'channels.json' || base(e.name) === 'users.json')) throw new ImportError(NOT_SLACK);
  const root = metas.map((e) => dirOf(e.name)).sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length)[0];
  const at = (n: string) => entries.find((e) => !e.dir && e.name === (root ? `${root}/${n}` : n));
  const days = new Map<string, ZipEntry[]>();
  for (const e of entries) {
    if (e.dir) continue;
    const rel = root ? (e.name.startsWith(`${root}/`) ? e.name.slice(root.length + 1) : '') : e.name;
    const parts = rel.split('/');
    if (parts.length !== 2 || !/^\d{4}-\d{2}-\d{2}\.json$/.test(parts[1])) continue;
    const list = days.get(parts[0]) ?? [];
    list.push(e);
    days.set(parts[0], list);
  }
  for (const l of days.values()) l.sort((a, b) => a.name.localeCompare(b.name));
  return { at, days };
}

async function readJson(file: string, e: ZipEntry | undefined): Promise<unknown> {
  if (!e) return undefined;
  const text = await readEntryText(file, e, limits().json);
  try {
    return JSON.parse(text);
  } catch {
    throw new ImportError(`${base(e.name)} in this export is damaged, so it can’t be read. Download the export from Slack again.`);
  }
}

async function conversations(file: string, at: (n: string) => ZipEntry | undefined): Promise<Conv[]> {
  const out: Conv[] = [];
  const about = (c: any) => str(c?.purpose?.value) || str(c?.topic?.value);
  for (const c of arr<any>(await readJson(file, at('channels.json'))))
    if (str(c?.id) && str(c?.name)) out.push({ key: c.id, kind: c.is_private ? 'private' : 'public', name: c.name, folder: c.name, members: arr<string>(c.members).filter((x) => typeof x === 'string'), archived: !!c.is_archived, created: Number(c.created) || undefined, creator: str(c.creator), about: about(c) });
  for (const c of arr<any>(await readJson(file, at('groups.json'))))
    if (str(c?.id) && str(c?.name)) out.push({ key: c.id, kind: 'private', name: c.name, folder: c.name, members: arr<string>(c.members).filter((x) => typeof x === 'string'), archived: !!c.is_archived, created: Number(c.created) || undefined, creator: str(c.creator), about: about(c) });
  for (const c of arr<any>(await readJson(file, at('dms.json')))) if (str(c?.id)) out.push({ key: c.id, kind: 'dm', name: '', folder: c.id, members: arr<string>(c.members).filter((x) => typeof x === 'string'), archived: false, created: Number(c.created) || undefined });
  for (const c of arr<any>(await readJson(file, at('mpims.json')))) if (str(c?.id) && str(c?.name)) out.push({ key: c.id, kind: 'group', name: c.name, folder: c.name, members: arr<string>(c.members).filter((x) => typeof x === 'string'), archived: !!c.is_archived, created: Number(c.created) || undefined });
  return out;
}

const userName = (u: SUser | undefined, fallback = '') => str(u?.real_name) || str(u?.profile?.real_name) || str(u?.profile?.display_name) || str(u?.name) || fallback;
const convLabel = (c: Conv, nameOf: (id: string) => string) => (c.kind === 'dm' || c.kind === 'group' ? c.members.map(nameOf).join(', ') || 'Direct messages' : `#${c.name}`);

/** The preview: conversations and their messages, the files they link, and the people in them. */
export async function analyze(ctx: AnalyzeCtx): Promise<ImportPreview> {
  const { at, days } = await layoutOf(ctx.file);
  const users = arr<SUser>(await readJson(ctx.file, at('users.json'))).filter((u) => u && typeof u.id === 'string');
  const byId = new Map(users.map((u) => [u.id, u]));
  const convs = await conversations(ctx.file, at);
  if (!convs.length) throw new ImportError('This Slack export has no channels in it. Export again with the channels you want.');
  const seenNames = new Map<string, string>();
  const nameOf = (id: string) => userName(byId.get(id), seenNames.get(id) ?? id);
  const appear = new Set<string>();
  const askOver = ctx.room.askOverMb * 1024 * 1024;
  const files = { linked: 0, bytes: 0, notInExport: 0, big: 0, bigBytes: 0 };
  const period = ctx.ws.chat?.history === '1y' ? 365 : ctx.ws.chat?.history === '90d' ? 90 : 0;
  const cutoff = period ? Date.now() - period * 86_400_000 : 0;
  let old = 0;
  const here = new Map((db.allDocs('channels') as any[]).filter((c) => c.workspaceId === ctx.ws.id && c.kind === 'channel' && !c.archived).map((c) => [String(c.name), String(c.id)]));
  const channels: ImportChannel[] = [];
  for (const [i, c] of convs.entries()) {
    ctx.progress(`Reading ${convLabel(c, nameOf)}`, i, convs.length);
    let n = 0;
    for (const e of days.get(c.folder) ?? []) {
      for (const m of arr<SMsg>(await readJson(ctx.file, e))) {
        if (!keep(m)) continue;
        n++;
        if (m.user) {
          appear.add(m.user);
          const named = str(m.user_profile?.real_name) || str(m.user_profile?.display_name);
          if (named && !seenNames.has(m.user)) seenNames.set(m.user, named);
        }
        for (const r of arr<{ users?: string[] }>(m.reactions)) for (const u of arr<string>(r.users)) appear.add(u);
        for (const f of arr<SFile>(m.files)) {
          const size = Number(f.size) || 0;
          if (!fileUrl(f)) files.notInExport++;
          else {
            files.linked++;
            files.bytes += size;
            if (askOver > 0 && size > askOver) (files.big++, (files.bigBytes += size));
          }
        }
        if (cutoff && tsMs(m.ts) < cutoff) old++;
      }
      await new Promise((r) => setImmediate(r));
    }
    for (const u of c.members) appear.add(u);
    const into = c.kind === 'public' || c.kind === 'private' ? here.get(slugName(c.name)) : undefined;
    channels.push({ key: c.key, name: c.kind === 'dm' || c.kind === 'group' ? convLabel(c, nameOf) : slugName(c.name), kind: c.kind, messages: n, ...(c.archived ? { archived: true } : {}), ...(into ? { into } : {}) });
  }
  appear.delete('USLACKBOT');
  const people = [...appear]
    .map((id) => {
      const u = byId.get(id);
      const email = str(u?.profile?.email).toLowerCase() || undefined;
      const gone = !!(u?.deleted || u?.is_bot || u?.is_app_user);
      const name = nameOf(id);
      // By email; by name only for someone the export has no email for.
      const m = matchPerson(ctx.members, { email, names: email ? [] : [name, str(u?.profile?.display_name), str(u?.name)] });
      return { key: id, name, ...(email ? { email } : {}), ...(m ? { match: m.id, how: m.how } : {}), canInvite: !!email && !gone, ...(gone ? { gone: true } : {}) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  ctx.progress('Reading', convs.length, convs.length);
  return {
    source: 'slack',
    title: 'Slack',
    people: suggest(people, ctx.seats),
    channels,
    files,
    ...(old && period ? { oldMessages: { n: old, period: period === 365 ? '1 year' : '90 days' } } : {}),
    room: ctx.room,
    seatsLeft: ctx.seats,
  };
}

/* ---------- Slack's markup and reactions ---------- */

const EMOJI: Record<string, string> = {
  '+1': '👍', thumbsup: '👍', '-1': '👎', thumbsdown: '👎', heart: '❤️', heart_eyes: '😍', joy: '😂', laughing: '😆', smile: '😄', smiley: '😃', grinning: '😀', slightly_smiling_face: '🙂', wink: '😉', blush: '😊', sweat_smile: '😅', rolling_on_the_floor_laughing: '🤣', rofl: '🤣',
  tada: '🎉', fire: '🔥', eyes: '👀', pray: '🙏', clap: '👏', raised_hands: '🙌', muscle: '💪', ok_hand: '👌', wave: '👋', point_up: '☝️', point_right: '👉', v: '✌️', handshake: '🤝', saluting_face: '🫡',
  white_check_mark: '✅', heavy_check_mark: '✔️', ballot_box_with_check: '☑️', x: '❌', warning: '⚠️', exclamation: '❗', question: '❓', bangbang: '‼️', '100': '💯', star: '⭐', star2: '🌟', sparkles: '✨', zap: '⚡', boom: '💥',
  rocket: '🚀', thinking_face: '🤔', thinking: '🤔', sob: '😭', cry: '😢', disappointed: '😞', confused: '😕', scream: '😱', open_mouth: '😮', astonished: '😲', sunglasses: '😎', upside_down_face: '🙃', face_palm: '🤦', facepalm: '🤦', shrug: '🤷', partying_face: '🥳', hugging_face: '🤗', hugs: '🤗', grimacing: '😬', relieved: '😌', sleeping: '😴', nerd_face: '🤓', skull: '💀', see_no_evil: '🙈',
  coffee: '☕', beers: '🍻', beer: '🍺', cake: '🍰', pizza: '🍕', trophy: '🏆', medal: '🏅', moneybag: '💰', gift: '🎁', bulb: '💡', memo: '📝', pushpin: '📌', calendar: '📅', link: '🔗', lock: '🔒', mag: '🔍', bell: '🔔', loudspeaker: '📢', mega: '📣', chart_with_upwards_trend: '📈', hourglass: '⌛', stopwatch: '⏱️', alarm_clock: '⏰',
  heavy_plus_sign: '➕', heavy_minus_sign: '➖', arrow_up: '⬆️', arrow_down: '⬇️', arrow_right: '➡️', arrow_left: '⬅️', repeat: '🔁', red_circle: '🔴', large_green_circle: '🟢', large_blue_circle: '🔵', large_yellow_circle: '🟡', white_circle: '⚪', black_circle: '⚫', green_heart: '💚', blue_heart: '💙', purple_heart: '💜', yellow_heart: '💛', orange_heart: '🧡', broken_heart: '💔', sparkling_heart: '💖',
  sunny: '☀️', rainbow: '🌈', seedling: '🌱', cactus: '🌵', dog: '🐶', cat: '🐱', unicorn_face: '🦄', unicorn: '🦄', bug: '🐛', robot_face: '🤖', ghost: '👻', alien: '👽', poop: '💩', hankey: '💩', eyes_closed: '😌', money_mouth_face: '🤑', star_struck: '🤩', melting_face: '🫠', pleading_face: '🥺', smiling_face_with_3_hearts: '🥰',
};
/** A Slack reaction as an emoji (skin tones dropped); custom ones keep their :name:. */
export const emojiOf = (name: string) => {
  const n = name.split('::')[0];
  return EMOJI[n] ?? `:${n}:`;
};

/** Slack's markup as plain text: <@U1> mentions, <#C1|name> channels, <url|label> links, &amp; and friends. */
export function plainText(t: string, mention: (id: string, label: string) => string, channel: (id: string, label: string) => string) {
  return t
    .replace(/<([^<>\n]+)>/g, (_, inner: string) => {
      const bar = inner.indexOf('|');
      const a = bar < 0 ? inner : inner.slice(0, bar);
      const label = bar < 0 ? '' : inner.slice(bar + 1);
      if (a.startsWith('@')) return mention(a.slice(1), label.replace(/^@/, ''));
      if (a.startsWith('#')) return `#${channel(a.slice(1), label)}`;
      if (a.startsWith('!')) {
        const k = a.slice(1);
        if (k === 'here' || k === 'channel' || k === 'everyone') return `@${k}`;
        return label || '';
      }
      if (a.startsWith('mailto:')) return label || a.slice(7);
      if (/^https?:\/\//i.test(a)) return label && label !== a && label !== a.replace(/^https?:\/\//i, '') ? `${label} (${a})` : a;
      return label || a;
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/* ---------- the run ---------- */

export async function run(ctx: RunCtx) {
  const { at, days } = await layoutOf(ctx.file);
  const users = arr<SUser>(await readJson(ctx.file, at('users.json'))).filter((u) => u && typeof u.id === 'string');
  const byId = new Map(users.map((u) => [u.id, u]));
  const convs = (await conversations(ctx.file, at)).filter((c) => !(ctx.choices.leaveOut ?? []).includes(c.key));
  const wsId = ctx.ws.id;
  const nameOf = (id: string) => ctx.people.get(id)?.name ?? userName(byId.get(id), id);
  const memberId = (id: string) => ctx.people.get(id)?.userId;
  /** Who wrote it: a member here, or a name kept on the message (someone not here, or a bot). */
  const authorOf = (m: SMsg): { userId: string; authorName?: string } => {
    if (m.user && m.user !== 'USLACKBOT') {
      const id = memberId(m.user);
      if (id) return { userId: id };
      return { userId: `former:${m.user}`, authorName: nameOf(m.user) || str(m.user_profile?.real_name) || 'Former member' };
    }
    const bot = str(m.username) || str(m.bot_profile?.name) || (m.user === 'USLACKBOT' ? 'Slackbot' : 'Bot');
    return { userId: `former:bot:${slugName(bot)}`, authorName: bot };
  };
  const firstName = (userId: string) => String((db.getDoc('users', userId) as any)?.name ?? '').split(' ')[0];
  const mention = (id: string, label: string) => {
    const mapped = memberId(id);
    if (mapped) return `@${firstName(mapped) || label || nameOf(id)}`;
    return `@${label || nameOf(id)}`;
  };
  const chanNames = new Map(convs.map((c) => [c.key, slugName(c.name)]));
  const channel = (id: string, label: string) => label || chanNames.get(id) || 'channel';
  const here = new Map((db.allDocs('channels') as any[]).filter((c) => c.workspaceId === wsId && c.kind === 'channel' && !c.archived).map((c) => [String(c.name), String(c.id)]));
  const askOver = Number(ctx.preview.room.askOverMb ?? 500) * 1024 * 1024;
  let newChannels = 0;
  let newDms = 0;
  let messages = 0;
  let files = 0;

  for (const [ci, c] of convs.entries()) {
    const label = convLabel(c, nameOf);
    ctx.progress(label, ci, convs.length);
    // Where its messages go.
    let channelId: string;
    const mapped = [...new Set(c.members.map(memberId).filter(Boolean) as string[])];
    if (c.kind === 'dm' || c.kind === 'group') {
      if (!mapped.length) {
        ctx.missing(label, 'Direct messages', 'nobody in them is a member here');
        continue;
      }
      channelId = newId('ch-');
      const others = c.members.filter((x) => !memberId(x));
      const doc =
        c.kind === 'dm'
          ? { id: channelId, workspaceId: wsId, kind: 'dm', name: c.members.map(nameOf).join(', ').slice(0, 80), members: [...mapped, ...others.map((x) => `former:${x}`)].slice(0, 2), createdAt: c.created ? new Date(c.created * 1000).toISOString() : new Date().toISOString() }
          : { id: channelId, workspaceId: wsId, kind: 'channel', name: slugName(c.members.map((x) => nameOf(x).split(' ')[0]).join('-')).slice(0, 60), members: mapped, private: true, category: 'project', topic: `Group messages from Slack with ${c.members.map(nameOf).join(', ')}`.slice(0, 250), ownerId: mapped[0], createdAt: c.created ? new Date(c.created * 1000).toISOString() : new Date().toISOString() };
      ctx.add('channels', [doc]);
      if (c.kind === 'dm') newDms++;
      else newChannels++;
    } else {
      const into = here.get(slugName(c.name));
      if (into) channelId = into;
      else {
        channelId = newId('ch-');
        const members = c.kind === 'private' && !mapped.length ? [ctx.me] : mapped;
        const owner = (c.creator && memberId(c.creator)) || ctx.me;
        const doc = {
          id: channelId,
          workspaceId: wsId,
          kind: 'channel',
          name: slugName(c.name),
          members,
          ...(c.about ? { topic: plainText(c.about, mention, channel).slice(0, 250) } : {}),
          category: 'project',
          ...(c.kind === 'private' ? { private: true } : {}),
          ...(c.archived ? { archived: true } : {}),
          ownerId: owner,
          createdAt: c.created ? new Date(c.created * 1000).toISOString() : new Date().toISOString(),
        };
        ctx.add('channels', [doc]);
        here.set(doc.name, channelId);
        newChannels++;
      }
    }

    // Its messages, oldest first, so a thread's replies find their first message.
    const raw: SMsg[] = [];
    for (const e of days.get(c.folder) ?? []) {
      for (const m of arr<SMsg>(await readJson(ctx.file, e))) if (keep(m)) raw.push(m);
      await ctx.breathe();
    }
    raw.sort((a, b) => Number(a.ts) - Number(b.ts));
    const idOfTs = new Map<string, string>();
    for (const m of raw) idOfTs.set(String(m.ts), newId('m-'));
    const written = new Set<string>();
    const where = c.kind === 'dm' || c.kind === 'group' ? label : `#${slugName(c.name)}`;

    let batch: db.Doc[] = [];
    const flush = () => {
      ctx.add('messages', batch);
      messages += batch.length;
      batch = [];
    };
    for (const [mi, m] of raw.entries()) {
      const ts = String(m.ts);
      const parent = m.thread_ts && m.thread_ts !== ts ? idOfTs.get(String(m.thread_ts)) : undefined;
      const parentId = parent && written.has(parent) ? parent : undefined; // a reply whose first message isn't here stands on its own
      let text = plainText(str(m.text), mention, channel);
      if (!text.trim()) text = arr<{ fallback?: string; text?: string }>(m.attachments).map((x) => str(x.fallback) || str(x.text)).filter(Boolean).join('\n');
      const reactions: Record<string, string[]> = {};
      for (const r of arr<{ name: string; users?: string[] }>(m.reactions)) {
        if (!str(r.name)) continue;
        const e = emojiOf(r.name);
        reactions[e] = [...new Set([...(reactions[e] ?? []), ...arr<string>(r.users).map((u) => memberId(u) ?? `former:${u}`)])];
      }
      const chatFiles: ChatFile[] = [];
      for (const f of arr<SFile>(m.files)) {
        const got = await fileOf(ctx, f, where, askOver);
        if (got.url) files++;
        chatFiles.push(got);
      }
      if (!text.trim() && !chatFiles.length) continue;
      const doc = {
        id: idOfTs.get(ts)!,
        channelId,
        ...authorOf(m),
        text: text.slice(0, 40_000),
        at: new Date(tsMs(m.ts)).toISOString(),
        ...(parentId ? { parentId } : {}),
        ...(parentId && m.subtype === 'thread_broadcast' ? { alsoInChannel: true } : {}),
        ...(Object.keys(reactions).length ? { reactions } : {}),
        ...(chatFiles.length ? { files: chatFiles } : {}),
        ...(m.edited ? { edited: true } : {}),
      };
      batch.push(doc as db.Doc);
      written.add(doc.id);
      if (batch.length >= 400) {
        flush();
        ctx.progress(label, ci + mi / Math.max(1, raw.length), convs.length);
        await ctx.breathe();
      }
    }
    flush();
  }
  ctx.made('channels', newChannels);
  ctx.made('direct messages', newDms);
  ctx.made('messages', messages);
  ctx.made('files', files);
}

/** A message's file: fetched from Slack's link into data/files when it can be, else just its name, with why. */
async function fileOf(ctx: RunCtx, f: SFile, where: string, askOver: number): Promise<ChatFile> {
  const name = (str(f.name) || str(f.title) || 'file').slice(0, 200);
  const size = Math.max(0, Number(f.size) || 0);
  const type = typeOf(name, str(f.mimetype)).slice(0, 100);
  const url = fileUrl(f);
  const left = (why: string): ChatFile => (ctx.missing(name, where, why), { name, size, type, missing: why });
  if (!url) return left('not in the export');
  if (!ctx.choices.big && askOver > 0 && size > askOver) return left(`over ${mbText(askOver)}, left out`);
  if (size > ctx.maxFile()) return left(`over the ${mbText(ctx.maxFile())} limit for one file`);
  const room = ctx.room();
  if (size > room) return left('no room left in the company’s storage');
  const id = fileId();
  try {
    const got = await download(url, db.filePath(id), Math.min(ctx.maxFile(), room), { html: type === 'text/html' });
    ctx.addFile({ id, name, type, size: got.size });
    return { name, size: got.size, type, url: `/api/files/${id}` };
  } catch (e) {
    dropFile(id);
    return left(`couldn’t be fetched: ${e instanceof Error ? e.message : 'it failed'}`);
  }
}
