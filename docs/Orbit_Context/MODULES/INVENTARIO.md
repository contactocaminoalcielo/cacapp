# Módulo Inventario — diseño

Estado: **fase 1 en producción** desde el 2026-08-26 (migración y backend aplicados y verificados;
el frontend queda pendiente de `git push`). Fases 2-5 en diseño.

⚠️ **La migración 121 la tomó el agente de Familias** (`121_agente_familias_configuracion.sql`,
de una sesión paralela). La fase 2 del inventario es la **122**, y de ahí en adelante todo corre
un número. Antes de escribir una migración nueva, mirar `ls migrations/` — el repo se trabaja
desde más de una sesión a la vez.

| Pieza | Archivo |
|---|---|
| Migración | `migrations/120_inventario_base.sql` |
| Backend | `orbit-backend/src/inventario.js` + rutas en `index.js` |
| Cliente | `src/lib/inventarioApi.js` |
| Pantalla | `src/pages/Inventario.jsx` (`/inventario`) |
| Cableado | `App.jsx`, `lib/roles.js`, `Sidebar.jsx`, `Topbar.jsx` |

### Estado del despliegue
1. ✅ **Migración 120** aplicada y verificada en el VPS el 2026-08-26. Producción venía en la 119
   (la nota de estado decía 110, estaba desactualizada). Se corrió `NOTIFY pgrst` + reinicio de
   `supabase-rest` para que PostgREST vea las tablas nuevas.
2. ✅ **Backend** desplegado por `scp` + `docker compose up -d --build`. `/health` OK y
   `/inventario/stock` responde 401 sin token — la ruta existe.
3. ⏳ **Frontend** — falta `git push` (Actions, ~3 min).

El orden importa: al revés, la pantalla aparece antes que sus tablas. Está previsto
—`/inventario/stock` devuelve un 503 que dice «falta aplicar la migración 120» en vez de un 500
mudo— pero deja un módulo roto en el menú durante la ventana.

### Verificado contra producción el 2026-08-26
| Prueba | Resultado |
|---|---|
| Promedio ponderado tras dos compras (1500 y 2500) | 2000 ✓ |
| Salida sin costo → se costea al promedio vigente | 2000, congelado en el movimiento ✓ |
| `v_inventario_stock`: saldo 17, valor $34.000 | ✓ |
| `UPDATE` de una cantidad del kardex | rechazado por `fn_inventario_movimiento_inmutable` ✓ |
| `DELETE` de un movimiento | rechazado ✓ |
| `ENTRADA` con cantidad negativa | rechazada por `inv_mov_signo_coherente` ✓ |
| Estado final tras el ROLLBACK | 0 insumos, 0 movimientos ✓ |

### Decisiones tomadas con David — 2026-08-26
| Decisión | Efecto |
|---|---|
| **Una sola bodega**, todo junto | El saldo vive en columnas de `inventario_insumos`. `inventario_movimientos.ubicacion` existe igual (default `'BOGOTA'`): si mañana Tenjo se cuenta aparte, el kardex ya trae el dato y solo hay que mover el saldo a una tabla por `(insumo, ubicacion)` — sin reconstruir nada |
| **Entre 20 y 60 insumos** | La pantalla de la fase 1 lleva **importación por CSV** con saldos iniciales |
| **Solo recordatorios primero** | Tenjo (`por_kg`), recogida y entrega quedan para la fase 5. El gas de cremación exige medir consumo real por kilo, dato que hoy no existe en Orbit |

---

## 1. Qué problema resuelve — y cuál NO

Hoy Orbit sabe **qué se vendió** (`servicios`, `servicio_recordatorios`, `planes`) y **qué se
cobró** (`recibos_tecnico`, `cuadres_tecnico`). No sabe **qué costó**. El margen de un servicio
es hoy una suposición.

El módulo tiene tres trabajos, en este orden de valor:

1. **Saber qué hay y qué falta** — evitar que se pare una producción porque se acabó la arcilla.
2. **Saber qué cuesta cada pieza** — costo real de un Altar de vida, de una Huella corazón, del
   plan Premium completo. Y con eso, el margen por servicio.
3. **Comprar a tiempo y con orden** — órdenes de compra con proveedor, precio y recepción.

