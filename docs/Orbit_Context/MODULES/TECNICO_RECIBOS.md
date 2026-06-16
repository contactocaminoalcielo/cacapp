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

- **Estado derivado** del jsonb por compatibilidad; la fuente de verdad nueva son
  las tablas formales (ver "Modelo formal" abajo). No se agregaron estados a `servicios.estado`.

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

## Modelo formal (2026-06-16) — robustez del flujo recibo → medio → comprobante

> Migraciones: `supabase/migrations/2026-06-16_recibos_tecnico_robustez.sql`
> (tablas) y `2026-06-16_rpc_guardar_recibo_tecnico.sql` (RPC). Aplicar por SSH.

- **Tablas nuevas (fuente de verdad):**
  - `recibo_medios_pago` — un renglón por medio (metodo, monto≥0, referencia, servicio_id).
  - `recibo_comprobantes` — un comprobante por `medio_pago_id` (no por índice). Guarda
    `storage_path` (no publicUrl), `estado` (PENDIENTE/SUBIDO/PENDIENTE_REVISION/APROBADO/
    RECHAZADO/ERROR), `uploaded_by`, `reviewed_by/at`. Único activo por medio.
  - `recibos_tecnico.idempotency_key` (uuid único) — anti-duplicado.
  - `recibos_tecnico.medios_pago` (jsonb) se **mantiene solo por compatibilidad**
    (lo leen ReciboTab y Finanzas); la RPC lo sigue escribiendo.
- **RPC `guardar_recibo_tecnico`** (transaccional, idempotente, SECURITY DEFINER):
  valida servicio≠CANCELADO, montos≥0, no sobrepago (tope = valor del recibo),
  toma el técnico de `recogidas.tecnico_id`, guarda `valor_cobrado = suma real de
  medios`, actualiza `servicios.valor_pagado/estado_pago`, inserta la novedad una
  sola vez. Doble-click/reintento/reinicio con la misma `idempotency_key` → no duplica.
- **Front:** `guardarRecibo` llama la RPC; si la función no está desplegada
  (PGRST202) cae a `guardarReciboLegacy` (mismo comportamiento previo, también con
  el fix de `valor_cobrado`). La clave de idempotencia vive en `localStorage`
  (`recibo_idem_<servicioId>`). `subirComprobante` además registra el comprobante en
  `recibo_comprobantes` por `medio_pago_id` (aditivo y tragado).

## Pendientes (preparados con TODO concreto)
- **Fase 3/7 — privacidad del bucket**: marcar `evidencias` privado y servir
  comprobantes con `createSignedUrl(storage_path)` (hoy se mantiene publicUrl por compat).
- **Fase 5 — panel admin/coordinador**: listar `recibo_comprobantes` PENDIENTE_REVISION,
  aprobar/rechazar (estado + reviewed_by/at), abrir con URL firmada, y detectar en el
  cierre financiero medios digitales sin comprobante APROBADO. TODO en `Finanzas.jsx`.
- **Fase 6 — RLS por-técnico**: `supabase/security/05_recibos_hardening.sql` (policies
  estrictas COMENTADAS). Activar solo tras backfill de `personal.auth_user_id`.
- Badge contador de pendientes en el tab Recibos. Filtros/búsqueda (búsqueda ya existe).
