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

Prueba aislada: `node scripts/probar-cierre-ecogrupal.mjs` genera SQL para psql
con ON_ERROR_STOP=1, tablas temporales y ROLLBACK (carga la 160 y encima la
169). Comprueba ambos órdenes, envíos incompletos/fallidos, pendientes,
adicionales, NA, REMOVIDO, cancelados, otros planes, finalización del último
ítem, reenvíos, los tres planes de solo comprobante (que cierran sin pieza
digital y no cierran sin el envío), el ítem ignorado y la config mal formada.
Sin la 169 la prueba falla («Cierre incorrecto: 3 entregados»).

**Ítems que no bloquean (migración 169, 2026-09-22).** «Día de amor y milagrino»
se queda en PENDIENTE a propósito (la plantilla de digitales no lo entrega,
decisión del 2026-07-16), y como la regla exigía todos los ítems ENTREGADOS,
ningún ECO_GRUPAL cerraba solo: se quedaban 5/6 para siempre. David decidió el
2026-09-22 que por el momento ese ítem se ignora en el cierre. La lista vive en
`config_operativa` (`CIERRE_SIN_RUTA` / `items_no_bloqueantes`, arreglo de ids
de `recordatorios`); la función la lee en cada evaluación y excluye esos ítems
tanto del «todos entregados» como del «al menos un ítem aplicable» (un servicio
cuyo único ítem sea uno ignorado no cierra). El ítem no cambia de estado en el
tablero: sigue PENDIENTE. Un valor mal formado en la config se trata como lista
vacía, es decir, vuelve la regla estricta. Cuando se defina cómo se cumple ese
ítem, basta con sacarlo de la lista; no hay que desplegar. La 169 recorre una
vez los servicios abiertos de los cuatro planes y anota en un NOTICE cuántos
cerró.

Para desactivar futuros cierres, retirar los tres triggers trg_cierre_sin_ruta_*
de digitales_envios, reportes_grupales_envios y servicio_recordatorios. Eso no
revierte entregas ya cerradas ni sus seguimientos; revisarlos por servicio.
