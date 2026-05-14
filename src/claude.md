# CLAUDE.md — Camino al Cielo · Sistema de gestión interno

## ¿Qué es este proyecto?
Sistema de información interno para **Camino al Cielo**, funeraria para mascotas en Bogotá, Colombia. Reemplaza Google Sheets con un sistema estructurado que gestiona toda la operación: desde la recogida de la mascota hasta la entrega de recordatorios al propietario.

## Stack tecnológico
- **Frontend:** Vite + JavaScript vanilla (sin frameworks)
- **Base de datos:** Supabase (PostgreSQL) — proyecto: `gfnvrmpcwchqdyozwygd`
- **Estilos:** CSS custom en `src/styles.css` con variables CSS
- **Fuentes:** Nunito (cuerpo) + Playfair Display (títulos)
- **Dev server:** `npm run dev` → `localhost:5173`

## Estructura de archivos
```
cacapp/
├── index.html
├── src/
│   ├── main.js              ← Router principal, sidebar, badges
│   ├── supabase.js          ← Cliente DB, helpers, constantes globales
│   ├── styles.css           ← Estilos globales con variables CSS
│   └── pages/
│       ├── dashboard.js     ← KPIs, alertas, actividad reciente
│       ├── kanban.js        ← Tablero de servicios con estados
│       ├── registro.js      ← Wizard 5 pasos para nuevo servicio
│       ├── calendario.js    ← Vista mensual de fechas límite
│       ├── cuarto_frio.js   ← Control de neveras y mascotas refrigeradas
│       ├── tenjo.js         ← Traslados y procesos planta Tenjo
│       ├── produccion.js    ← Cola de recordatorios por máquina
│       ├── seguimiento_imagenes.js ← Solicitudes y recepción de fotos
│       ├── gestion.js       ← Tablas: clientes, mascotas, aliados, personal, inventario
│       ├── nps.js           ← NPS y contactos postventa
│       ├── reportes.js      ← Reportes financieros y operacionales
│       ├── presequiales.js  ← Planes anticipados de afiliación
│       └── configuracion.js ← Planes, recordatorios, comisiones, catálogos
```

## Conexión Supabase
```javascript
// En src/supabase.js — NO cambiar estas credenciales
const SUPABASE_URL = 'https://gfnvrmpcwchqdyozwygd.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' // anon key
```

Los helpers disponibles en `supabase.js`:
- `dbGet(table, select, filters, order)` — SELECT con filtros
- `dbSearch(table, select, column, value, limit)` — búsqueda con ilike
- `dbInsert(table, body)` — INSERT con select
- `dbUpdate(table, id, idCol, body)` — UPDATE por ID
- `fmt(n)` — formatea número como moneda COP
- `today()` — fecha actual YYYY-MM-DD
- `petEmoji(especie)` — emoji según especie
- `initials(nombre, apellido)` — iniciales para avatares
- `needsAcomp(plan)` — si el plan requiere selección de acompañamiento
- `calcularPrecio(planId, pesoKg, especie)` — precio según peso de la mascota

## Navegación
El router está en `src/main.js`. Para navegar entre módulos desde cualquier página:
```javascript
window.navegarA('kanban')  // nombres: dashboard, kanban, registro, calendario,
                            // cuarto_frio, tenjo, produccion, imagenes,
                            // gestion, nps, presequiales, reportes, configuracion
```

## Patrón de cada módulo
```javascript
export async function renderModulo(container) {
  // 1. Renderizar topbar + estructura base
  container.innerHTML = `<div class="topbar">...</div><div class="page-body">...</div>`
  // 2. Cargar datos de Supabase
  // 3. Renderizar contenido
  // 4. Exponer funciones en window.* para onclick del HTML generado
}
```

**IMPORTANTE:** Las funciones usadas en `onclick` dentro de strings HTML deben exponerse en `window.*` porque el HTML generado dinámicamente no tiene acceso al scope del módulo.

## Base de datos — tablas principales
```
CATÁLOGOS:        canal_origen, tipo_establecimiento, especies, roles_personal, maquinas_produccion
ENTIDADES:        clientes, mascotas, aliados, personal, personal_roles
OPERACIONALES:    planes, recordatorios, plan_recordatorios, vip_recordatorios
                  config_comisiones, flujos_proceso, planes_precios
OPERACIÓN CORE:   servicios, recogidas, cuarto_frio, lotes_grupales
                  traslados_tenjo, procesos_disposicion
PRODUCCIÓN:       solicitudes_imagenes, servicio_recordatorios
                  inventario, recordatorio_materiales, movimientos_inventario
CIERRE:           entregas, comisiones_aliados, novedades_servicio
ESPECIALES:       nps_seguimiento, seguimiento_compostaje, planes_presequiales
VISTAS:           v_kanban, v_alertas, v_operacion_hoy, v_carga_personal
                  v_stock_bajo, v_compostaje_activo, v_tiempo_promesa
```

