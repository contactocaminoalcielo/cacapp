# DATA_MODEL.md — Modelo de datos Orbit (sincronizado con DB real)

> **IMPORTANTE:** Los nombres de PKs y columnas son exactamente los de la DB de Supabase.
> Antes de escribir cualquier query, leer también `feedback_db_corrections.md` en memoria.

## Entidades principales

### Cliente — tabla `clientes`
- `id_cliente` (UUID) — PK
- `nombre`, `apellido`
- `telefono` — campo crítico para notificaciones
- `email`
- `documento`
- `tipo_cliente` — enum: `NORMAL | VIP | RECURRENTE`
- `notas` — observaciones generales (no existe `barrio` ni `localidad`)
- `fecha_creacion`

### Mascota — tabla `mascotas`
- `id_mascota` (UUID) — PK
- `cliente_id` (UUID FK → `clientes.id_cliente`)
- `nombre`
- `especie_id` (integer FK → `especies.id`) — 1=Perro, 2=Gato, 3=Conejo, 4=Ave, 5=Hámster, 6=Pez, 7=Reptil, 8=Otro
- `raza`
- `peso` (kg)
- `tamano` — enum: `"Pequeño" | "Mediano" | "Grande" | "Mini" | "Gigante"` (con tildes)
- `sexo` — enum: `"Macho" | "Hembra"` (primera letra mayúscula)
- `fecha_fallecimiento`
- `observaciones`

### Servicio — tabla `servicios`
- `id` (UUID) — PK
- `mascota_id` (UUID FK → `mascotas.id_mascota`)
- `plan_id` (UUID FK → `planes.id`)
- `aliado_origen_id` (UUID FK → `aliados.id_aliado`) — veterinaria/aliado que refirió
- `estado` — ver estados en MODULES/SERVICIOS.md
- `estado_pago` — enum: `PENDIENTE | PARCIAL | COMPLETO`
- `canal_entrada` — enum: `DIRECTO | ALIADO | REFERIDO | REDES_SOCIALES | GOOGLE | CLIENTE_ANTIGUO`
- `tipo_acompanamiento` — enum: `PRESENCIAL | VIDEOLLAMADA | EVIDENCIA`
- `origen` — texto libre
- `valor_total` (numeric)
- `descuento_adicional` (numeric, default 0)
- `descuento_adicional_motivo` (text)
- `medios_pago` (jsonb)
- `responsable_id` (UUID FK → `personal.id`)
- `fecha_creacion`, `fecha_confirmacion`, `fecha_cierre`
- `observaciones`
- **Cancelación** (agregadas 2026-06-12, migración `2026-06-12_cancelacion_servicios.sql`, todas nullable):
  - `cancelado_en` (timestamptz)
  - `cancelado_por` (UUID FK → `personal.id`)
  - `motivo_cancelacion` (text) — valores de `MOTIVOS_CANCELACION` en Kanban.jsx
  - `observacion_cancelacion` (text)
  - `etapa_cancelacion` (text) — estado del servicio al momento de cancelar

### Plan — tabla `planes`
- `id` (UUID) — PK
- `nombre`, `codigo`
- `tipo_proceso` — cremacion | aquamacion | compostaje | cementerio
- `es_grupal` (boolean)
- `genera_devolucion` (boolean)
- `descripcion`
- `activo` (boolean)
- **Planes presequiales** (excluir de Registro): BRONCE, PLATA, ORO_EXCLUSIVO, DIAMANTE, VITALICIO

### Recolección — tabla `recogidas`
- `id` (UUID) — PK
- `servicio_id` (UUID FK → `servicios.id`)
- `tecnico_id` (UUID FK → `personal.id`)
- `direccion`, `tipo_lugar`
- `contacto_nombre`, `contacto_telefono`
- `zona`
- `fecha_programada`, `hora_estimada`
- `estado`
- `evidencia`
- `novedad`

### Cuarto Frío — tabla `cuarto_frio`
- `id` (UUID) — PK
- `servicio_id` (UUID FK → `servicios.id`)
- `nevera_id` (FK → `neveras.id`)
- `fecha_ingreso`, `fecha_salida`
- `observaciones`

### Nevera — tabla `neveras`
- `id` — PK
- `nombre` — ej. "N1", "N2"...
- `capacidad_kg` (numeric) — NO `capacidad`

### Produccion — tabla `produccion` (o similar)
- `id` (UUID) — PK
- `servicio_id` (UUID FK → `servicios.id`)
- `tipo_proceso`
- `estado`
- `fecha_inicio`, `fecha_fin`
- `responsable_id`
- `observaciones`

