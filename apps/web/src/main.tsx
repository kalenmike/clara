import '@fontsource-variable/geist'
import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppErrorBoundary } from './components/errors/app-error-boundary'
import { startServiceWorker } from './features/pwa/update-store'
import { initColorTheme } from './features/theme/color-theme'
import { capturePairingLink } from './lib/pairing'

capturePairingLink()
initColorTheme()
startServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
)
