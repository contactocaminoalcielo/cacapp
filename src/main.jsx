import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// OJO: aquí NO va un `controllerchange → window.location.reload()`. Eso recargaba
// la pestaña de todos los usuarios en cuanto se desplegaba un build, en medio de
// lo que estuvieran registrando. El recargue ahora lo dispara el usuario desde
// AvisoNuevaVersion (updateServiceWorker(true) ya recarga por su cuenta).

// Suprimir el aviso de "Instalar app" del navegador: Orbit se usa en el
// navegador, no como app instalada (decisión 2026-06-12). El service worker
// y su caché siguen activos — esto solo bloquea el prompt de instalación.
window.addEventListener('beforeinstallprompt', e => e.preventDefault())

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