### Recordatorio — tabla `recordatorios`
- `id` (UUID) — PK — NO `id_recordatorio`
- `nombre`, `descripcion`
- `precio_base` (numeric) — precio fijo, no editable por usuario

### Servicio-Recordatorio — tabla `servicio_recordatorios`
- `id` (UUID) — PK
- `servicio_id` (UUID FK → `servicios.id`)
- `recordatorio_id` (UUID FK → `recordatorios.id`)
- `origen` — enum: `PLAN | VIP | ADICIONAL | INDEPENDIENTE | REMOVIDO`
- `estado` — enum: `PENDIENTE | EN_PROCESO | LISTO | ENTREGADO | NA`
- `cantidad` (integer)
- `subtotal` (numeric)
- `disenador_id`
- `fecha_inicio`, `fecha_aprobacion`, `fecha_finalizacion`
- `observaciones`

### Aliado — tabla `aliados` (≡ Veterinarias en el negocio)
- `id_aliado` (UUID) — PK
- `nombre`
- `telefono`, `whatsapp` — NO `contacto_telefono`
- `direccion`
- `contacto_principal`
- `vip` (boolean) — NO `es_vip`
- `modalidad_comision` — enum: `DESCUENTO_INMEDIATO | CREDITO_ACUMULADO | FACTURACION_MENSUAL`
- `horario` (jsonb) — formato: `{ "lun": { "apertura": "08:00", "cierre": "18:00" }, ... }`
- `estado`, `observaciones`

### Comisión (lógica, no tabla propia aún)
- Las comisiones se calculan desde `config_comisiones` (plan_id + es_vip + volumen mensual)
- Tramos volumen: 0-5 svc=10%, 6-15=12%, 16+=15%
- VIP: tasas fijas por tipo plan (32% grupal, 27% individual, 10% eco-grupal)
- **Pendiente**: crear tabla `comisiones` para registro por servicio con estado pagada/pendiente

### Solicitud de servicio — tabla `solicitudes_servicio`
- `id` (UUID) — PK
- Cliente, mascota, plan, veterinaria/aliado (datos del formulario público)
- `estado` — `PENDIENTE | CONVERTIDO | DESCARTADO`
- RLS: INSERT para anon, ALL para authenticated

### Personal — tabla `personal`
- `id` (UUID) — PK
- `nombre`
- `rol_principal_id` (integer FK → `roles_personal.id`) — NO columna `rol`
- Join para nombre del rol: `select('*, roles_personal!rol_principal_id(nombre)')`
- `activo`

### Roles — tabla `roles_personal`
- `id` (integer) — PK
- `nombre` — ver lista en ROLES_AND_PERMISSIONS.md

### Auditoría — tabla `auditoria`
- **PENDIENTE DE IMPLEMENTAR**
- Diseño en DATA_MODEL original: id, entidad, entidad_id, accion, usuario_id, valor_anterior, valor_nuevo, fecha, observacion

### Ofertas del portal — tablas `ofertas`, `oferta_planes`, `oferta_respuestas` (migración 078)
Ver `MODULES/OFERTAS.md`.
- `ofertas.id` (UUID) — PK · `titulo`, `descripcion`, `imagen_url`
- `ofertas.recordatorio_id` (UUID FK → `recordatorios.id`) — qué se vende
- `ofertas.precio_oferta` (numeric) — **fuente de verdad del cobro**; `precio_lista` es solo el tachado de display (NULL → `recordatorios.precio_base`)
- `ofertas.orden` (int) — menor = mayor prioridad; solo se muestra la primera aplicable
- `ofertas.aplica_todos_planes` (bool), `vigencia_desde/hasta` (date), `activo` (bool)
- `oferta_planes` — `oferta_id` × `plan_id` (UNIQUE), planes donde se muestra
- `oferta_respuestas` — `respuesta` ∈ `ACEPTADA | RECHAZADA`, `precio_ofrecido` (snapshot),
  `servicio_recordatorio_id` (el adicional creado). **UNIQUE (servicio_id, oferta_id)** = candado anti doble cobro
- RLS: solo `authenticated` (ALL en catálogo, SELECT en respuestas). `anon` NO tiene acceso —
  el portal las lee por el backend propio. Bucket público `ofertas` para la foto del anuncio.

### Compras de recordatorios sin servicio — tablas `compras_recordatorios`, `compra_recordatorio_items`, `compra_recordatorio_pagos`, `compra_recordatorio_eventos` (migración 168)

Ver [MODULES/COMPRAS_RECORDATORIOS.md](../MODULES/COMPRAS_RECORDATORIOS.md).

