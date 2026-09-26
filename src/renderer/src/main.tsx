import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppStoreProvider } from './state/store'
import './styles/theme.css'
import './styles/app.css'
import './styles/stalker.css'
import './styles/workbench.css'
import './styles/loadout.css'
import './styles/ledger.css'
import './styles/tools.css'
import './styles/workshop.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root container missing')

createRoot(container).render(
  <StrictMode>
    <AppStoreProvider>
      <App />
    </AppStoreProvider>
  </StrictMode>
)
