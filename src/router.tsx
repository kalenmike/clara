import { createBrowserRouter, Navigate } from 'react-router'
import { AppShell } from '@/components/layout/app-shell'
import { ChatPage } from '@/pages/chat-page'
import { ConnectPage } from '@/pages/connect-page'
import { HomePage } from '@/pages/home-page'
import { SessionsPage } from '@/pages/sessions-page'
import { SettingsPage } from '@/pages/settings-page'

export const router = createBrowserRouter([
  { path: '/connect', element: <ConnectPage /> },
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'p/:projectId', element: <SessionsPage /> },
      { path: 'p/:projectId/s/:sessionId', element: <ChatPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
