# Módulo COMPRAS DE RECORDATORIOS

**Ruta:** `/compras-recordatorios` · **Página:** `src/pages/ComprasRecordatorios.jsx`
**Roles:** ADMIN / COORDINADOR (todo) · PRODUCTOR (ve y mueve el estado de las líneas)
**Migración:** `migrations/168_compras_recordatorios.sql` · **Backend:** `orbit-backend/src/compras-recordatorios.js`
**Estado:** en producción desde el 2026-09-22 (migración, backend y frontend verificados)

## Qué es

Registrar la **compra de recordatorios sin servicio funerario**: una familia que quiere la
**Cédula de mascota** de la mascota que tiene en casa, un Memopet más, otra huella. Es el
registro de un servicio recortado: se combina **cliente + mascota** exactamente como en
Registro, pero en vez de crear un servicio se crea la **compra** con sus líneas.

La mascota puede estar **viva**. Si se registra nueva desde aquí nace con `fallecida = false`
(Registro la crea fallecida porque ahí se está registrando el funeral).

## Por qué NO son filas de `servicio_recordatorios`

Toda la operación (Producción, Imágenes, Digitales, Entregas, el trigger del inventario,
Finanzas) cuelga del servicio con `servicios!inner`. Un ítem con `servicio_id` nulo quedaría
invisible en todas esas pantallas **sin que nada fallara**. Por eso la compra tiene tablas
propias y su **propia cola** dentro del módulo: cada línea avanza
`PENDIENTE → EN_PROCESO → LISTO → ENTREGADO` desde el detalle de la compra.

Meterla al tablero de Producción es una decisión aparte, cuando se vea el volumen real.

## Modelo de datos

| Tabla | Para qué |
|---|---|
| `compras_recordatorios` | Cabecera: `numero` (CR-n, secuencia propia), `cliente_id`, `mascota_id`, `total`, `valor_pagado` (**trigger**), `estado_pago` (**generada**: PENDIENTE/PARCIAL/COMPLETO), `notas`, `registrado_por`, `anulada_en/por`, `motivo_anulacion` |
| `compra_recordatorio_items` | Una línea por recordatorio: `nombre` y `precio_unitario` **snapshot** del catálogo, `cantidad`, `subtotal` (generada), `estado`, `datos_cliente` (misma forma que `servicio_recordatorios.datos_cliente`: `{ "<label>": ["texto"] }`), `imagenes_urls` (**rutas** del bucket `evidencias`, no URLs), `asignado_a`, fechas de producción y entrega, `notas` |
| `compra_recordatorio_pagos` | Un pago = una fila; el abono es otra fila. `metodo` ∈ los del cobro en la entrega. `comprobante_path` en `evidencias/compras-recordatorios/<compraId>/comprobantes/…` |
| `compra_recordatorio_eventos` | Bitácora: `CREADA`, `PAGO`, `ESTADO_ITEM`, `DATOS_ITEM`, `ANULADA`, `NOTA`. Todo cambio deja fila |

Estado general de la compra (calculado en SQL y en `estadoCompra()`):
`ANULADA` > `ENTREGADA` (todas las líneas entregadas) > `LISTA` (todas listas o entregadas) >
`EN_PRODUCCION` (alguna avanzó) > `PENDIENTE`.

## Reglas

- **Toda escritura pasa por orbit-backend** (rol `orbit_backend`), en transacción, con rol y
  con evento. `authenticated` solo lee. Sin DELETE para nadie: se **anula** con motivo y los
  pagos se conservan.
- **`valor_pagado` nunca se escribe desde la app**: lo recalcula `trg_compra_rec_pagos` con
  cada pago. `estado_pago` es columna generada: no puede quedar «vieja».
- **El precio lo puede fijar el coordinador al vender** (descuento, combo); si no lo manda,
  es el `precio_base` del catálogo. El **nombre siempre sale del catálogo**, y el ítem tiene
  que existir y estar activo. Un precio en $0 se acepta pero la pantalla avisa.
- **Un pago no puede superar lo pendiente.** Sobrepago aquí es error de dedo, no propina.
- **El `id` de la compra lo genera el navegador** (uuid): el comprobante se sube antes a su
  carpeta y, si la red se cae a mitad, el reintento encuentra la compra y no la duplica.
- **Autorización de datos obligatoria** (Ley 1581/2012): casilla `interno` en el último
  paso; el backend responde 422 `falta_autorizacion` sin ella y la graba en
  `autorizaciones_datos` con `origen = 'COMPRA_RECORDATORIOS'` dentro de la misma
  transacción.
- Cliente nuevo con **cédula repetida ⇒ se reutiliza** el existente (igual que Registro).
- Mascota existente debe ser **del cliente elegido** (el backend lo verifica).

## Endpoints

| Método | Ruta | Rol |
|---|---|---|
| GET | `/compras-recordatorios?q&estado&estado_pago&desde&hasta` | ADMIN, COORDINADOR, PRODUCTOR |
| GET | `/compras-recordatorios/:id` | ídem |
| POST | `/compras-recordatorios` | ADMIN, COORDINADOR |
| POST | `/compras-recordatorios/:id/pagos` | ADMIN, COORDINADOR |
| POST | `/compras-recordatorios/:id/items/:itemId` (`estado`, `asignado_a`, `notas`, `datos_cliente`, `imagenes_urls`) | ADMIN, COORDINADOR, PRODUCTOR |
| POST | `/compras-recordatorios/:id/anular` (`motivo`) | ADMIN, COORDINADOR |

Es POST y no PATCH a propósito: el CORS del backend no anuncia métodos extra y en
desarrollo el preflight de un PATCH se cae mudo.

## Producto nuevo: Cédula de mascota

