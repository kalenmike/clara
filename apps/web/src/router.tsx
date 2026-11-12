import { createBrowserRouter, Navigate } from 'react-router'
import { RouteError } from '@/components/errors/route-error'
import { AppShell } from '@/components/layout/app-shell'
import { ActivityPage } from '@/pages/activity-page'
import { ChatPage } from '@/pages/chat-page'
import { ConnectPage } from '@/pages/connect-page'
import { HomePage } from '@/pages/home-page'
import { ProjectsPage } from '@/pages/projects-page'
import { SessionsPage } from '@/pages/sessions-page'
import { SettingsPage } from '@/pages/settings-page'

export const router = createBrowserRouter([
  { path: '/connect', element: <ConnectPage />, errorElement: <RouteError /> },
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'activity', element: <ActivityPage /> },
      { path: 'p/:projectId', element: <SessionsPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'p/:projectId/s/:sessionId', element: <ChatPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
