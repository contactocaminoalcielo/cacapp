# Cierre del ecogrupal

La migración 148 cierra un servicio ECO_GRUPAL como ENTREGADO únicamente si:

- Existe un registro ENVIADO en digitales_envios.
- Existe un registro ENVIADO en reportes_grupales_envios.
- Existe al menos un ítem aplicable y todos están ENTREGADOS. NA y REMOVIDO
  no bloquean; LISTO no equivale a entregado. Los adicionales sí cuentan.
- No está cancelado ni entregado y no tiene una ruta física pendiente asignada
  o en un estado que requiera intervención (por ejemplo, FALLIDA).

Se comprueba cuando se registra/cambia un envío o se modifican estados/origen
de los ítems. Funciona en ambos órdenes de envío y al completar el último ítem.
El cierre de entregas PENDIENTE/DISPONIBLE sin mensajero queda anotado como
cierre digital, sin inventar firma, fotografía o recorrido físico. Se conserva
una fecha de entrega existente; en caso contrario se registra el día de cierre
en Bogotá. Los triggers habituales de estado y seguimiento siguen funcionando.

Las funciones no son RPC accesibles a anon/authenticated. Los triggers utilizan
SECURITY DEFINER y search_path fijo para consultar registros de envío privados.
Se bloquea la fila del servicio para serializar cierres y las de entregas para
no competir con la toma de una ruta. No se revierten cierres al reenviar.

Prueba aislada: `node scripts/probar-cierre-ecogrupal.mjs` genera SQL para psql
con ON_ERROR_STOP=1, tablas temporales y ROLLBACK. Comprueba ambos órdenes,
envíos incompletos/fallidos, pendientes, adicionales, NA, REMOVIDO, cancelados,
otros planes, finalización del último ítem y reenvíos.

No se considera automáticamente cumplido «Día de amor y milagrino». Es un ítem
aplicable y sigue bloqueando mientras esté pendiente; cambiar esa regla requiere
definir si se cumple con el envío digital o con una acción diferente.

Para desactivar futuros cierres, retirar los tres triggers trg_ecogrupal_* de
digitales_envios, reportes_grupales_envios y servicio_recordatorios. Eso no
revierte entregas ya cerradas ni sus seguimientos; revisarlos por servicio.
