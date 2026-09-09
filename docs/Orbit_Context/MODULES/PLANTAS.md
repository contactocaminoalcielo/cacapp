# Módulo PLANTAS — elección de planta al cumplirse el compostaje

**Portal público:** `/#/planta/CODIGO` · **Página:** `src/pages/PlantaCliente.jsx`
**Administración:** Configuración → Plantas · `src/components/configuracion/TabPlantas.jsx`
**Migraciones:** `149_plantas_eleccion_cliente.sql`, `150_plantas_bucket_fotos.sql`
**Estado:** en producción y encendido desde el 2026-09-09

## Qué es

Cuando una mascota termina su proceso de compostaje individual, se le avisa a la familia por
WhatsApp y se le manda un enlace donde **elige la especie de planta** en la que quedará su
mascota (hoy Helecho y Pescadito) y, si quiere, **compra extras** que se suman al servicio.

## Cuándo se dispara

`lotes_tenjo_items.fecha_compostaje_inicio` (el día que la mascota **entró al cubículo**)
**+ `meses_compostaje`** — los 2, 2.5 o 3 meses que fijó el operario para ese cubículo.

> ⚠️ **No son "2 meses" fijos.** Es la misma regla que usa la pestaña Control de Tenjo para
> decir "compostaje listo" (`calcularListoProceso` en `src/lib/tenjo.js`). Con 2 fijos, a los
> cubículos de 2.5 y 3 meses se les avisaría antes de tiempo.

Postgres y el JS coinciden en el medio mes: `2.5 * INTERVAL '1 month'` sobre el 15-jul da el
30-sep, igual que `sumarMeses`. Verificado en producción.

## Regla de oro

> **El precio nunca viene del navegador.**

Heredada de [OFERTAS](OFERTAS.md). El portal solo manda
`{ planta_id, adicionales:[{planta_id, cantidad}] }`; el monto, la vigencia y la elegibilidad
se resuelven contra `plantas` dentro de la misma transacción que suma al servicio
(`orbit-backend/src/plantas.js`).

Al cobrar un extra se hace lo mismo que en Ofertas: se suma a `valor_total`, se toca
`valor_adicionales` **solo si no es NULL**, y **`estado_pago` se recalcula siempre** — un
servicio COMPLETO al que se le agrega un extra debe bajar a PARCIAL, o el saldo desaparece de
la cartera de Finanzas. Queda novedad con traza de valor y alerta operativa para el cobro.

## Modelo de datos

| Tabla | Para qué |
|---|---|
| `plantas` | Catálogo. `elegible` = aparece entre las opciones a escoger; `adicional` = se vende con su precio. Una planta puede ser las dos cosas. |
| `planta_elecciones` | Una fila por servicio: el aviso, su envío y lo que respondió la familia. `UNIQUE(servicio_id)` es el candado anti-duplicado del job. |
| `planta_adicionales` | Lo que compró. `UNIQUE(eleccion_id, planta_id)` es el candado anti doble cobro. |
| `v_plantas_pendientes` | Vista de trabajo del tablero (`security_invoker`). |

La especie es **catálogo, no código**: cambia con el tiempo y se edita en Configuración.

## El aviso

Sale por la línea de familias (+57 315 989 1247) con la plantilla `eleccion_planta_cliente`
(APPROVED, UTILITY, es_MX), dos variables: `{{1}}` mascota, `{{2}}` enlace.
Job diario `POST /jobs/eleccion-planta` a las **07:15** (hora Bogotá).

> **Sin plantilla sembrada el job NO envía**: deja los avisos en `PENDIENTE`, lo registra y
> avisa a coordinación una sola vez. Nunca marca ENVIADO algo que no salió.

El enlace reusa **`servicios.codigo_fotos`**, el mismo secreto del portal de fotos, y vive
`dias_ventana_portal` días (120 por defecto).

## Qué se puede cambiar y qué no

- **La especie se elige una sola vez.** Cambiarla después de preparada sería una promesa que
  la planta no puede cumplir; el portal invita a escribirnos.
- **Los extras sí se pueden seguir agregando** mientras el enlace viva. Cada compra nueva
  genera su propia alerta (la clave de dedupe lleva las plantas compradas), o el dinero nuevo
  quedaría escondido bajo la alerta ya abierta.

## Fotos del catálogo

Se suben desde Configuración → Plantas (botón "Subir foto") al bucket público `plantas`
(migración 150), recomprimidas a 1200 px y validadas por los BYTES, no por la extensión.
Es **opcional**: sin foto el portal dibuja la planta con su ilustración.

## Diseño del portal

Papel cálido y Playfair itálica, a propósito distinto del azul de Orbit — lo abre una familia
en duelo. **Sin iconos de librería**: cada especie tiene su ilustración SVG, en
`src/components/portal/Botanica.jsx`, compartido con el portal de fotos.

## Configuración (`config_operativa`, módulo `PLANTAS`)

`activo`, `plantilla`, `max_envios_por_corrida`, `arranque_desde`, `max_adicionales`,
`dias_ventana_portal`.
