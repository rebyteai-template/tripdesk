import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { QueryPersistGate } from './components/QueryPersistGate.tsx'
import './kami-tokens.css'
import './styles.css'

// React Query (server state, persisted per tenant) wraps the app; jotai (UI +
// streaming state) uses its default global store, so no Provider is needed.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryPersistGate>
      <App />
    </QueryPersistGate>
  </StrictMode>,
)
