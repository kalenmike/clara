import { createBrowserRouter, Navigate } from 'react-router'
import { ConnectionSplash } from '@/components/connect/connection-splash'
import { RouteError } from '@/components/errors/route-error'
import { AppShell } from '@/components/layout/app-shell'
import { ConnectPage } from '@/pages/connect-page'
import { HomePage } from '@/pages/home-page'

/**
 * Every screen except the shell, the landing view, and the pairing view loads
 * on demand. They are separate chunks so a cold start does not pay for the chat
 * transcript renderer, the settings cards, or the activity timeline before the
 * user opens them, and so a deploy only re-downloads the screens that changed.
 *
 * The shell and `/connect` stay eager: the shell is the frame for every route,
 * and pairing is the first thing an unpaired install shows.
 */
export const router = createBrowserRouter([
  { path: '/connect', element: <ConnectPage />, errorElement: <RouteError /> },
  {
    // The hub panel is a full-window surface, so it stays outside the app shell
    // and owns its own connection gate.
    path: '/hub',
    lazy: () => import('@/pages/hub-panel-page').then((m) => ({ Component: m.HubPanelPage })),
    errorElement: <RouteError />,
    HydrateFallback: () => <ConnectionSplash label="Loading the hub panel…" />,
  },
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    // A deep link matches a lazy screen, so the first paint waits for that chunk.
    // The splash keeps the wait from looking like an empty window.
    HydrateFallback: () => <ConnectionSplash label="Loading Clara…" />,
    children: [
      { index: true, element: <HomePage /> },
      {
        path: 'activity',
        lazy: () => import('@/pages/activity-page').then((m) => ({ Component: m.ActivityPage })),
      },
      {
        path: 'p/:projectId',
        lazy: () => import('@/pages/sessions-page').then((m) => ({ Component: m.SessionsPage })),
      },
      {
        path: 'projects',
        lazy: () => import('@/pages/projects-page').then((m) => ({ Component: m.ProjectsPage })),
      },
      {
        path: 'p/:projectId/s/:sessionId',
        lazy: () => import('@/pages/chat-page').then((m) => ({ Component: m.ChatPage })),
      },
      {
        path: 'settings',
        lazy: () => import('@/pages/settings-page').then((m) => ({ Component: m.SettingsPage })),
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
