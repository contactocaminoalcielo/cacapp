# Módulo OFERTAS

**Ruta:** `/ofertas` · **Página:** `src/pages/Ofertas.jsx` · **Roles:** ADMIN / COORDINADOR
**Migración:** `migrations/078_ofertas_portal.sql` · **Estado:** implementado, pendiente de desplegar

## Qué es

Un inventario de **anuncios** que se le muestran al cliente en el portal público donde
carga las fotos de su mascota (`/#/fotos/CODIGO`). Cada oferta ata un **recordatorio del
catálogo** a un **precio especial** y a los **planes** en los que debe aparecer.

El cliente decide en el momento:

- **Acepta** → se le habilita ahí mismo la carga de la(s) foto(s) y textos de ese
  recordatorio, y al enviar el formulario se agrega a su servicio como **adicional** al
  precio de oferta, sumándose al total a cobrar.
- **Rechaza** → no pasa nada. Queda el registro para medir conversión.

## Regla de oro

> **El precio nunca viene del navegador.**

El portal solo envía `{ oferta_id, acepta, urls, textos }`. El monto, el recordatorio y la
elegibilidad se resuelven server-side contra la tabla `ofertas`, dentro de la misma
transacción que recibe las imágenes (`orbit-backend/src/imagenes.js`).

## Modelo de datos

| Tabla | Para qué |
|---|---|
| `ofertas` | El anuncio: `titulo`, `descripcion`, `imagen_url`, `recordatorio_id`, `precio_oferta`, `precio_lista` (tachado, display), `orden` (menor = mayor prioridad), `aplica_todos_planes`, `vigencia_desde/hasta`, `activo` |
| `oferta_planes` | En qué planes se muestra (`oferta_id` × `plan_id`) |
| `oferta_respuestas` | Qué respondió cada cliente. `UNIQUE (servicio_id, oferta_id)` = candado anti doble cobro. Guarda `precio_ofrecido` (snapshot) y el `servicio_recordatorio_id` creado si aceptó |

Bucket de Storage **`ofertas`** (público, 5 MB, jpeg/png/webp) para la foto del anuncio: el
portal es anónimo y debe poder leerla. Las tablas NO se exponen a `anon` — las lee el
backend propio con conexión directa a Postgres.

## Qué ofertas ve un servicio

`ofertasParaServicio()` en `orbit-backend/src/ofertas.js` devuelve **hasta
`MAX_OFERTAS_PORTAL` = 2** (decisión de producto: pocos anuncios, en un momento sensible).
El tope es server-side: el navegador no decide cuántos ve ni cuáles. Filtros, todos
obligatorios:

1. Oferta y recordatorio **activos** y dentro de vigencia (`fn_hoy_bogota()`).
2. El plan del servicio está en `oferta_planes`, o `aplica_todos_planes`.
3. El cliente **no respondió antes** esa oferta.

**Sí se ofrece un recordatorio que el servicio ya lleva.** La oferta es "un recuerdo más" y
vender un segundo igual es válido; no hay UNIQUE sobre (servicio, recordatorio) y en la
operación ya hay servicios con dos Tarjetas de oración o dos Cristales con foto. Lo que no
conviene duplicar (un memorial digital, un reporte) se controla **al elegir el recordatorio
de la oferta**, no con un filtro automático. Cuando el ítem ya está en el plan, el portal se
lo aclara al cliente ("sería un X adicional, además del que ya viene en tu plan").

Orden: `orden ASC, created_at ASC`.

## Qué pasa al aceptar (`aplicarOfertaAceptada`)

Todo dentro de la transacción de `recibirImagenesPortal`:

1. `INSERT servicio_recordatorios` — `origen='ADICIONAL'`, `estado='EN_PROCESO'`,
   `precio_cobrado = precio_oferta`, con sus imágenes/textos.
2. `UPDATE servicios` — `valor_total += precio`; `valor_adicionales += precio` **solo si no
   es NULL** (NULL = "este servicio no lleva desglose"; ponerle el monto suelto mentiría);
   y **recalcula `estado_pago` siempre** (`COMPLETO`/`PARCIAL`/`PENDIENTE`). Recalcular no
   es opcional: un servicio COMPLETO al que se le agrega un adicional debe bajar a PARCIAL
   o el saldo desaparece de la cartera de Finanzas. `saldo_pendiente` NO se toca (derivado,
   vista `v_kanban`).
3. `novedades_servicio` (`NOTA`, `valor_ajuste`) → visible en la ficha del Kanban.
4. `alertas_operativas` (`OFERTA_ACEPTADA`, prioridad ALTA) → "confirmar el cobro en la entrega".
5. `oferta_respuestas` con el snapshot del precio.

Es el mismo tratamiento que "agregar adicional sin pagar" del Kanban: el cobro se hace en
la entrega.

### Aislamiento: una oferta no puede tumbar el envío

