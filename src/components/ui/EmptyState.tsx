import type { ReactNode } from 'react';

/**
 * What an empty list or screen says, the same way everywhere: an icon, a title, a line on what to do, and the one
 * action that fills it. Spacing is on the 8px scale (system.css): 16px under the icon, 8px between title and text,
 * 16px above the action. `compact` is for a list inside a card or panel: no icon, smaller, left-aligned.
 */
export function EmptyState({
  icon,
  title,
  text,
  action,
  compact,
  className = '',
}: {
  icon?: ReactNode;
  title?: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={`empty empty-state ${compact ? 'compact' : ''} ${className}`}>
      {icon && !compact && <div className="empty-art">{icon}</div>}
      {title && <p className="empty-title">{title}</p>}
      {text && <p className="empty-sub">{text}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}
