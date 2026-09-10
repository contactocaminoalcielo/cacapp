# Módulo Entregas

## Propósito
Llevar la entrega final al cliente (cenizas, recordatorios, plantas, certificados) y —desde el
2026-09-10— **el dinero que se cobra en la puerta**.

## Estados reales (`entregas.estado`, constraint de la migración 083)
`PENDIENTE → DISPONIBLE → ASIGNADA → EN_CAMINO → ENTREGADA | FALLIDA | REPROGRAMADA`

⚠️ **`PENDIENTE` NO significa "lista para entregar".** El trigger `fn_post_crear_servicio`
inserta una fila cascarón apenas nace el servicio, igual que hace con `recogidas` y
`cuarto_frio`. Una entrega solo entra al circuito cuando alguien la **publica** desde Producción.

## Cómo llega al mensajero
Dos caminos, ambos vigentes:
- **Pool**: el coordinador la publica (`DISPONIBLE`) y quien pueda la toma. Tomar es un UPDATE
  condicional, así que si dos la tocan a la vez la segunda ve "otro compañero la tomó primero".
- **Asignación directa** a una persona, que además notifica.

## Cobro en la puerta (migraciones 151 y 152)
Si el servicio tiene saldo, en la fase `EN_CAMINO` el mensajero resuelve el dinero antes de
poder completar: **`Recibí el dinero`** (medio de pago + comprobante, obligatorio si no es
efectivo) o **`No me pagaron`** (motivo obligatorio, y la entrega se cierra igual).

Al guardar se escribe:
- `servicios.valor_pagado` / `estado_pago` / `metodo_pago` → la cartera de Finanzas se limpia sola
- novedad `PAGO_RECIBIDO` + fila en `recibo_comprobantes` (`PENDIENTE_REVISION`: lo subió campo)
- `entregas.cobro_*` → de ahí sale la fila de su cuadre

**El saldo se relee de la DB al confirmar**, nunca del dato que la app cargó. Si ya está en cero
no se vuelve a sumar, pero el monto **sí se le anota al mensajero**: tiene el efectivo en la mano.

**Se escribe primero `servicios` (estado + plata en un solo update) y después `entregas`**: si se
cae la señal entre las dos, lo que no se pierde es el dinero.

## El dinero en el cuadre
El cobro entra al cuadre del mensajero como **fila propia** (`cuadre_items.es_entrega`), fechada
por el día del cobro y no por el ingreso del servicio — ver `MODULES/TECNICO_RECIBOS.md` y la
cabecera de `migrations/152_cuadre_cobro_en_entrega.sql`.

Su cuadre responde **una sola pregunta**: cuánto efectivo debe entregar y cuánto se fue a la
cuenta de la empresa. **Al mensajero se le paga por HORAS, por fuera de Orbit** (David,
2026-09-10), así que esas filas no llevan transporte, recargos ni pago al técnico, y los lápices
que los editan están cerrados: como `dinero_a_entregar = efectivo − reconocido`, cualquier valor
ahí le bajaría en silencio el efectivo que se le pide.

## Quién entrega hoy
**JUAN SEBASTIAN HERNANDEZ PINEDA**, rol MENSAJERO, con usuario y moto: 59 de las 71 entregas
hechas son suyas. Ve **Entregas + Mis pagos** (necesita el segundo para firmar su cuadre: sin su
confirmación gerencia no puede cerrarlo).

## Evidencia que queda
Foto de la entrega, firma del cliente o su nombre, y —si hubo cobro— el comprobante. El
certificado de entrega se genera en PDF desde la misma tarjeta.
