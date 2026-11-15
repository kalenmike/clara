import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LabApp } from '@clara/lab'
import '@clara/lab/styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Clara Lab root element is missing')

createRoot(root).render(
  <StrictMode>
    <LabApp />
  </StrictMode>
)
