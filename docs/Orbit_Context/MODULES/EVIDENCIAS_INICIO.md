# Evidencias del inicio del compostaje (migración 178, 2026-10-16)

**Pestaña:** Tenjo → 📸 Evidencias (solo COORDINADOR/ADMIN) · `src/pages/tenjo/EvidenciasTab.jsx`
**Backend:** `orbit-backend/src/evidencia-inicio.js` · marco en `pdf-plantillas/marco-evidencia.js`

## Qué hace
Al iniciar el compostaje en la Jornada, el operario sube dos fotos del cubículo (migración 051).
Orbit prepara con ellas una evidencia **POR_REVISAR** enmarcada. Coordinación la abre, ajusta
(zoom/posición de cada foto, frase, formato horizontal/vertical, qué fotos van) y la envía.

## Reglas (David, 2026-10-16)
- **Nada sale sin revisión.** No hay envío automático.
- **Solo compostaje individual con acompañamiento EVIDENCIA.** `COMPETS_PRESENCIAL` excluido.
  Todo es config (`config_operativa`, módulo `EVIDENCIA_INICIO`).
- **Llega dentro del mensaje**: plantilla de Meta con **cabecera de imagen**. Una plantilla lleva
  una sola imagen, así que las dos fotos van en el mismo marco.

## Marco
Lo dibuja el Chromium del backend (`renderImagen` en `pdf.js`), 1350×1080 o 1080×1350. No se guarda
como archivo: se dibuja desde las fotos originales y los ajustes. La vista previa del editor es la
imagen real del backend. Conserva la calidez del marco manual anterior (verde, huellas, «Siempre en
nuestro recuerdo») sobre papel crema con el dorado del logo.

## Envío
- `enviarPlantillaConImagen` (whatsapp.js) solo funciona con `WHATSAPP_OPERATIONAL_TRANSPORT=META`.
- Sin plantilla configurada: **Descargar** + **Ya la envié a mano** (queda `medio_envio = MANUAL`).
- Plantilla elegida por David (UTILITY, es_MX, cabecera IMAGEN): «Hola {{1}} 🌿 Con mucho cariño te
  compartimos que hoy iniciamos el proceso de compostaje de {{2}}. Lo acompañamos con todo el respeto
  y el amor que merece. Gracias por confiar en nosotros. — Camino al Cielo».
- El pie del marco dice «Inicio de su proceso de compostaje · fecha» (editable; vacío = solo fecha).
  David no quiere «regreso a la tierra».

## Arranque
`arranque_desde = 2026-10-16`: los procesos iniciados antes no se preparan (ya se mandaron a mano).