- `compras_recordatorios.id` (UUID) — PK · `numero` (int, secuencia propia, se muestra CR-n)
- `cliente_id` → `clientes.id_cliente` · `mascota_id` → `mascotas.id_mascota` (la mascota puede estar VIVA)
- `total` numeric · `valor_pagado` — **la mantiene el trigger** `trg_compra_rec_pagos`; nunca escribirla
- `estado_pago` — **columna generada** (PENDIENTE / PARCIAL / COMPLETO); no existe UPDATE posible
- `anulada_en`, `anulada_por`, `motivo_anulacion` — CHECK: o los tres o ninguno. No hay DELETE
- `compra_recordatorio_items`: `nombre` y `precio_unitario` son **snapshot** del catálogo; `subtotal` generada;
  `estado` ∈ `PENDIENTE | EN_PROCESO | LISTO | ENTREGADO`; `datos_cliente` jsonb con la MISMA forma que
  `servicio_recordatorios.datos_cliente`; `imagenes_urls` text[] guarda **rutas** del bucket `evidencias`, no URLs
- `compra_recordatorio_pagos`: `monto > 0`, `metodo` ∈ `EFECTIVO|TRANSFERENCIA|NEQUI|DAVIPLATA|TARJETA|OTRO`, `comprobante_path`
- `compra_recordatorio_eventos.tipo` ∈ `CREADA | PAGO | ESTADO_ITEM | DATOS_ITEM | ANULADA | NOTA`
- `autorizaciones_datos.origen` gana el valor `COMPRA_RECORDATORIOS`
- RLS: `authenticated` solo SELECT. Escribe **solo `orbit_backend`** (GRANT explícito, incluida la secuencia)
- Migr. 170: `orbit_contadores.produccion` suma las líneas PENDIENTE de compras no anuladas; ambas tablas en `supabase_realtime`

### Elección de planta — tablas `plantas`, `planta_elecciones`, `planta_adicionales` (migraciones 149/150)

Ver [MODULES/PLANTAS.md](../MODULES/PLANTAS.md).

- `plantas.id` (UUID) — PK · `nombre` (UNIQUE), `descripcion`, `imagen_url`, `orden`, `activo`
- `plantas.precio` (numeric) — **fuente de verdad del cobro** del extra; el navegador nunca manda precios
- `plantas.elegible` (bool) — aparece entre las opciones que la familia escoge (va incluida)
- `plantas.adicional` (bool) — se ofrece con su precio. CHECK: al menos uno de los dos
- `planta_elecciones.servicio_id` (UUID FK) — **UNIQUE**, candado anti-duplicado del job
- `planta_elecciones.lote_item_id` (UUID FK → `lotes_tenjo_items.id`, ON DELETE SET NULL)
- `planta_elecciones.estado` ∈ `PENDIENTE | ENVIADO | ELEGIDA | ERROR | CANCELADA`
- `planta_elecciones.codigo` — **es `servicios.codigo_fotos`**, el mismo secreto del portal de fotos
- `planta_elecciones.fecha_cumplida` (date) — `fecha_compostaje_inicio + meses_compostaje` del item.
  ⚠️ **Leerla siempre con `::text`**: como DATE llega a Node como Date de JS y rompe los cálculos
- `planta_elecciones.planta_nombre` — snapshot; el catálogo puede cambiar después
- `planta_adicionales` — `nombre`/`precio_unitario` son snapshot.
  **UNIQUE (eleccion_id, planta_id)** = candado anti doble cobro
- `v_plantas_pendientes` — vista del tablero, con `security_invoker = true`
- RLS: `authenticated` (ALL en catálogo y elecciones, SELECT en adicionales). `anon` NO accede.
  GRANTs explícitos a **`orbit_backend`** (los ALTER DEFAULT PRIVILEGES no lo cubren).
  Bucket público `plantas` para las fotos del catálogo

### Cubículos de Tenjo — tablas `cubiculos`, `lotes_tenjo_items` (migraciones 055 / 155)

Ver [Tenjo_Salidas_Compostaje.md](../../Tenjo_Salidas_Compostaje.md).

- `cubiculos.codigo` — columna **GENERADA** (`ZONA-T-NN`, ej. `AZUL-P-05`). No se escribe a mano
- `cubiculos.capacidad` smallint NOT NULL DEFAULT 1, CHECK 1–20 (migr. 155) — cuántas mascotas
  caben a la vez. **NO existe `cubiculos.estado`**: la ocupación se DERIVA de los items
- `lotes_tenjo_items.cubiculo_id` + `cubiculo_liberado_en` (timestamptz) / `cubiculo_liberado_por` —
  ocupa el cubículo ⟺ `cubiculo_id IS NOT NULL AND cubiculo_liberado_en IS NULL`