**Lo que NO es:** no es contabilidad fiscal, no maneja lotes/vencimientos por serie, no factura.
Y —regla dura— **el inventario nunca bloquea la operación**: si no hay stock, la pieza se marca
LISTO igual y el stock queda en negativo. Un negativo es una señal de que alguien no registró una
entrada, no una razón para frenar a producción.

---

## 2. Las cinco decisiones de arquitectura

### 2.1 El kardex es la verdad; el saldo es una caché

Dos opciones clásicas: guardar solo movimientos y sumar (`stock = SUM(cantidad)`), o guardar un
saldo. Aquí van **las dos**, pero con una regla:

- `inventario_movimientos` es la **única** fuente de verdad. Todo entra y sale por ahí.
- `inventario_insumos.stock_actual` es un saldo materializado que **actualiza el mismo trigger
  que inserta el movimiento, dentro de la misma transacción**. No puede desviarse porque no hay
  camino que escriba uno sin el otro: el kardex es inmutable (un movimiento no se edita ni se
  borra, se revierte con un compensatorio) y `stock_actual` no se escribe nunca a mano.
- Aun así, un reporte "verificar saldos" compara la columna contra `SUM(cantidad)` del kardex y
  grita si difieren. Cuesta una consulta y compra tranquilidad.

**Por qué importa en Orbit específicamente:** si la pantalla sumara los movimientos en React,
`PGRST_DB_MAX_ROWS=1000` cortaría la suma sin avisar apenas el kardex pase de mil filas — y va a
pasar en semanas. Ese bug ya escondió 216 mascotas una vez. **Ninguna cifra de stock se calcula
en el cliente.** Se lee de la columna, o se agrega en SQL.

### 2.2 Idempotencia: la trampa nº1 de este módulo

`servicio_recordatorios.estado` no es monótono. Va PENDIENTE → EN_PROCESO → LISTO, y vuelve a
EN_PROCESO cuando se corrige un error. `Produccion.jsx:133` lo escribe directo por PostgREST, y
además lo tocan `autoCorregirEstados`, `digitales.js:685`, `grupales.js:495` e `imagenes.js:494`.

Si el descuento se dispara "cada vez que llega a LISTO", **el stock se descuenta dos y tres veces**
y nadie se entera hasta el conteo físico.

La defensa es una llave, no una intención:

```sql
CREATE UNIQUE INDEX uq_inv_mov_origen_vivo
  ON public.inventario_movimientos (origen_tipo, origen_id, insumo_id)
  WHERE origen_tipo IS NOT NULL AND revertido_en IS NULL;
```

Un `servicio_recordatorio` puede consumir un insumo **una sola vez**. Si se revierte (vuelve de
LISTO a EN_PROCESO), se estampa `revertido_en` y se inserta el movimiento compensatorio con
`origen_tipo = 'REVERSA'` — así el índice deja pasar el siguiente consumo cuando se vuelva a
marcar LISTO.

### 2.3 Trigger de base de datos, no endpoint

La directriz de arquitectura manda escrituras críticas al backend propio. Aquí hay que matizarla:
esa directriz es sobre **no ampliar Supabase** (Edge Functions, RLS, Realtime). Un trigger de
PostgreSQL es de la DB propia del proyecto, y la propia nota lo dice: *"tablas/vistas/índices
nuevos están bien"*. Orbit ya vive de triggers (`fn_calcular_fecha_entrega`,
`fn_stamp_fecha_listo`, el upsert de conversación de la migr. 109).

El argumento decisivo es otro: **hay cinco escritores distintos de `servicio_recordatorios.estado`,
uno de ellos el frontend por PostgREST.** Un endpoint solo cubre a quien lo llame; un trigger no se
puede esquivar. Si el descuento vive en el backend, el primer `UPDATE` manual por psql deja el
inventario mintiendo para siempre.

Reparto:

| Qué | Dónde | Por qué |
|---|---|---|
| Consumo automático (recordatorio LISTO, lote cerrado) | **Trigger** | No se puede esquivar, es atómico |
| Ajustes, mermas, conteos, órdenes, recepciones | **Backend** (`orbit-backend/src/inventario.js`) | Necesitan rol, validación y auditoría |
| Alertas de reposición | **Job del backend** por cron del VPS | Ya existe `jobs/alertas.js` y `alertas_operativas` |

