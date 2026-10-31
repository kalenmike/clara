import '@fontsource-variable/geist'
import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initColorTheme } from './features/theme/color-theme'
import { capturePairingLink } from './lib/pairing'

capturePairingLink()
initColorTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