Cada respuesta a una oferta corre en su **propio SAVEPOINT** (helper `aislado` en
`imagenes.js`). El envío del cliente —fotos, textos, datos de entrega, avance de estado— es
todo-o-nada, pero la oferta es accesoria: si su aplicación revienta, se deshace solo ese
pedazo y el envío se guarda igual.

Cuando falla una oferta **aceptada** queda una alerta **ALTA** `OFERTA_ACEPTADA` con
`clave_dedupe = 'oferta-fallida:<oferta>:<servicio>'` y, en `metadata`, las URLs de las
fotos que el cliente sí subió, para montar el adicional a mano desde Kanban. Una venta
aceptada nunca se pierde en silencio.

**Por qué:** hasta el 3-ago-2026 un `INSERT` con `datos_cliente = NULL` (columna
`NOT NULL DEFAULT '{}'`; un NULL explícito **no** cae al default) hacía ROLLBACK del envío
completo para todo cliente que aceptara una oferta cuyo recordatorio no pide textos
(Memopet, Huella 3D). 6 clientes bloqueados y 42 fallos en 3 días, resubiendo sus fotos en
cada reintento. Al añadir efectos secundarios nuevos aquí, envolverlos en `aislado`.

### Efecto lateral: entrega física

Aceptar una oferta **no digital** convierte en entregable un servicio que no lo era (p. ej.
eco-grupal, donde todo es digital y no se devuelven cenizas). En ese caso el portal pasa a
exigir los datos de entrega, y el backend aplica la misma regla al recibir.

## El portal (`src/pages/FotosCliente.jsx`)

Cada anuncio es **un paso propio del wizard**, uno tras otro entre los recordatorios del
plan y la revisión final (con "Propuesta 1 de 2" cuando hay más de uno). Si el cliente
acepta, se abre debajo la misma captura de fotos/textos que los demás ítems (componente
compartido `CapturaRecordatorio`). No se puede avanzar sin responder, ni sin completar lo
que el recordatorio aceptado pide. El cliente puede aceptar una, las dos o ninguna: las
respuestas van indexadas por id de oferta (`ofertaResp`, `ofertaFotos`, `ofertaTextos`).

Las fotos del ítem aceptado se suben a `servicioId/oferta-<ofertaId>/uuid.ext` — el segundo
segmento es un marcador porque el `servicio_recordatorios` todavía no existe (lo crea el
backend al recibir). La policy `anon_insert_fotos_clientes` solo valida el primer segmento,
así que no requiere cambios.

### Confirmaciones antes de enviar

Al pulsar "Enviar" aparece una secuencia de confirmaciones, una a la vez:

1. **¿Subiste todas las fotos?** — con el resumen ítem por ítem.
2. **¿Los datos de entrega están correctos?** — solo si hay entrega física; permite volver a corregirlos.
3. **¿Confirmas que NO deseas la oferta?** — **una pregunta por cada oferta rechazada**; con
   botón "Mejor sí la quiero" que devuelve al paso de ESE anuncio.

### Compatibilidad con PWA en caché

El portal vive en una PWA que puede estar cacheada en el teléfono del cliente, así que las
dos formas conviven en ambos sentidos: `datosPortal` devuelve `ofertas` (array) **y**
`oferta` (la primera) para que una app vieja siga mostrando una; y `recibirImagenesPortal`
acepta `payload.ofertas` (array) o `payload.oferta` (objeto suelto). El portal nuevo manda
las dos claves, de modo que el orden de despliegue backend/frontend no importa.

## Vistas del anuncio (migración 081)

`oferta_vistas` — una fila por **(servicio, oferta)**, escrita por `registrarVistasOfertas()`
desde `datosPortal` cada vez que el portal devuelve el anuncio:

- **filas** = a cuántos servicios distintos les llegó → es la base de la conversión.
- **`vistas`** = aperturas del portal (el cliente puede recargar) → dato secundario, va en el
  tooltip.

Es **best-effort** (`try/catch` que se traga el error): medir no puede romperle el portal a un
cliente que está subiendo las fotos de su mascota. La migración siembra la tabla con las
respuestas ya existentes —quien respondió, vio— para que el tablero no arranque en el
imposible "0 vistas, 5 respuestas".

⚠️ La vista se cuenta **al abrir el link**, no al llegar al paso del anuncio: quien abandona
antes también suma. Es lo que se quiso medir ("cuántos abrieron el link"), pero conviene
recordarlo al leer la conversión.

## Dónde se ve el resultado

- **Módulo Ofertas**: ojito con las vistas, aceptadas / rechazadas / conversión **sobre los que
  vieron** por oferta, y el detalle de quién respondió.
- **Kanban**: el adicional en la lista de recordatorios + la novedad en la ficha.
- **Finanzas**: el servicio aparece con saldo pendiente por el nuevo total.
- **Producción**: el ítem entra a la cola con sus fotos.

## Despliegue

1. Migración 078 por SSH → `psql` en Contabo (crea tablas, GRANTs, RLS y el bucket).
2. Backend por `scp` + `docker compose up -d --build` (**no** va por Actions).
3. Frontend por `git push` → GitHub Actions.
