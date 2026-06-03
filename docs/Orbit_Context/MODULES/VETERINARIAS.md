# Módulo Aliados (Veterinarias y aliados comerciales)

> En el código y la DB este módulo se llama **Aliados** (tabla `aliados`, FK `aliado_origen_id`).
> El concepto "Veterinaria" del spec original se amplió a cualquier aliado comercial.

## Propósito
Gestionar aliados veterinarios y comerciales, sus servicios referidos, beneficios, comisiones y clasificación VIP.

## Funciones mínimas
- Crear aliado con datos de contacto y horario.
- Definir modalidad de comisión.
- Asociar servicios referidos vía `aliado_origen_id` en servicios.
- Calcular comisiones según plan, volumen mensual y estado VIP.
- Consultar volumen mensual de referidos.
- Registrar beneficios entregados.
- Clasificar aliado como VIP.

## Campos clave (tabla `aliados`)
- `id_aliado` (UUID) — PK
- `vip` (boolean) — NO `es_vip`
- `telefono`, `whatsapp` — NO `contacto_telefono`
- `modalidad_comision`: `DESCUENTO_INMEDIATO | CREDITO_ACUMULADO | FACTURACION_MENSUAL`
- `horario` (jsonb) — formato: `{ "lun": { "apertura": "08:00", "cierre": "18:00" }, ... }`
  - Editado con `horario-editor.jsx` (estilo Google Maps: checkbox + hora apertura/cierre por día)

## Reglas de comisión (implementadas)

### DESCUENTO_INMEDIATO (clínicas aliadas)
- Aplica solo cuando `tipo_lugar = CLINICA_ALIADA` en la recogida.
- `valor_total` en DB = precio ya descontado.
- Precio original = `valor_total + comision_aliado`.
- Comisión % = `comision_aliado / precioOriginal × 100` (NO sobre valor_total).
- Recibo cliente muestra precio original. Recibo veterinaria muestra precio descontado.

### Tramos por volumen mensual (no VIP)
- 0–5 servicios referidos en el mes → 10%
- 6–15 → 12%
- 16+ → 15%

### VIP — tasas fijas
- Cremación grupal: 32%
- Plan individual: 27%
- Eco-grupal: 10%
- `config_comisiones.porcentaje` viene como string → siempre `parseFloat(match?.porcentaje) || 0`

### Comisión aplica SOLO sobre plan base
Los recordatorios adicionales no llevan comisión del aliado.

## Gestión en app
- Gestionado en `Gestion.jsx` (tab Aliados): CRUD completo con editor de horario.
- Configuración de comisiones en `Configuracion.jsx`.

## Pendiente
- Tabla `comisiones` por servicio con estado pagada/pendiente — no existe aún.
- Los beneficios entregados no tienen registro formal en DB.