### Campos clave de `servicios`
- `id` (UUID PK)
- `mascota_id` → FK mascotas
- `plan_id` → FK planes
- `estado`: INGRESADO | EN_RECOGIDA | EN_CUARTO_FRIO | EN_PROCESO | EN_PRODUCCION | LISTO | EN_ENTREGA | ENTREGADO | CANCELADO
- `canal_entrada`: DIRECTO | ALIADO
- `aliado_origen_id` → FK aliados
- `tipo_acompanamiento`: PRESENCIAL | VIDEOLLAMADA | EVIDENCIA
- `fecha_ingreso`, `fecha_limite_cambio_plan`, `fecha_imagenes_recibidas`, `fecha_limite_entrega`
- `tecnico_id`, `productor_id`, `mensajero_id` → FK personal
- `valor_total`, `valor_pagado`, `estado_pago`, `metodo_pago`

### Campos clave de `servicio_recordatorios`
- `origen`: PLAN | VIP | ADICIONAL | INDEPENDIENTE | REMOVIDO
- `estado`: PENDIENTE | EN_PROCESO | LISTO | ENTREGADO | NA

## Lógica de negocio crítica

### Triggers automáticos al crear un servicio:
1. Copia recordatorios del plan → `servicio_recordatorios` con origen=PLAN
2. Si aliado es VIP → agrega ítems de `vip_recordatorios` con origen=VIP
3. Crea recogida en estado PENDIENTE
4. Crea entrega en estado PENDIENTE
5. Registra en cuarto_frio
6. Si es compostaje → crea registro en seguimiento_compostaje
7. Calcula `fecha_limite_cambio_plan` = ingreso + 2 días hábiles

### Tiempos límite de entrega por plan (días hábiles desde imágenes recibidas):
- DESAMPARADO, ANGEL → 3 días desde recogida (sin imágenes)
- ECO_GRUPAL → 3 días desde imágenes
- BASICO, STANDARD, PREMIUM, EXCLUSIVO_* → 8 días desde imágenes
- COMPETS_* → 2 meses desde recogida (compostaje)

### Comisiones aliados — 3 modalidades:
- `DESCUENTO_INMEDIATO`: se descuenta al momento de la recogida en clínica
- `CREDITO_ACUMULADO`: queda en saldo del aliado para descontar después
- `FACTURACION_MENSUAL`: se acumula y factura al cierre del mes

### Precios por peso — tabla `planes_precios`:
Los precios varían según el peso de la mascota en 6 rangos:
PETIT (0-999g), FELINO (desde 1kg), 1-10KG, 11-20KG, 21-35KG, 36-60KG

### Planes presequiales — equivalencias:
- BRONCE → Plan Básico (cremación grupal)
- PLATA → Plan Estándar (cremación grupal)
- ORO → Plan Exclusivo O Compostaje (cliente elige al activar)
- DIAMANTE → Plan Premium (cremación individual)
- VITALICIO → Pago único, cobertura de por vida

## Estilos — clases CSS principales
```css
/* Layout */
.app-shell, .sidebar, .main-content, .topbar, .page-body

/* Componentes */
.card, .card-title, .card-sub
.stats-grid, .stat-card, .stat-label, .stat-value, .stat-sub
.table-wrap, table, th, td
.modal-overlay, .modal-box, .modal-header, .modal-title, .modal-close

/* Formularios */
.form-grid, .form-field, .form-field.span2, label, input, select, textarea

/* Botones */
.btn, .btn-primary, .btn-secondary, .btn-gold, .btn-danger, .btn-ghost, .btn-sm

/* Badges */
.badge, .badge-green, .badge-amber, .badge-blue, .badge-red, .badge-purple, .badge-gray

/* Alertas */
.alert, .alert-info, .alert-warn, .alert-error, .alert-loading

/* Kanban */
.kanban-board, .kanban-col, .kanban-col-header, .kanban-col-body
.k-card, .k-card-accent, .k-card-top, .k-card-meta, .k-card-footer

/* Producción */
.prod-grid, .prod-card, .prod-item-pill (+ estados: PENDIENTE, EN_PROCESO, LISTO, ENTREGADO)

/* Misc */
.toggle-tabs, .toggle-tab.active
.section-sub (con línea verde a la izquierda)
.spinner, .loading-box
.text-muted
```

