import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { validateFrontendEnv } from './utils/envValidator'
import { soundService } from './services/soundService'

const savedTheme = localStorage.getItem('chesster_theme')
if (savedTheme) {
  try {
    const parsed = JSON.parse(savedTheme) as { state?: { boardTheme?: string } }
    const boardTheme = parsed.state?.boardTheme
    if (['classic', 'wood', 'neon', 'marble'].includes(boardTheme ?? '')) {
      document.documentElement.dataset.theme = boardTheme
    }
  } catch {
    // Zustand will fall back to the default theme during hydration.
  }
}

validateFrontendEnv()
soundService.unlockOnFirstInteraction()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
