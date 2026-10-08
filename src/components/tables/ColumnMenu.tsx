import { useEffect, useState } from 'react';
import { Type, ArrowDownAZ, ArrowLeft, ArrowRight, ArrowUpAZ, Copy, EyeOff, Filter, Group, PanelLeft, Pencil, Plus, Trash2, WrapText } from 'lucide-react';
import type { TableField } from '../../types';
import { Popover } from '../ui/Popover';
import { FIELD_TYPES, sortWords } from './fields';

/** Kinds of column that can be a row's name. */
const NAME_TYPES = ['text', 'email', 'phone', 'url', 'number'];
/** Kinds of column with settings of their own beyond the type (choices, a formula, a currency…). */
const WITH_SETTINGS = ['select', 'multi', 'button', 'formula', 'rollup', 'rating', 'money', 'link'];

export type ColumnAction = 'edit' | 'primary' | 'asc' | 'desc' | 'filter' | 'group' | 'wrap' | 'pin' | 'unpin' | 'hide' | 'insertLeft' | 'insertRight' | 'left' | 'right' | 'duplicate' | 'delete';

/**
 * Everything about one column, from its header: rename it, change what kind it is, sort, filter or group by it,
 * wrap its text, keep it in view, hide it, add a column next to it, move it, copy it or delete it.
 */
export function ColumnMenu({
  anchor,
  open,
  onClose,
  field,
  first,
  last,
  leftmost,
  wrapped,
  pinned,
  grouped,
  fixed,
  onRename,
  onDescribe,
  onAction,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  field: TableField;
  first: boolean; // the name column: can't be hidden, moved or deleted
  last: boolean;
  leftmost?: boolean; // shown first in this view
  wrapped: boolean;
  pinned: boolean; // this column is inside the pinned part
  grouped: boolean;
  fixed?: boolean; // this person can't change the table's columns: only how this view shows them
  onRename: (name: string) => void;
  onDescribe: (d: string) => void;
  onAction: (a: ColumnAction) => void;
}) {
  const [name, setName] = useState(field.name);
  const [desc, setDesc] = useState(field.description ?? '');
  useEffect(() => {
    if (open) (setName(field.name), setDesc(field.description ?? ''));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => {
    if (name.trim() && name.trim() !== field.name) onRename(name.trim());
    if (desc.trim() !== (field.description ?? '')) onDescribe(desc.trim());
    onClose();
  };
  const act = (a: ColumnAction) => {
    if (name.trim() && name.trim() !== field.name) onRename(name.trim());
    onAction(a);
    onClose();
  };
  const type = FIELD_TYPES.find((t) => t.type === field.type);
  const [asc, desc2] = sortWords(field.type);
  const sortable = field.type !== 'button' && field.type !== 'files';
  return (
    <Popover anchor={anchor} open={open} onClose={close} width={264} title={field.name}>
      <div className="tb-colmenu">
        {fixed ? (
          <p className="tb-colmenu-fixed">
            {type && <type.icon size={14} />}
            <span>
              <strong>{field.name}</strong>
              <small className="muted">{field.description || `${type?.label ?? 'Field'}. Only admins change columns here.`}</small>
            </span>
          </p>
        ) : (
          <>
            <input className="tb-fm-name" value={name} aria-label="Column name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && close()} />
            <textarea className="tb-col-desc" rows={1} value={desc} placeholder="Add a description (what this is for)" aria-label="Description" onChange={(e) => setDesc(e.target.value)} />
            {first && field.type === 'text' ? (
              // The name column is text and stays text: nothing to change here but its name (above).
              <p className="tb-colmenu-type fixed">
                {type && <type.icon size={14} />}
                <span>{type?.label ?? 'Text'}</span>
                <small className="muted">Each row’s name</small>
              </p>
            ) : (
              <button type="button" className="tb-colmenu-type" onClick={() => act('edit')}>
                {type && <type.icon size={14} />}
                <span>{type?.label ?? 'Field'}</span>
                <small className="muted">
                  <Pencil size={11} /> {WITH_SETTINGS.includes(field.type) ? 'Change type and settings' : 'Change type'}
                </small>
              </button>
            )}
          </>
        )}
        <div className="tb-colmenu-sep" />
        {sortable && (
          <>
            <button type="button" onClick={() => act('asc')}>
              <ArrowDownAZ size={14} /> Sort: {asc}
            </button>
            <button type="button" onClick={() => act('desc')}>
              <ArrowUpAZ size={14} /> Sort: {desc2}
            </button>
            <button type="button" onClick={() => act('filter')}>
              <Filter size={14} /> Filter by this
            </button>
            <button type="button" onClick={() => act('group')}>
              <Group size={14} /> {grouped ? 'Stop grouping' : 'Group by this'}
            </button>
          </>
        )}
        <div className="tb-colmenu-sep" />
        <button type="button" onClick={() => act('wrap')}>
          <WrapText size={14} /> {wrapped ? 'Keep text on one line' : 'Wrap text'}
        </button>
        <button type="button" onClick={() => act(pinned ? 'unpin' : 'pin')}>
          <PanelLeft size={14} /> {pinned ? 'Let columns scroll again' : 'Keep in view up to here'}
        </button>
        {!first && !fixed && NAME_TYPES.includes(field.type) && (
          <button type="button" onClick={() => act('primary')}>
            <Type size={14} /> Use as each row’s name
          </button>
        )}
        {!first && (
          <button type="button" onClick={() => act('hide')}>
            <EyeOff size={14} /> Hide in this view
          </button>
        )}
        <div className="tb-colmenu-sep" />
        {!fixed && (
          <>
            <button type="button" onClick={() => act('insertLeft')}>
              <Plus size={14} /> Add a column to the left
            </button>
            <button type="button" onClick={() => act('insertRight')}>
              <Plus size={14} /> Add a column to the right
            </button>
          </>
        )}
        {
          <div className="tb-colmenu-row">
            <button type="button" disabled={leftmost} onClick={() => act('left')}>
              <ArrowLeft size={14} /> Move left
            </button>
            <button type="button" disabled={last} onClick={() => act('right')}>
              Move right <ArrowRight size={14} />
            </button>
          </div>
        }
        {!first && !fixed && field.type !== 'button' && (
          <button type="button" onClick={() => act('duplicate')}>
            <Copy size={14} /> Duplicate column
          </button>
        )}
        {fixed ? null : !first ? (
          <button type="button" className="danger" onClick={() => confirm(`Delete the “${field.name}” column and everything in it?`) && act('delete')}>
            <Trash2 size={14} /> Delete column
          </button>
        ) : (
          <p className="muted small tb-colmenu-note">This is each row’s name, so it can’t be hidden or deleted. To use another column as the name, open that column’s menu.</p>
        )}
      </div>
    </Popover>
  );
}