La migración siembra la fila en `recordatorios` si no existe: `categoria = 'fisico'`,
`requiere_imagen = true`, `max_fotos = 1`, campos de texto «Fecha de nacimiento» y «Color y
señas particulares», 3 días de producción. **Precio $0 a propósito**: David lo fija en
Configuración › Recordatorios. Lo demás que imprime la cédula (nombre, especie, raza, sexo,
edad) ya vive en `mascotas`.

## Dónde más aparece la compra (2026-09-22, migración 170)

- **Producción** (`src/components/produccion/ComprasEnProduccion.jsx`): sección propia
  «Compras de recordatorios · sin servicio» arriba de las tarjetas de la vista *Por servicio*,
  con sus propias carga, realtime y modal (estado, asignado, notas), que escribe **por el
  backend**. NO se mezcla con el array de `servicio_recordatorios`: `autoCorregirEstados`
  agrupa por `servicio_id` y haría UPDATE a `servicios` con una clave nula. Solo se pinta si
  hay algo; con el filtro por recordatorio o «solo anticipados» se oculta. Cada tarjeta enlaza
  a `/compras-recordatorios?ver=<id>`.
- **Badge del menú**: `orbit_contadores` (migr. 170) suma las líneas PENDIENTE de compras no
  anuladas; el fallback JS de `lecturasOperativas.js` también. Las dos tablas entran a
  `supabase_realtime`.
- **Finanzas › Compras recordatorios** (`src/components/finanzas/ComprasCartera.jsx`): pestaña
  aparte con saldo, «solo con saldo» y registro de pago (backend). No toca `guardarPago()` de
  servicios ni la cartera: estas compras tienen su propio libro y no hay descuadre posible.
- **Cédula en PDF** (`orbit-backend/src/pdf-plantillas/cedula-mascota.js`, ruta
  `POST /pdf/cedula-mascota`, roles ADMIN/COORDINADOR/PRODUCTOR): hoja A4 con anverso y reverso
  de la tarjeta a tamaño real (85,6 × 54 mm) con marcas de corte, más ficha de registro. Los
  datos salen de la base por `compra_id` + `item_id`; el navegador solo manda la **URL firmada**
  de la foto (el bucket es privado y el backend no tiene llave de storage), y el backend solo
  acepta URLs de nuestro storage. Botón «Cédula PDF» en la línea cuyo nombre contiene «cédula».
  Número estable `CM-<compra>-<6 hex de la mascota>`.

## Pruebas

`node --test tests/compras-recordatorios.test.mjs` — reglas puras en
`orbit-backend/src/compras-recordatorios-reglas.js` (normalizar líneas, validar pago, estado
de la compra). La cédula se prueba en local con `PDF_CHROMIUM_PATH` y `htmlCedulaMascota()`
con datos de mentira (no necesita base).

## Pendientes / decisiones abiertas

- **Entregas del mensajero**: NO integradas. `entregas` es «una fila por servicio» de punta a
  punta (trigger, `SELECT_ENTREGA` del técnico, `completarEntrega`, y el **INNER JOIN de
  `generar_cuadre_tecnico`**, que haría desaparecer del cuadre el efectivo de una compra).
  Integrarla exige migración (columna `compra_id` + XOR), reescribir la RPC del cuadre
  (~600 líneas, copiar de la 166) y bifurcar ocho puntos de `TecnicoApp`. Decisión de David
  pendiente. Hoy la entrega se marca desde la compra (línea → ENTREGADO).

## Catálogo público — `/#/catalogo` (2026-10-22, migración 200)

Enlace único para clientes **sin servicio funerario**: ven el catálogo, escogen, suben las
fotos y textos que pide **cada** producto, dejan sus datos y la entrega, y la compra cae aquí
con `origen = 'CATALOGO_WEB'` y en el Tablero de Producción como «Compra de recordatorio –
Cliente sin servicio funerario».

- **Qué se vende**: `recordatorios.venta_publica` + `precio_publico` (vacío = `precio_base`).
  Se marcan en Configuración › Recordatorios, donde está también el panel del catálogo
  (enlace, «Recibe pedidos», valor del envío, datos de pago → `config_operativa` `CATALOGO_PUBLICO`).
- **Precio**: lo calcula el backend (`orbit-backend/src/catalogo-publico.js`); el navegador no lo fija.
- **Envío**: un valor fijo, solo si el pedido trae algo `fisico`. Va en `valor_envio` y dentro de `total`.
- **Fotos sin sesión**: `POST /portal/catalogo/borrador` abre `fotos-clientes/compra-web/<id>/`
  por 3 horas (función `portal_compra_web_abierta`, tope 120 archivos). La compra se crea con
  `id = borrador`: un reintento no duplica. Las fotos se guardan como **URL pública completa**
  (las de una compra interna son rutas de `evidencias`); `urlFirmada` devuelve tal cual las URL.
- **Pago**: el cliente sube comprobante o escoge «pagar después». Eso va a `pago_cliente`
  (jsonb), **no** a `compra_recordatorio_pagos`, porque el trigger suma todo lo que haya ahí.
  En el detalle, «Verificado: registrar este pago» crea el pago con su comprobante y marca
  `pago_cliente.revisado_en`.
- **Cliente**: se reutiliza solo si es claramente la misma persona (misma cédula Y WhatsApp,
  o sin cédula un único cliente con ese WhatsApp); si la cédula ya existe con otro WhatsApp,
  se crea ficha nueva sin cédula y la cédula declarada queda en notas.
- Autorización de datos con `origen = 'CATALOGO_RECORDATORIOS'`, `medio = 'PORTAL_WEB'`.
- Pruebas: `normalizarItemsPublicos`, `precioPublico`, `fotosQuePide` en
  `tests/compras-recordatorios.test.mjs`.
