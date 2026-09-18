# ADR-003 — Los PDFs de marca se imprimen en el backend (HTML → PDF con Chromium)

**Fecha:** 2026-09-18 · **Estado:** aceptada · **Commit:** `6fd2fc0`

## Contexto
Todos los PDFs de Orbit se dibujaban en el navegador con jsPDF, a mano y por coordenadas:
sin tipografía de marca, sin fondo, con tres paletas distintas conviviendo y con un
certificado de entrega que «se desordenaba feo» al listar los recordatorios en cajas. La
alternativa de capturar HTML con html2canvas está prohibida en el proyecto (Tailwind v4 usa
`oklch()` y html2canvas revienta), y el único documento que la usaba (certificados
grupales) sale como una foto JPEG sin texto seleccionable.

David pidió «mejorar la generación de PDFs con mejores estilos y fondo de marca», empezando
por el certificado de entrega.

## Decisión
1. **El backend imprime los PDFs de marca** con el Chromium headless que ya vive en el
   contenedor para los memoriales (Remotion). `puppeteer-core` solo aporta el protocolo; no
   se descarga un segundo navegador ni crece la imagen.
2. **Cada documento es una plantilla HTML** (`orbit-backend/src/pdf-plantillas/`) envuelta en
   un marco común (`marco.js`): logo, fuentes Nunito y Playfair Display incrustadas,
   cabecera y pie repetidos en cada página, marca de agua. Paleta y datos de la empresa
   viven en un solo sitio (`pdf-recursos.js`).
3. **La pestaña que imprime no tiene red.** Todo va incrustado como data URI. Así ningún
   HTML puede alcanzar la red interna del Docker ni depender de un CDN.
4. **Una ruta por documento** (`POST /pdf/<doc>`) que recibe los mismos datos que el
   frontend ya armaba y devuelve los bytes. El frontend descarga el blob.
5. **El generador jsPDF anterior se conserva como respaldo** en el frontend: si el backend
   no responde (sin red en la calle, contenedor caído), el mensajero sigue teniendo su
   certificado.

## Consecuencias
- Chromium corre dentro del contenedor: `docker-compose.yml` lleva `init: true` (recoge
  zombis) y `shm_size: 256m`; el motor limita renders simultáneos (2) y tiempo (30 s).
- El despliegue del backend debe copiar también `pdf/` (fuentes), `Dockerfile` y
  `docker-compose.yml`.
- Un PDF pesa ~300 KB por las fuentes incrustadas (antes ~50-200 KB). Aceptable.
- Los demás PDFs (recibo del técnico, cuadre, salidas, contrato, certificados grupales) se
  migran uno a uno a este esquema; el siguiente candidato natural son los certificados
  grupales, que hoy son una imagen.
- La regla «jsPDF directo, nunca html2canvas» sigue vigente para lo que aún no se migra.
