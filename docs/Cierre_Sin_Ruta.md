# Cierre automático sin ruta física

La migración 148 cerró como ENTREGADO el ECO_GRUPAL. La 160 extiende la misma
regla a los planes que solo entregan el comprobante — DESAMPARADO, ANGEL y
BASICO_SIN_REC — y renombra la función y los triggers, que ya no son solo del
grupal: `fn_cerrar_servicio_sin_ruta`, `fn_evento_cierre_sin_ruta` y
`trg_cierre_sin_ruta_{digitales,comprobante,items}`.

Un servicio de esos cuatro planes se cierra únicamente si:

- Existe un registro ENVIADO en reportes_grupales_envios (certificado o reporte).
- Existe un registro ENVIADO en digitales_envios. **Solo se le exige al
  ECO_GRUPAL**: los otros tres no llevan pieza digital. ANGEL y DESAMPARADO
  están en `planes_excluidos` de la configuración DIGITALES y el BASICO_SIN_REC
  no incluye memorial. Exigírsela los dejaría abiertos para siempre.
- Existe al menos un ítem aplicable y todos están ENTREGADOS. NA y REMOVIDO
  no bloquean; LISTO no equivale a entregado. Los adicionales sí cuentan.
  En los tres planes nuevos el único ítem del plan es «Reporte cremación», que
  `grupales.js` marca ENTREGADO al enviar el reporte.
- No está cancelado ni entregado y no tiene una ruta física pendiente asignada
  o en un estado que requiera intervención (por ejemplo, FALLIDA).

Se comprueba cuando se registra/cambia un envío o se modifican estados/origen
de los ítems. Funciona en ambos órdenes de envío y al completar el último ítem.
El cierre de entregas PENDIENTE/DISPONIBLE sin mensajero queda anotado como
cierre digital, sin inventar firma, fotografía o recorrido físico. Se conserva
una fecha de entrega existente; en caso contrario se registra el día de cierre
en Bogotá. Los triggers habituales de estado y seguimiento siguen funcionando.

Los triggers solo actúan por evento, así que la 160 recorre una vez los
servicios abiertos de los tres planes nuevos y deja que la función decida. Al
aplicarla (2026-09-16) cerró 6 DESAMPARADO que ya cumplían la regla; los 5
restantes siguen abiertos porque están EN_CUARTO_FRIO y sin reporte enviado.
El ECO_GRUPAL no se recorrió: su regla no cambió.

Las funciones no son RPC accesibles a anon/authenticated. Los triggers utilizan
SECURITY DEFINER y search_path fijo para consultar registros de envío privados.
Se bloquea la fila del servicio para serializar cierres y las de entregas para
no competir con la toma de una ruta. No se revierten cierres al reenviar.

Prueba aislada: `node scripts/probar-cierre-sin-ruta.mjs` genera SQL para psql
con ON_ERROR_STOP=1, tablas temporales y ROLLBACK. Comprueba ambos órdenes,
envíos incompletos/fallidos, pendientes, adicionales, NA, REMOVIDO, cancelados,
otros planes, finalización del último ítem, reenvíos y los tres planes de solo
comprobante (que cierran sin pieza digital y no cierran sin el envío).

No se considera automáticamente cumplido «Día de amor y milagrino». Es un ítem
aplicable y sigue bloqueando mientras esté pendiente; cambiar esa regla requiere
definir si se cumple con el envío digital o con una acción diferente.

Para desactivar futuros cierres, retirar los tres triggers trg_cierre_sin_ruta_*
de digitales_envios, reportes_grupales_envios y servicio_recordatorios. Eso no
revierte entregas ya cerradas ni sus seguimientos; revisarlos por servicio.
