import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { initLifelog, logEvent } from './lib/lifelog'

// Diagnóstico de reinicios en el celular (temporal) — debe ir lo antes posible
initLifelog()

// Cuando el SW detecta un nuevo build, recarga la página automáticamente
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    logEvent('SW:controllerchange')
    window.location.reload()
  })
}

// Suprimir el aviso de "Instalar app" del navegador: Orbit se usa en el
// navegador, no como app instalada (decisión 2026-06-12). El service worker
// y su caché siguen activos — esto solo bloquea el prompt de instalación.
window.addEventListener('beforeinstallprompt', e => e.preventDefault())

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
