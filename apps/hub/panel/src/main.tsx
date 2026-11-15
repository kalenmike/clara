import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PanelApp, PanelThemeProvider, applyStoredPanelTheme } from '@clara/panel'
// The served page owns its document, so it uses the standalone entry; the
// bundled `/hub` route imports `globals.css` + `shell.css` itself.
import '@clara/panel/styles/standalone.css'

applyStoredPanelTheme()

// The served page owns its document, so the shared base styles keep the
// viewport-sized shell here. An embedding host such as the `/hub` route has no
// such marker and sizes the shell from its own layout box instead.
document.documentElement.classList.add('panel-standalone')

const root = document.getElementById('root')
if (!root) throw new Error('The panel root element is missing')

createRoot(root).render(
  <StrictMode>
    <PanelThemeProvider>
      <PanelApp />
    </PanelThemeProvider>
  </StrictMode>
)
