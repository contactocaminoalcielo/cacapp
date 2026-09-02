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

// Chunk viejo que ya no existe en el servidor ("Failed to fetch dynamically
// imported module: …/assets/jspdf.es.min-XXXX.js"). Pasaba porque el deploy subía
// `dist` con `rm: true` y borraba los assets con hash del build anterior,
// mientras una pestaña abierta desde antes seguía pidiendo ESOS nombres. Como el
// service worker es 'prompt' (no entra solo), una pestaña puede quedarse días con
// el build viejo y el fallo aparece recién cuando el usuario toca algo que se
// carga diferido — descargar el contrato de pre-exequiales, el PDF de un cuadre,
// un certificado. El deploy ya no borra (ver deploy.yml), pero los assets se
// podan a los 30 días y una pestaña más vieja que eso vuelve a caer aquí.
//
// Vite avisa con `vite:preloadError` antes de que el error llegue al código que
// hizo el import: recargamos para tomar el build nuevo. Una sola vez por minuto
// — si el chunk falla por otra razón (red caída, 500), la segunda vez dejamos
// que el error se vea en vez de dejar la pestaña recargando en bucle.
const CLAVE_RECARGA = 'orbit:recarga-por-chunk'
window.addEventListener('vite:preloadError', (e) => {
  const ultima = Number(sessionStorage.getItem(CLAVE_RECARGA) || 0)
  if (Date.now() - ultima < 60000) return
  sessionStorage.setItem(CLAVE_RECARGA, String(Date.now()))
  e.preventDefault()
  window.location.reload()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
