# Módulo Recibos del Técnico (TecnicoApp → tab "Recibos")

> Creado 2026-06-12. Decisión de producto: separar la recogida del recibo para salir del
> bucle de errores con la carga de comprobantes. La recogida NO depende del recibo y el
> recibo NO depende del estado en memoria de la recogida.

## Flujo separado en dos módulos

### Módulo 1 — Recogida (tab Recogidas, `CardRecogida`)
1. Técnico recibe la solicitud (INGRESADO) → inicia ruta (EN_RECOGIDA).
2. Carga foto de evidencia de la mascota (`recogidas.foto_recogida_url`).
3. Marca checklist (verificación de identidad).
4. Completa la recogida → `servicios.estado = EN_CUARTO_FRIO` + `recogidas.fecha/hora_realizada`.
5. Toast: "Servicio guardado correctamente. Ahora puedes generar el recibo desde el módulo Recibos."

**El recibo ya NO es requisito para completar la recogida** (antes `puedeCompletar`
exigía `reciboGuardado`, un useState que moría con cada reinicio de la PWA — esa era
la causa raíz del bucle).

### Módulo 2 — Recibos (tab Recibos, `ReciboTab`)
- **Fuente de verdad: la DB, nunca el estado temporal de la recogida.**
- Lista servicios del técnico con `estado IN ESTADOS_RECOGIDO`
  (`EN_CUARTO_FRIO, EN_PROCESO, EN_PRODUCCION, LISTO, EN_ENTREGA, ENTREGADO`, límite 60)
  y hace merge client-side con `recibos_tecnico` (query separado — el join inverso falla en silencio).
- Estado derivado por servicio (`estadoReciboDe(recibos)`):

| Estado | Condición |
|---|---|
| `PENDIENTE_RECIBO` | sin filas en `recibos_tecnico` |
| `PENDIENTE_COMPROBANTE` | algún recibo tiene medio digital (`TRANSFERENCIA/NEQUI/DAVIPLATA/TARJETA`) con monto > 0 y sin `comprobanteUrl` |
| `PAGO_PENDIENTE` | `datos_form.pago_pendiente = true` |
| `COMPLETO` | resto |

- **Sin migración de DB**: todo se deriva de `recibos_tecnico.medios_pago` (jsonb) y
  `datos_form` (jsonb). No se agregaron estados a `servicios.estado`.

## Reglas del comprobante (ReciboForm)
1. El comprobante **NO bloquea** guardar el recibo: se guarda igual y queda
   "Comprobante pendiente. Puedes reintentarlo." + novedad `NOTA` visible al coordinador.
2. Al subir comprobante con recibo ya guardado (`reciboId`), la URL se persiste
   **inmediatamente** en `recibos_tecnico.medios_pago` con read-modify-write de la fila
   (regla de [feedback_mobile_image_oom]: nunca dejar una URL solo en useState).
3. Archivos: original sin comprimir ni convertir, MIME real (`validarArchivo`), PDF/JPG/PNG/WEBP/GIF, tope 25 MB.
4. Reinicio de la PWA durante la carga: el archivo queda en stash IndexedDB
   (`recibo_{servicioId}_{idx}`) y la subida se reanuda al reabrir el recibo; el recibo
   sigue existiendo en DB como pendiente. `tecnico_recibo_sel` (localStorage) reabre el
   recibo automáticamente al volver al tab.
5. Reabrir un recibo pendiente: `ReciboTab.seleccionar()` pasa `reciboExistente` a
   `ReciboForm` → restaura `datos_form`/`medios_pago` desde la fila, `guardado=true`,
   `pagoRegistrado=true` (no doble registro de pago).

## Qué NO tocar
- El flujo de recogida (foto, checklist, completar) funciona — protegido.
- Recogida/identidad y entrega siguen comprimiendo imágenes (cámara); comprobante y
  cuarto frío NO comprimen (ver memoria `feedback_mobile_image_oom`).
- localStorage/IndexedDB son solo recovery best-effort, nunca la fuente del recibo.

## Fase 2 (no implementada, preparada)
- Badge contador de pendientes en el tab Recibos.
- Panel del coordinador para revisar comprobantes pendientes (hoy: novedad NOTA por servicio).
- Filtros/búsqueda en la lista de recibos.
