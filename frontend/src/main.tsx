import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { migrateLegacyKeys } from './utils/storage'
import { registerServiceWorker } from './pwa'

// Before the first render, so nothing reads a pre-rename key: the admin/customer
// session and saved carts live under these entries.
migrateLegacyKeys()

// Production-only, best-effort offline support. Deferred until after `load`.
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
