import { AlignLeft, AtSign, Calendar, CalendarClock, CalendarPlus, CheckSquare, CircleDot, Coins, Hash, Link2, List, MousePointerClick, Paperclip, Phone, Sigma, Star, Tags, Type, User as UserIcon, UserPen, Variable, type LucideIcon } from 'lucide-react';
import type { FieldType } from '../../types';

/** Every kind of column, in the order the "Add field" menu shows them. */
export const FIELD_TYPES: { type: FieldType; label: string; icon: LucideIcon; hint: string }[] = [
  { type: 'text', label: 'Text', icon: Type, hint: 'A name, a short line' },
  { type: 'longtext', label: 'Long text', icon: AlignLeft, hint: 'Notes, a description' },
  { type: 'select', label: 'Single choice', icon: CircleDot, hint: 'Status, stage, source' },
  { type: 'multi', label: 'Multiple choice', icon: Tags, hint: 'Tags, platforms' },
  { type: 'number', label: 'Number', icon: Hash, hint: 'Counts, scores' },
  { type: 'money', label: 'Money', icon: Coins, hint: 'Deal value, budget' },
  { type: 'date', label: 'Date', icon: Calendar, hint: 'Follow-up, deadline' },
  { type: 'person', label: 'Person', icon: UserIcon, hint: 'Someone on the team' },
  { type: 'email', label: 'Email', icon: AtSign, hint: 'Opens a new email' },
  { type: 'phone', label: 'Phone', icon: Phone, hint: 'Call or WhatsApp' },
  { type: 'url', label: 'Link', icon: Link2, hint: 'A website' },
  { type: 'checkbox', label: 'Checkbox', icon: CheckSquare, hint: 'Yes or no' },
  { type: 'files', label: 'Files', icon: Paperclip, hint: 'Photos, contracts, briefs' },
  { type: 'rating', label: 'Rating', icon: Star, hint: 'Stars, like lead quality' },
  { type: 'link', label: 'Link to another table', icon: List, hint: 'A lead’s deals, a client’s contacts' },
  { type: 'rollup', label: 'Rollup', icon: Sigma, hint: 'Count or add up linked rows' },
  { type: 'formula', label: 'Formula', icon: Variable, hint: 'Worked out from other fields' },
  { type: 'created', label: 'Created time', icon: CalendarPlus, hint: 'Filled in by itself' },
  { type: 'edited', label: 'Last edited', icon: CalendarClock, hint: 'Filled in by itself' },
  { type: 'creator', label: 'Created by', icon: UserPen, hint: 'Who added the row' },
  { type: 'button', label: 'Button', icon: MousePointerClick, hint: 'Does something: send a webhook, move the row, make a task' },
];
export const fieldIcon = (t: FieldType) => FIELD_TYPES.find((f) => f.type === t)?.icon ?? Type;

export * from './core';
