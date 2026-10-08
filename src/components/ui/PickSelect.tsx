import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Select, type Option } from './Select';

/**
 * Sprint2go's own dropdown, written like a plain <select>: give it <option> (and <optgroup>) children and an
 * onChange that reads e.target.value. It shows the app's searchable list instead of the browser's.
 */
export function PickSelect({
  value,
  onChange,
  children,
  'aria-label': label,
  className = '',
  width,
  searchable,
}: {
  value: string | number | undefined;
  onChange: (e: { target: { value: string } }) => void;
  children: ReactNode;
  'aria-label'?: string;
  className?: string;
  width?: number;
  searchable?: boolean;
}) {
  const options: Option<string>[] = [];
  const walk = (nodes: ReactNode, group?: string) =>
    Children.forEach(nodes, (n) => {
      if (!isValidElement(n)) return;
      const el = n as ReactElement<{ value?: string | number; label?: string; children?: ReactNode; disabled?: boolean }>;
      if (el.type === 'optgroup') return walk(el.props.children, el.props.label);
      if (el.type === 'option') {
        const text = Children.toArray(el.props.children).join('');
        options.push({ value: String(el.props.value ?? text), label: text, group });
        return;
      }
      if (el.props.children) walk(el.props.children, group); // fragments and arrays
    });
  walk(children);
  return (
    <Select<string>
      value={value == null ? '' : String(value)}
      onChange={(v) => onChange({ target: { value: v } })}
      options={options}
      label={label}
      className={`sel-flat pick-select ${className}`}
      width={width}
      searchable={searchable ?? options.length > 6}
    />
  );
}