**Escotilla obligatoria para backfills.** El trigger honra un interruptor de sesión:

```sql
IF current_setting('orbit.sin_inventario', true) = 'on' THEN RETURN NEW; END IF;
```

Una migración que toque estados en masa abre con `SET LOCAL orbit.sin_inventario = 'on';`. Sin
esto, el primer backfill futuro vacía el inventario de un golpe.

### 2.4 Unidad base ≠ presentación de compra

La arcilla se compra en bultos de 25 kg y se consume en gramos por huella. La cinta se compra en
rollos de 50 m y se usa en centímetros. Si el sistema solo entiende "unidades", el costo por pieza
sale mal por órdenes de magnitud.

- `inventario_insumos.unidad_base` — la unidad en la que se **consume** (`g`, `ml`, `cm`, `unidad`).
- `inventario_presentaciones` — cómo se **compra**: nombre, `factor` (cuántas unidades base trae) y
  precio de referencia. Un insumo puede tener varias (Caja x100, Unidad suelta).
- El kardex guarda **siempre** en `unidad_base`. La conversión ocurre solo al recibir una orden.

En la UI, si el insumo tiene una sola presentación con `factor = 1`, todo esto se esconde.

### 2.5 Costeo: promedio ponderado, congelado en el movimiento

Cada movimiento guarda su `costo_unitario` **al momento en que ocurrió**. Si mañana sube la arcilla,
el costo del altar que se hizo en marzo no cambia. Sin esto, los reportes históricos se reescriben
solos cada vez que hay una compra y ninguna cifra es comparable.

En cada entrada se recalcula el promedio ponderado:

```
costo_promedio' = (stock * costo_promedio + cantidad_entrada * costo_entrada)
                  / (stock + cantidad_entrada)
```

Con guarda: si `stock <= 0`, el promedio pasa a ser el costo de entrada a secas (si no, un stock
negativo produce un promedio absurdo o una división por cero).

---

## 3. Modelo de datos

Nueve tablas (ocho tras decidir bodega única). Todas con `GRANT ... TO postgres, authenticated,
service_role, orbit_backend` y policy RLS — creadas por SQL raw, así que **sin el GRANT explícito
el backend falla mudo**. `anon` queda fuera a propósito: el inventario no tiene superficie pública,
a diferencia del portal de fotos. Las vistas van con `security_invoker = true` para que no salten
la RLS de las tablas.

```
inventario_proveedores      nombre, nit, contacto, dias_entrega, activo
inventario_insumos          codigo, nombre, categoria, unidad_base,
                            stock_actual ⟵ SALDO, stock_minimo, stock_objetivo,
                            costo_promedio, costo_ultimo, proveedor_id,
                            dias_reposicion, perecedero, activo
inventario_presentaciones   insumo_id, nombre, factor, precio_referencia, es_default
inventario_movimientos      ⟵ EL KARDEX. Ver abajo.
inventario_recetas          recordatorio_id | proceso, insumo_id, cantidad,
                            por_kg, condicion_tamano, activo
inventario_ordenes          numero, proveedor_id, estado, fecha_esperada, totales
inventario_orden_items      orden_id, insumo_id, presentacion_id,
                            cantidad_pedida, cantidad_recibida, precio_unitario
inventario_conteos          ubicacion, fecha, estado, responsable_id
inventario_conteo_items     conteo_id, insumo_id, stock_sistema, stock_contado
```

### `inventario_movimientos` — el corazón

