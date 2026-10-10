import type { Note } from '../types';

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

export const NOTES: Note[] = [
  {
    id: 'note-kk-prep',
    workspaceId: 'pnp',
    title: 'Kopinara review call prep',
    html: '<p><b>Thursday 2pm WIB</b> with Laras and her CEO.</p><ul><li>Lead with direction 2 (morning ritual), it’s the CEO’s favourite angle</li><li>Show the 15s cutdown before the statics</li><li>Ask about the December budget</li></ul><p>Follow up: send the recap the same day.</p>',
    ownerId: 'u-raka',
    visibility: 'team',
    clientId: 'c-kopinara',
    pinned: true,
    createdAt: ago(30),
    updatedAt: ago(3),
    updatedBy: 'u-raka',
  },
  {
    id: 'note-hiring',
    workspaceId: 'pnp',
    title: 'Hiring: what we need in a performance marketer',
    html: '<ul><li>Meta and TikTok, hands on, not just reporting</li><li>Comfortable talking to clients</li><li>Bahasa and English</li></ul>',
    ownerId: 'u-raka',
    visibility: 'private',
    createdAt: ago(80),
    updatedAt: ago(26),
    updatedBy: 'u-raka',
  },
  {
    id: 'note-process',
    workspaceId: 'pnp',
    title: 'How we hand off a new client',
    html: '<ol><li>Start a brief from the “New client onboarding” template</li><li>Create the client channel and a “With client” channel</li><li>Invite their people to the portal</li><li>Book the kickoff</li></ol>',
    ownerId: 'u-hendra',
    visibility: 'team',
    createdAt: ago(240),
    updatedAt: ago(120),
    updatedBy: 'u-hendra',
  },
];
