# Entrega de básicos desde el recibo

Al guardar un recibo con `datos_form.entrega_rec_basicos = true`, los ítems
existentes del servicio de estos cinco tipos pasan a `ENTREGADO`:

- Huella y mechon.
- Capsula de recuerdos.
- Evidencias de conservación.
- Soporte lazos de amor.
- Huella corazón.

La confirmación «Entrega de recordatorios básicos» es suficiente. Las casillas
«Se toma huella» y «Se toma mechón» registran toma de muestras y no disparan por
sí solas la entrega. La escritura sucede al guardar el recibo, no al tocar una
casilla sin guardar.

La migración 147 instala un trigger transaccional, con permisos del invocador,
en recibos_tecnico. Abarca la RPC y el guardado de compatibilidad. Solo afecta
ítems PLAN/VIP en PENDIENTE, EN_PROCESO o LISTO; excluye adicionales, REMOVIDO,
NA, los ya entregados y servicios cancelados. No crea ítems ni cambia recibos
históricos. Desmarcar la casilla no revierte una entrega. Editar otros campos
de un recibo ya confirmado no repite la operación.

## Digitales

El flujo actual ya marca ENTREGADOS el audio de despedida y la tarjeta de
oración cuando el envío automático se registra exitoso y la plantilla los
incluye en `cubre`. Se verificaron `plantilla_memorial` y `plantilla_completos`:
ambas contienen sus identificadores. La generación/publicación del memorial
sin enviarlo no confirma una entrega. El envío manual conserva su regla actual:
marca las piezas registradas; no supone que se enviaron enlaces fijos ausentes.

## Validación

`node scripts/probar-entrega-basicos.mjs` genera SQL para ejecutar con psql y
ON_ERROR_STOP=1. Todas las tablas de prueba son temporales y termina en ROLLBACK.
Comprueba entrega explícita, inserción y actualización de recibo, los cinco
tipos, VIP, exclusiones, aislamiento por servicio e idempotencia, con rol
authenticated. No genera mensajes ni recibos de clientes.

Para detener la automatización sin modificar registros, retirar el trigger:

```sql
DROP TRIGGER IF EXISTS trg_recibo_entrega_basicos ON public.recibos_tecnico;
```

Esto no deshace entregas ya confirmadas; una corrección de esas entregas debe
revisarse por servicio.