```sql
CREATE TABLE public.inventario_movimientos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insumo_id      uuid NOT NULL REFERENCES public.inventario_insumos(id),
  ubicacion      text NOT NULL DEFAULT 'BOGOTA',
  tipo           text NOT NULL CHECK (tipo IN (
                   'ENTRADA_COMPRA','ENTRADA_AJUSTE','ENTRADA_DEVOLUCION','ENTRADA_TRASLADO',
                   'SALIDA_PRODUCCION','SALIDA_MERMA','SALIDA_AJUSTE','SALIDA_TRASLADO')),
  cantidad       numeric(14,3) NOT NULL CHECK (cantidad <> 0),  -- + entra, − sale
  costo_unitario numeric(14,4) NOT NULL DEFAULT 0,              -- congelado
  origen_tipo    text,      -- SERVICIO_RECORDATORIO | ORDEN_ITEM | LOTE_TENJO | CONTEO | REVERSA
  origen_id      uuid,
  servicio_id    uuid REFERENCES public.servicios(id),  -- desnormalizado a propósito
  motivo         text,
  registrado_por uuid REFERENCES public.personal(id),
  revertido_en   timestamptz,
  created_at     timestamptz DEFAULT now()
);
```

`servicio_id` está desnormalizado a propósito: el costo de materiales de un servicio se saca con un
`GROUP BY` en vez de tres joins, y esa consulta la va a pedir Finanzas y Reportes todo el tiempo.

### `inventario_recetas` — la parte "configurable desde Orbit"

Esta es la tabla que traduce el pedido de David: *"que cuando se señale un altar como listo,
descuente una unidad de lo que se utilizó, y así con cada recordatorio"*.

```sql
CREATE TABLE public.inventario_recetas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recordatorio_id uuid REFERENCES public.recordatorios(id) ON DELETE CASCADE,
  proceso         text,   -- 'CREMACION_INDIVIDUAL','COMPOSTAJE_GRUPAL','RECOGIDA','ENTREGA'
  CHECK ((recordatorio_id IS NOT NULL) <> (proceso IS NOT NULL)),
  insumo_id       uuid NOT NULL REFERENCES public.inventario_insumos(id) ON DELETE RESTRICT,
  cantidad        numeric(14,3) NOT NULL CHECK (cantidad > 0),
  por_kg          boolean NOT NULL DEFAULT false,  -- × peso de la mascota (gas, sustrato)
  condicion_tamano text,   -- NULL = siempre; 'Grande' = solo esa talla
  activo          boolean NOT NULL DEFAULT true,
  UNIQUE (recordatorio_id, proceso, insumo_id, condicion_tamano)
);
```

Tres detalles que salen del negocio real de Camino al Cielo:

- **`cantidad` se multiplica por `servicio_recordatorios.cantidad`.** Ese campo existe (lo llena
  `Registro.jsx:915` en los adicionales) y "Postal personalizada (x2)" depende de él. Ignorarlo
  descontaría la mitad.
- **`por_kg`** modela el gas de una cremación y el sustrato de un compostaje sin inventar otra
  tabla: `cantidad × mascotas.peso_kg`.
- **`condicion_tamano`** modela el cenizario, que no es el mismo para un gato que para un rottweiler.
  Los valores son los de `mascotas.tamano`: `Mini | Pequeño | Mediano | Grande | Gigante`, con tilde.

### Vistas

| Vista | Para qué |
|---|---|
| `v_inventario_stock` | Fila por insumo: saldo, consumo diario 30d, días de cobertura, punto de reorden, `estado_stock` ∈ OK/REPONER/NEGATIVO. **Existe ya, migr. 120** |
| `v_inventario_consumo_30d` | Consumo diario real por insumo. **Existe ya, migr. 120** |
| `v_inventario_costo_servicio` | Materiales consumidos por servicio. **Existe ya, migr. 120** |
| `v_inventario_comprometido` | Demanda ya vendida y no producida (ver §5.2) |
| `v_inventario_costo_pieza` | Costo teórico de cada recordatorio = Σ(receta × costo_promedio), contra `recordatorios.precio_base` |
| `v_costo_servicio` | Materiales consumidos por servicio y margen contra `valor_a_cobrar` |
| `v_inventario_recetas_faltantes` | Recordatorios activos **sin receta** — el antídoto contra el fallo mudo |

---

## 4. Los puntos de consumo

Ordenados por valor y por facilidad. El pedido original es el nº 1; los demás son donde está el
dinero grande.

