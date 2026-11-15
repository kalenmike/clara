import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { configureLabApi, LabApp } from '@clara/lab'
import '@clara/lab/styles.css'

// The standalone lab is served by the lab server on the same origin, so relative
// `/api/...` paths need no base path. The desktop app configures a hub-bridge
// transport with `basePath: '/v1/lab'` instead.
configureLabApi({
  fetch: (input, init) => globalThis.fetch(input, init),
  basePath: '',
})

const root = document.getElementById('root')
if (!root) throw new Error('Clara Lab root element is missing')

createRoot(root).render(
  <StrictMode>
    <div className="lab-root">
      <LabApp />
    </div>
  </StrictMode>
)
