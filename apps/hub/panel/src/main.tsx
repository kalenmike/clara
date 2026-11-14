import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { applyStoredPanelTheme } from './lib/theme.ts'
import { PanelThemeProvider } from './lib/theme-provider.tsx'
import './styles/globals.css'
import './styles/shell.css'

applyStoredPanelTheme()

const root = document.getElementById('root')
if (!root) throw new Error('The panel root element is missing')

createRoot(root).render(
  <StrictMode>
    <PanelThemeProvider>
      <App />
    </PanelThemeProvider>
  </StrictMode>
)
