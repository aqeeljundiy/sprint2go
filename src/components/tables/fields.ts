import { AlignLeft, AtSign, Calendar, CheckSquare, CircleDot, Coins, Hash, Link2, List, MousePointerClick, Phone, Tags, Type, User as UserIcon, type LucideIcon } from 'lucide-react';
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
  { type: 'link', label: 'Link to another table', icon: List, hint: 'A lead’s deals, a client’s contacts' },
  { type: 'button', label: 'Button', icon: MousePointerClick, hint: 'Does something: send a webhook, move the row, make a task' },
];
export const fieldIcon = (t: FieldType) => FIELD_TYPES.find((f) => f.type === t)?.icon ?? Type;

export * from './core';
