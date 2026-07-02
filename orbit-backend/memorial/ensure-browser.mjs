// Descarga el Chromium headless de Remotion en tiempo de build de la imagen,
// para que el primer render en producción no dependa de red.
import { ensureBrowser } from '@remotion/renderer'
await ensureBrowser()
console.log('Remotion headless browser listo.')
