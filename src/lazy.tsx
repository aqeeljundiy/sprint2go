import { lazy, Suspense, type ComponentType } from 'react';

/**
 * Screens and dialogs loaded only when first shown, so the app's first download stays small.
 * Each one renders inside its own Suspense, so the rest of the page never waits for it.
 */
function split<P extends object>(load: () => Promise<ComponentType<P>>) {
  const L = lazy(() => load().then((c) => ({ default: c })));
  return function Split(props: P) {
    return (
      <Suspense fallback={<div className="lazy-wait" aria-hidden />}>
        <L {...(props as P)} />
      </Suspense>
    );
  };
}

export const SettingsPage = split(() => import('./components/SettingsPage').then((m) => m.SettingsPage));
export const Onboarding = split(() => import('./components/Onboarding').then((m) => m.Onboarding));
export const ClientApp = split(() => import('./components/ClientApp').then((m) => m.ClientApp));
export const SharedHome = split(() => import('./components/SharedHome').then((m) => m.SharedHome));
export const DriveView = split(() => import('./components/DriveView').then((m) => m.DriveView));
export const CalendarView = split(() => import('./components/CalendarView').then((m) => m.CalendarView));
export const EventEditor = split(() => import('./components/EventEditor').then((m) => m.EventEditor));
export const ConnectCalendar = split(() => import('./components/ConnectCalendar').then((m) => m.ConnectCalendar));
export const NoteEditor = split(() => import('./components/NotesApp').then((m) => m.NoteEditor));
export const NotesList = split(() => import('./components/NotesApp').then((m) => m.NotesList));
export const QuickNote = split(() => import('./components/NotesApp').then((m) => m.QuickNote));
export const VaultSidebar = split(() => import('./components/VaultApp').then((m) => m.VaultSidebar));
export const VaultView = split(() => import('./components/VaultApp').then((m) => m.VaultView));
export const MeetSidebar = split(() => import('./components/MeetApp').then((m) => m.MeetSidebar));
export const MeetView = split(() => import('./components/MeetApp').then((m) => m.MeetView));
export const SendBotDialog = split(() => import('./components/MeetApp').then((m) => m.SendBotDialog));
export const ShareDialog = split(() => import('./components/MeetApp').then((m) => m.ShareDialog));
export const SharedPage = split(() => import('./components/MeetApp').then((m) => m.SharedPage));
export const TeamsSidebar = split(() => import('./components/teams/TeamsApp').then((m) => m.TeamsSidebar));
export const TeamsHome = split(() => import('./components/teams/TeamsApp').then((m) => m.TeamsHome));
export const TeamPage = split(() => import('./components/teams/TeamsApp').then((m) => m.TeamPage));
export const NewTeamDialog = split(() => import('./components/teams/TeamsApp').then((m) => m.NewTeamDialog));
export const TableScreen = split(() => import('./components/tables/TableScreen').then((m) => m.TableScreen));
export const TrackingDashboard = split(() => import('./components/TrackingDashboard').then((m) => m.TrackingDashboard));
export const BrainDump = split(() => import('./components/BrainDump').then((m) => m.BrainDump));
export const Assistant = split(() => import('./components/Assistant').then((m) => m.Assistant));
export const TemplateDialog = split(() => import('./components/TemplateDialog').then((m) => m.TemplateDialog));
export const EndClientDialog = split(() => import('./components/EndClientDialog').then((m) => m.EndClientDialog));
export const BlockDialog = split(() => import('./components/BlockDialog').then((m) => m.BlockDialog));
export const AdminApp = split(() => import('./admin/AdminApp').then((m) => m.AdminApp));
export const ActingBanner = split(() => import('./admin/AdminApp').then((m) => m.ActingBanner));
export const ConnectApp = split(() => import('./components/ConnectApp').then((m) => m.ConnectApp));