## Variables CSS principales
```css
--bg: #F4F7F4           /* Fondo general verde muy claro */
--surface: #FFFFFF       /* Tarjetas y modales */
--surface2: #EDF2ED      /* Fondos secundarios */
--text: #1A2E1E          /* Texto principal */
--text2: #4A6650         /* Texto secundario */
--text3: #7A9880         /* Texto terciario / placeholders */
--green: #2D7A45         /* Verde principal */
--green2: #1F5A32        /* Verde oscuro (sidebar, botones primarios) */
--green-light: #E8F3EB   /* Verde muy claro (alerts, resúmenes) */
--green-mid: #C5DEC9     /* Verde medio (bordes, steppers) */
--gold: #C4A87A          /* Dorado (btn-gold, precios) */
--gold2: #9E7D4A         /* Dorado oscuro */
--red: #C03030           /* Rojo errores */
--border: rgba(30,80,40,.1)   /* Borde suave */
--border2: rgba(30,80,40,.2)  /* Borde más visible */
```

## Reglas de desarrollo

### Al modificar un módulo:
1. Si cambias la estructura de datos → verificar que `supabase.js` tenga el helper correcto
2. Si agregas una nueva función usada en `onclick` → exponerla en `window.*`
3. Si cambias un nombre de función global → buscar todas las referencias en otros módulos
4. Si modificas `styles.css` → verificar que no rompa otros módulos que usan esa clase
5. Si agregas un módulo nuevo → registrarlo en `main.js` en el objeto `PAGES`

### Interconexiones críticas entre módulos:
- `registro.js` → al confirmar crea registros en: servicios, recogidas, entregas, cuarto_frio, servicio_recordatorios (via triggers)
- `kanban.js` → usa `v_kanban` (vista de Supabase) y `window.navegarA()` del main
- `dashboard.js` → usa `v_kanban`, `v_alertas`, llama `window.navegarA('kanban')`
- `calendario.js` → calcula fechas límite localmente según código del plan
- `produccion.js` → lee y actualiza `servicio_recordatorios`
- `tenjo.js` → lee `cuarto_frio` y `traslados_tenjo`, actualiza estado de `servicios`
- `gestion.js` → CRUD sobre clientes, mascotas, aliados, personal, inventario
- `nps.js` → lee y actualiza `nps_seguimiento`
- `reportes.js` → solo lectura: v_kanban, v_tiempo_promesa, comisiones_aliados, servicio_recordatorios
- `configuracion.js` → planes, recordatorios, plan_recordatorios, vip_recordatorios, config_comisiones
- `presequiales.js` → CRUD sobre planes_presequiales, al activar navega a registro

### Badges del sidebar (se actualizan cada 60s desde main.js):
- `kanban` ← alertas VENCIDO/HOY/URGENTE en v_alertas
- `produccion` ← servicio_recordatorios con estado=PENDIENTE
- `imagenes` ← solicitudes_imagenes con estado=PENDIENTE
- `nps` ← nps_seguimiento con estado=PENDIENTE

## Contexto del negocio

### Flujo operacional completo:
1. **Registro** → coordinador crea el servicio (wizard 5 pasos)
2. **Recogida** → técnico va a buscar la mascota (moto cajón, moto tráiler o camioneta)
3. **Cuarto frío** → mascota refrigerada mientras se coordina el proceso
4. **Solicitud imágenes** → día siguiente al servicio se contacta al cliente
5. **Proceso disposición**:
   - Cremación grupal (Básico, Estándar, Ángel, Desamparado) → lote cada 3 días hábiles
   - Cremación individual (Premium, Exclusivo) → planta Tenjo mar/jue/sáb, previa traslado
   - Compostaje grupal → Eco-grupal, lote cada 3 días hábiles
   - Compostaje individual → Compets, cubículo Tenjo, 2 meses
6. **Producción recordatorios** → equipo de 5 personas + 5 máquinas
7. **Armado y revisión** → checklist completo del paquete
8. **Entrega** → mensajero hace domicilio mar/jue/sáb
9. **NPS** → contacto post-entrega, 3 meses, 6 meses

### Personal operativo:
- **Coordinador** → recibe solicitudes, carga servicios, asigna técnicos
- **Técnico** → recoge mascotas (moto cajón, moto tráiler, camioneta), entrega recordatorios básicos
- **Productor** → elabora recordatorios (5 personas, 5 máquinas)
- **Mensajero** → entrega recordatorios al cliente
- **Operario** → maneja la planta en Tenjo (2 personas)

### Aliados y comisiones:
- Aliados VIP → reciben ítems adicionales de fidelización automáticamente
- Comisión varía por: plan contratado + volumen mensual + si es VIP
- 3 formas de pago: descuento inmediato, crédito acumulado, facturación mensual

### Recordatorios importantes:
- Algunos ítems son `solo_nombre=true` → se pueden producir sin esperar imágenes
- Los planes presequiales NO aparecen en el selector del wizard de registro
- El plan ORO en presequiales puede ser Exclusivo O Compostaje (tipo_proceso=NULL hasta activar)
- Desamparado solo lo toman veterinarias

## Comandos útiles
```bash
npm run dev          # Iniciar servidor de desarrollo
npm run build        # Build de producción
```
au