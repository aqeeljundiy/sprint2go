import { AlignLeft, AtSign, Calendar, CalendarClock, CalendarPlus, CheckSquare, CircleDot, Coins, Hash, Link2, List, MousePointerClick, Paperclip, Phone, Sigma, Star, Tags, Type, User as UserIcon, UserPen, Variable, type LucideIcon } from 'lucide-react';
import type { FieldType } from '../../types';
import { t } from '../../i18n';

/** Every kind of column, in the order the "Add field" menu shows them. `label` and `hint` are in the reader's language. */
export const FIELD_TYPES: { type: FieldType; label: string; icon: LucideIcon; hint: string }[] = [
  { type: 'text', get label() { return t('Text'); }, icon: Type, get hint() { return t('A name, a short line'); } },
  { type: 'longtext', get label() { return t('Long text'); }, icon: AlignLeft, get hint() { return t('Notes, a description'); } },
  { type: 'select', get label() { return t('Single choice'); }, icon: CircleDot, get hint() { return t('Status, stage, source'); } },
  { type: 'multi', get label() { return t('Multiple choice'); }, icon: Tags, get hint() { return t('Tags, platforms'); } },
  { type: 'number', get label() { return t('Number'); }, icon: Hash, get hint() { return t('Counts, scores'); } },
  { type: 'money', get label() { return t('Money'); }, icon: Coins, get hint() { return t('Deal value, budget'); } },
  { type: 'date', get label() { return t('Date'); }, icon: Calendar, get hint() { return t('Follow-up, deadline'); } },
  { type: 'person', get label() { return t('Person'); }, icon: UserIcon, get hint() { return t('Someone on the team'); } },
  { type: 'email', get label() { return t('Email'); }, icon: AtSign, get hint() { return t('Opens a new email'); } },
  { type: 'phone', get label() { return t('Phone'); }, icon: Phone, get hint() { return t('Call or WhatsApp'); } },
  { type: 'url', get label() { return t('Link'); }, icon: Link2, get hint() { return t('A website'); } },
  { type: 'checkbox', get label() { return t('Checkbox'); }, icon: CheckSquare, get hint() { return t('Yes or no'); } },
  { type: 'files', get label() { return t('Files'); }, icon: Paperclip, get hint() { return t('Photos, contracts, briefs'); } },
  { type: 'rating', get label() { return t('Rating'); }, icon: Star, get hint() { return t('Stars, like lead quality'); } },
  { type: 'link', get label() { return t('Link to another table'); }, icon: List, get hint() { return t('A lead’s deals, a client’s contacts'); } },
  { type: 'rollup', get label() { return t('Rollup'); }, icon: Sigma, get hint() { return t('Count or add up linked rows'); } },
  { type: 'formula', get label() { return t('Formula'); }, icon: Variable, get hint() { return t('Worked out from other fields'); } },
  { type: 'created', get label() { return t('Created time'); }, icon: CalendarPlus, get hint() { return t('Filled in by itself'); } },
  { type: 'edited', get label() { return t('Last edited'); }, icon: CalendarClock, get hint() { return t('Filled in by itself'); } },
  { type: 'creator', get label() { return t('Created by'); }, icon: UserPen, get hint() { return t('Who added the row'); } },
  { type: 'button', get label() { return t('Button'); }, icon: MousePointerClick, get hint() { return t('Does something: send a webhook, move the row, make a task'); } },
];
export const fieldIcon = (t: FieldType) => FIELD_TYPES.find((f) => f.type === t)?.icon ?? Type;

export * from './core';
