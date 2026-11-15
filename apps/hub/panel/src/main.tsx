import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PanelApp, PanelThemeProvider, applyStoredPanelTheme } from '@clara/panel'
import '@clara/panel/styles/globals.css'
import '@clara/panel/styles/shell.css'

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