| # | Disparador | Qué consume | Cómo |
|---|---|---|---|
| 1 | `servicio_recordatorios.estado` → `LISTO` | Altar, huella, cofre, lámpara, postales… | Trigger `AFTER UPDATE OF estado` |
| 2 | `lotes_tenjo.estado` → `CERRADO` | Gas, sustrato, bolsas — `por_kg` sobre cada ítem del lote | Trigger sobre `lotes_tenjo_items` |
| 3 | Recogida completada | Bolsa mortuoria, sábana | Trigger sobre `recogidas` |
| 4 | Entrega preparada | Caja, bolsa de entrega, cinta | Trigger sobre `entregas` |
| 5 | Merma / daño | Lo que se dañó | Manual, con motivo obligatorio |
| 6 | Conteo físico cerrado | Diferencia contra el sistema | Backend, genera `SALIDA_AJUSTE`/`ENTRADA_AJUSTE` |

**El punto 6 no es opcional.** Sin conteo periódico, el sistema se aleja de la realidad sin que
nadie lo note y en seis meses nadie le cree. El conteo es lo que mantiene el módulo vivo.

### El fallo mudo que hay que prevenir desde el día uno

Si un recordatorio no tiene receta, el trigger no descuenta nada y **no falla**. Con 40+
recordatorios en el catálogo, es garantía de que el inventario mienta por omisión.

Antídoto: `v_inventario_recetas_faltantes` y un contador permanente en la cabecera del módulo —
*"7 de 43 recordatorios activos no tienen receta"*— con enlace a configurarlos. Un número visible
en pantalla es lo que convierte un silencio en un pendiente.

---

## 5. Reposición: por qué "stock mínimo" no alcanza

### 5.1 Cobertura en días, no unidades

"Quedan 12 unidades" no dice nada. "Quedan 6 días de cobertura y el proveedor tarda 10" es una
orden de compra.

```
consumo_diario  = Σ salidas de producción últimos 30 días / 30
dias_cobertura  = stock_disponible / NULLIF(consumo_diario, 0)
punto_reorden   = consumo_diario * (dias_reposicion + colchón)
```

`stock_minimo` se conserva como piso manual para insumos de consumo irregular. La alerta se
dispara con `MAX(stock_minimo, punto_reorden)`.

### 5.2 Demanda comprometida — la ventaja que solo tiene un ERP integrado

Orbit sabe qué servicios ya se vendieron y todavía no se produjeron. Ese pipeline es demanda de
material **conocida**, no proyectada:

```sql
SELECT r.insumo_id, SUM(r.cantidad * sr.cantidad) AS comprometido
FROM public.servicio_recordatorios sr
JOIN public.inventario_recetas r ON r.recordatorio_id = sr.recordatorio_id AND r.activo
JOIN public.servicios s ON s.id = sr.servicio_id
WHERE sr.estado IN ('PENDIENTE','EN_PROCESO')
  AND sr.origen <> 'REMOVIDO'
  AND s.estado NOT IN ('CANCELADO','ENTREGADO')
GROUP BY r.insumo_id;
```

`stock_disponible = stock_actual − comprometido`; la fase 3 lo mete dentro de `v_inventario_stock`,
donde ya viven la cobertura en días y el punto de reorden. Un almacén con 30 altares y 28 comprometidos no
está lleno: está a dos piezas de parar la producción. Ningún Excel puede calcular esto; Orbit sí.

### 5.3 Dónde aparece la alerta

En `alertas_operativas`, que ya existe (migr. 003) con `clave_dedupe` — exactamente lo que hace
falta para no repetir la misma alerta cada corrida del job:

```
modulo_origen = 'INVENTARIO'
tipo_alerta   = 'STOCK_BAJO' | 'STOCK_NEGATIVO' | 'SIN_RECETA'
clave_dedupe  = 'INV_' || insumo_id || '_' || ubicacion
```

Y badge en el sidebar vía `BadgesContext`, junto a kanban/producción/imágenes.

⚠️ El cron del VPS corrió una vez en horario de Berlín. Al programar el job, verificar la zona
horaria del demonio, no la del contenedor.

---

## 6. Órdenes de compra

Flujo: `BORRADOR → ENVIADA → RECIBIDA_PARCIAL → RECIBIDA` (o `CANCELADA`).

