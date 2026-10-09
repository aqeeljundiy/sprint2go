import { ProjectBadge } from './ProjectBadge';
import { createContext, useContext } from 'react';
import type { Client } from '../types';
import { term } from '../terms';
import { Dot, Select } from './ui/Select';
import { t, tx } from '../i18n';

/** Lets any project picker create a project on the spot. The team app provides it; guests don't get it. */
export const ProjectsCtx = createContext<{ create?: (name: string) => Client }>({});

/**
 * The one project dropdown used everywhere (tasks, notes, vault, drive, meetings, channels, templates, brain dump):
 * search, colours, past projects only when already chosen, and "+ New project" at the bottom.
 */
export function ProjectPicker({
  value,
  onChange,
  projects,
  none,
  label,
  className,
  width,
  placeholder,
}: {
  value: string | null | undefined;
  onChange: (id: string) => void;
  projects: Client[];
  none?: string; // the "no project" choice, e.g. "No project" or "Company login (no project)"
  label?: string;
  className?: string;
  width?: number;
  placeholder?: string;
}) {
  const { create } = useContext(ProjectsCtx);
  const options = [
    ...(none !== undefined ? [{ value: '', label: none, icon: <Dot color="var(--text-3)" /> }] : []),
    ...projects
      .filter((c) => c.status !== 'ended' || c.id === value)
      .map((c) => ({
        value: c.id,
        label: c.name,
        hint: c.status === 'lead' ? tx('status', 'Lead') : c.status === 'ended' ? t('Past {project}', { project: term.one }) : c.type ? t(c.type) : undefined,
        icon: c.photo ? <ProjectBadge p={c} kind="client-dot sm" className="pick-badge" /> : <Dot color={c.color} />,
      })),
  ];
  return (
    <Select
      value={value ?? ''}
      options={options}
      onChange={onChange}
      label={label ?? term.One}
      className={className}
      width={width ?? 260}
      placeholder={placeholder ?? t('Pick a {project}', { project: term.one })}
      searchable
      create={create ? { label: t('New {project}', { project: term.one }), placeholder: t('{Project} name', { project: term.one }), make: (name) => create(name).id } : undefined}
    />
  );
}
