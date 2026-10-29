import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Account from './Account.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Account />
  </StrictMode>,
)
