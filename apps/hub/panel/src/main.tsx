import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PanelApp, PanelThemeProvider, applyStoredPanelTheme } from '@clara/panel'
// The served page owns its document, so it uses the standalone entry; the
// bundled `/hub` route imports `globals.css` + `shell.css` itself.
import '@clara/panel/styles/standalone.css'

applyStoredPanelTheme()

const root = document.getElementById('root')
if (!root) throw new Error('The panel root element is missing')

createRoot(root).render(
  <StrictMode>
    <PanelThemeProvider>
      <PanelApp />
    </PanelThemeProvider>
  </StrictMode>
)