- `lotes_tenjo_items.cubiculo_salida` (date, migr. 155) — el día en que **salió la mascota**,
  editable. Distinto de `cubiculo_liberado_en`, que es cuándo se pulsó el botón
- `lotes_tenjo_items.fecha_compostaje_inicio` + `meses_compostaje` numeric(3,1) CHECK IN (2, 2.5, 3)
- ⚠️ El índice único `uq_cubiculo_ocupado` **ya no existe** (migr. 155): lo reemplaza el trigger
  `fn_cubiculo_cupo`, que bloquea la fila del cubículo (`FOR UPDATE`) y rechaza pasarse del cupo
- `fn_compostaje_espera_salida(uuid)` / `fn_recalcular_limite_compostaje(uuid)` +
  trigger `trg_item_salida_limite` — el plazo de entrega de los recordatorios (ver BUSINESS_RULES RN085)

### Entrega — tabla `entregas` (cobro en la puerta: migración 151)
- Estados: `PENDIENTE | DISPONIBLE | ASIGNADA | EN_CAMINO | ENTREGADA | FALLIDA | REPROGRAMADA`.
  ⚠️ `PENDIENTE` es un cascarón del trigger `fn_post_crear_servicio`, **no** "lista para entregar"
- `mensajero_id`, `publicada_en/por`, `tomada_en` (distingue "la tomó del pool" de "se la asignaron"),
  `aceptada_en`, `fecha_realizada` (date, fecha LOCAL), `hora_realizada` (time)
- `foto_entrega_url`, `foto_firma_url`
- **Cobro (migr. 151):** `cobro_monto` numeric(12,2) · `cobro_metodo` text
  (`EFECTIVO|TRANSFERENCIA|NEQUI|DAVIPLATA|TARJETA|OTRO`) · `cobro_comprobante_path` text
  (ruta en el bucket `evidencias`) · `cobro_registrado_en` timestamptz ·
  `cobro_registrado_por` uuid → `personal(id)` · `cobro_no_realizado_motivo` text
- CHECKs: o cobró (monto + medio + quién) **o** explicó por qué no —nunca ambos—, y un medio que
  no sea EFECTIVO/OTRO **exige comprobante**

### Cuadre — tablas `cuadres_tecnico`, `cuadre_items`
- `cuadre_items.es_entrega` bool + `entrega_id` uuid → `entregas(id)` (**migración 152**): la fila
  es plata recibida al ENTREGAR, no al recoger. Se fecha por el día del cobro, no por
  `servicios.fecha_ingreso`. `false`/NULL en todas las filas anteriores, así que los cuadres
  CERRADOS siguen dando las mismas cifras
- UNIQUE parcial `(cuadre_id, entrega_id)`: una entrega no entra dos veces al mismo cuadre
- ⚠️ **Un servicio puede tener DOS filas en el mismo cuadre** (su recogida y su entrega). Todo lo
  que descarte "por servicio" tiene que mirar la clase de fila — ver la cabecera de la migr. 152
- `dinero_a_entregar = efectivo_recibido − total_reconocido − ajustes_manuales` (piso $0).
  Solo el **EFECTIVO** se le atribuye a la persona; lo digital es `digital_empresa`

### Adjuntos de WhatsApp — tabla `whatsapp_media`
- Una fila por mensaje (`mensaje_id` único), `archivo` bytea, `mime`, `bytes`, `sha256`,
  `transcripcion` (Whisper), `error` (**se registra también cuando falla**, para que la bandeja
  diga por qué en vez de dejar un hueco)
- `nombre` text (**migración 153**) — con qué nombre se baja el archivo. Hace falta porque el
  texto de una plantilla no lo contiene y un certificado caía como `whatsapp-<id>.pdf`
- Lo llenan: lo que ENTRA (webhook), lo que se manda desde la bandeja, y —desde el 10-sep— **la
  cabecera de una plantilla**, que es como sale un certificado

## Relaciones críticas
- `servicios → mascotas` vía `mascota_id` → para llegar a cliente: `mascotas(nombre, clientes(nombre, apellido))`
- `servicios → aliados` vía `aliado_origen_id`
- `servicio_recordatorios` es la tabla puente servicios ↔ recordatorios
- `recogidas.tecnico_id` es donde vive el técnico de la recolección (no solo en servicios)
- Comisión DESCUENTO_INMEDIATO: `valor_total` en DB = precio ya descontado; precio original = `valor_total + comision_aliado`

## Nota JOIN cuarto_frio
No hacer JOIN directo `servicios → cuarto_frio` — falla silenciosamente. Usar DOS queries separadas y mergear client-side.