- **Recepción parcial es obligatoria**, no un lujo: los proveedores entregan incompleto. Cada
  recepción inserta movimientos `ENTRADA_COMPRA` con `origen_tipo='ORDEN_ITEM'` y suma en
  `cantidad_recibida`. La orden pasa a `RECIBIDA` sola cuando todos los ítems están completos.
- La recepción es **la única puerta** por la que se recalcula el costo promedio.
- **"Sugerir orden de compra"**: toma todo lo que está bajo el punto de reorden, lo agrupa por
  proveedor y arma un borrador por proveedor con la cantidad `stock_objetivo − disponible`. Este
  botón es lo que hace que el módulo se use en vez de abandonarse.
- **PDF de la orden con jsPDF directo. Nunca `html2canvas`** — con Tailwind v4 produce basura;
  ya está documentado en el módulo de recibos.
- Enviarla al proveedor por WhatsApp es posible reutilizando la infraestructura de envíos, pero
  es fase tardía: primero que el PDF exista y se pueda descargar.

---

## 7. Lo que esto desbloquea en costos

Es la razón real de construirlo. Con el kardex poblado:

- **Costo por pieza** — cuánto cuesta de verdad un Altar de vida contra su `precio_base`. Hoy los
  adicionales se cotizan a ojo.
- **Costo por plan** — Σ de las recetas de los recordatorios que trae el plan. Un Premium tiene 19
  piezas; si el material se come el margen, esto lo muestra.
- **Margen por servicio** — `valor_a_cobrar − comision − materiales − pago del técnico`. Orbit ya
  tiene los tres primeros; los materiales son la pieza que falta.
- **Margen por veterinaria aliada** — cruzando con `comisiones_aliados`. Es probable que algún
  aliado con comisión alta en planes de muchos recordatorios esté dejando margen negativo, y hoy
  no hay forma de saberlo.

Estas cuatro cifras entran en Reportes y Finanzas. **Se agregan en SQL, en una vista.** No en
React: el corte silencioso de 1000 filas ya mordió a Reportes una vez.

---

## 8. Trampas de Orbit que aplican aquí

Revisadas contra el historial del proyecto:

| Trampa | Dónde muerde en este módulo |
|---|---|
| `PGRST_DB_MAX_ROWS=1000` corta mudo | El kardex pasa mil filas en semanas. Nunca sumar en React; usar `dbTodo()` o agregar en SQL |
| `.limit()` sin `.order()` | El kardex paginado escondería los movimientos nuevos |
| `.in()` con muchos uuids → 414 | Cargar recetas de N recordatorios: usar `dbIn` |
| NULL explícito no cae al DEFAULT | El helper `nullify()` de Configuración mandaría `cantidad: null` y reventaría el NOT NULL |
| Tabla creada por SQL raw sin GRANT | Falla mudo para `orbit_backend`. GRANT explícito en la migración |
| Columnas DATE en UTC | Fecha de orden y de conteo: `parseDate`/`hoyLocalISO`, nunca `CURRENT_DATE` |
| Cron en zona horaria de Berlín | El job de alertas de reposición |
| `html2canvas` sobre Tailwind v4 | El PDF de la orden de compra |
| El backend no se despliega con `git push` | `orbit-backend/src/inventario.js` va por `scp` + `docker compose build` |

---

## 8-bis. Lo que quedó construido en la fase 1

Decisiones de implementación que no estaban en el diseño y se vieron al escribirlo:

- **El kardex es inmutable.** Un trigger rechaza `DELETE` y rechaza editar `cantidad`, `tipo`,
  `costo_unitario` o `insumo_id`. Sin eso, un `UPDATE` bienintencionado por psql dejaría el saldo
  mintiendo para siempre — y el saldo es justo lo que nadie audita. Corregir = revertir.
- **El signo lo pone el servidor.** La pantalla manda la cantidad siempre positiva y
  `TIPOS[tipo].signo` decide. Mandar una salida en positivo era el error de dedo más fácil y el
  más caro: habría sumado stock inventado.
- **`CHECK` de signo coherente en la tabla**, por si algún día entra un `INSERT` por otra vía.
- **Una compra sin costo se rechaza.** Con costo 0 el trigger no recalcula el promedio: el saldo
  sube, el costo se queda viejo y el margen miente. El mensaje ofrece la salida correcta
  («usa Ajuste de entrada»).
