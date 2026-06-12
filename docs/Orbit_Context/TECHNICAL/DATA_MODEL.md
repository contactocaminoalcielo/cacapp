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

## Relaciones críticas
- `servicios → mascotas` vía `mascota_id` → para llegar a cliente: `mascotas(nombre, clientes(nombre, apellido))`
- `servicios → aliados` vía `aliado_origen_id`
- `servicio_recordatorios` es la tabla puente servicios ↔ recordatorios
- `recogidas.tecnico_id` es donde vive el técnico de la recolección (no solo en servicios)
- Comisión DESCUENTO_INMEDIATO: `valor_total` en DB = precio ya descontado; precio original = `valor_total + comision_aliado`

## Nota JOIN cuarto_frio
No hacer JOIN directo `servicios → cuarto_frio` — falla silenciosamente. Usar DOS queries separadas y mergear client-side.
