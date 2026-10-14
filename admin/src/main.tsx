import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { migrateLegacyKeys } from './utils/storage'

// Before the first render: without this the staff session stored under the
// pre-rename `vedhi.admin.session.*` keys is invisible and the operator is
// bounced to the login screen on every deploy.
migrateLegacyKeys()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