- **Reimportar el mismo CSV no duplica existencias.** El saldo inicial solo se siembra en insumos
  nuevos; reimportar actualiza datos y nada más. Reimportar por error es exactamente lo que pasa
  cuando algo falla a mitad de camino.
- **`anon` fuera de los GRANT** y vistas con `security_invoker = true`: el inventario no tiene
  superficie pública, a diferencia del portal de fotos.
- **Verificar saldos** en la pantalla: compara la columna contra `SUM(cantidad)` del kardex.
  No debería encontrar nada nunca, y por eso vale la pena — el día que encuentre algo, es que
  apareció un camino de escritura nuevo.
- **El PRODUCTOR entra al módulo.** Ve existencias y reporta merma; es quien tiene el material en
  la mano y ve cuando se rompe una lámina. No toca catálogo, compras ni proveedores. Gating en
  `roles.js` para el menú y revalidación en el backend, que es la que manda.

---

## 9. Plan por fases

Cada fase deja algo usable en producción. Ninguna depende de que la siguiente exista.

| Fase | Migr. | Qué entra | Qué se gana |
|---|---|---|---|
| **1** ✅ | 120 | Catálogo (insumos, proveedores, presentaciones), kardex, saldo, entradas y salidas manuales, costo promedio, importación por CSV, verificación de saldos. Pantalla `/inventario` | Ya se sabe qué hay y qué vale. Cero automatización, cero riesgo |
| **2** | 122 | Recetas + trigger de consumo + reversa + cobertura de recetas | **El pedido literal**: marcar un altar LISTO descuenta solo |
| **3** | 123 | Consumo diario, cobertura, comprometido, job de alertas, badge | Avisa cuándo pedir, antes de que falte |
| **4** | 124 | Órdenes de compra, recepción parcial, PDF, sugerencia automática | Se cierra el ciclo de compra |
| **5** | 125 | Tenjo (`por_kg`), recogida, entrega, conteos físicos, costo por servicio en Reportes/Finanzas | El costo real, completo |

**Empezar por la fase 1 aunque el pedido sea la fase 2.** Un trigger que descuenta contra un
catálogo vacío y unos saldos inventados produce números falsos con apariencia de exactitud, que es
peor que no tener nada. Primero se carga el catálogo con saldos reales de un conteo; después se
enciende el automatismo.

---

## 10. Pantallas

Ruta `/inventario`, grupo **ADMIN** del sidebar (icono `Boxes` o `Warehouse` de lucide), con badge
de reposición. Pestañas, siguiendo el patrón de `Configuracion.jsx`:

- **Existencias** — tabla con semáforo por cobertura, filtro "solo lo que hay que pedir", buscador.
  Columnas: insumo, saldo, comprometido, disponible, días de cobertura, costo promedio, valor total.
- **Movimientos** — kardex filtrable por insumo, tipo y rango de fechas. Paginado **con `order`**.
- **Recetas** — por recordatorio: qué consume y cuánto. Aquí vive el contador de recetas faltantes.
- **Órdenes** — listado por estado, botón "Sugerir compra", detalle con recepción.
- **Conteos** — conteo físico: se congela el saldo del sistema, se digita lo contado, se cierra y
  el sistema genera los ajustes.

Roles: ADMIN y COORDINADOR completo (son equivalentes en Orbit). PRODUCTOR debería ver existencias
y poder reportar merma — es quien tiene el material en la mano. Agregar `/inventario` a
`ACCESO_TOTAL` en `src/lib/roles.js`.

---

## 11. Decisiones pendientes de David

Las tres primeras quedaron resueltas arriba. Queda una, y es de operación:

1. **Confirmar qué migraciones están aplicadas en producción.** El repo tiene archivos hasta la
   119; la nota de estado dice que producción va por la 110. La 120 no depende de ninguna de
   ellas —solo de `personal`, `servicios`, `recordatorios` y `mascotas`, que son anteriores a
   todo—, así que se puede aplicar igual. Pero conviene cerrar la brecha antes de seguir.
2. **Cargar el catálogo real antes de encender la fase 2.** Es la única precondición dura: el
   trigger de descuento sin saldos reales produce números falsos con cara de exactos.
