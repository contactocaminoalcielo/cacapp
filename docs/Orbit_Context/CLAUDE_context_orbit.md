# CLAUDE.md — Contexto maestro para Claude Code

## Instrucción principal
Antes de escribir código, Claude debe leer y entender la documentación del proyecto Orbit.
La fuente de verdad del negocio está en `docs/Orbit_Context/`.
La fuente de verdad de la implementación real está en la DB de Supabase y en la memoria de sesión (`memory/`).

**Ambas fuentes deben leerse juntas.** Los docs describen el modelo conceptual; la memoria describe lo que realmente está en DB y código.

## Documentos obligatorios de lectura
1. `PROJECT_CONTEXT.md`
2. `BUSINESS/BUSINESS_RULES.md`
3. `BUSINESS/PROCESSES.md`
4. `TECHNICAL/DATA_MODEL.md` ← nombres reales de PKs y columnas
5. `BUSINESS/ROLES_AND_PERMISSIONS.md`
6. `MODULES/SERVICIOS.md` ← estados reales en DB
7. `MODULES/CUARTO_FRIO.md` ← módulo no evidente desde el negocio
8. `MODULES/DISENOS.md`
9. `MODULES/PRODUCCION.md`
10. `MODULES/ENTREGAS.md`
11. `MODULES/VETERINARIAS.md` ← implementado como "Aliados"

## Memoria de sesión (leer en paralelo con los docs)
- `memory/feedback_db_corrections.md` — **LEER PRIMERO** antes de cualquier query
- `memory/orbit_spec_gaps.md` — brechas entre spec y realidad implementada
- `memory/project_context.md` — stack, credenciales, paleta, lógica de negocio
- `memory/feedback_supabase_mcp.md` — MCP Supabase, token, DDL con curl

## Forma de trabajo esperada
- No asumir reglas de negocio no documentadas.
- Preguntar cuando falte información.
- Priorizar trazabilidad, auditoría y consistencia operacional.
- No crear funcionalidades aisladas sin validar impacto en proceso, datos y roles.
- Todo cambio técnico debe respetar las reglas de negocio.
- Un cambio nunca vive solo — rastrear impacto en módulos, vistas y flujos relacionados.

## Convenciones críticas
- PKs: `id_cliente`, `id_mascota`, `id_aliado` (UUID). El resto usan `id`.
- Enums: respetar SCREAMING_SNAKE_CASE para estados de servicios; para mascotas usar mayúscula inicial ("Macho", "Hembra", "Pequeño"...).
- Aliados ≠ Veterinarias: usar siempre `aliados` / `aliado_origen_id`.
- PDF: jsPDF directo. NUNCA html2canvas (Tailwind v4 oklch lo rompe).
- Tailwind v4: `@theme` en index.css. No existe tailwind.config.js.

## Cómo mantener estos docs actualizados
Al finalizar cada sesión de desarrollo, identificar qué cambió en:
- DB (tablas nuevas, columnas, enums) → actualizar `DATA_MODEL.md`
- Flujos o procesos nuevos → actualizar `PROCESSES.md`
- Reglas de negocio nuevas → actualizar `BUSINESS_RULES.md`
- Módulos nuevos o modificados → actualizar el `.md` del módulo
- Roles o permisos → actualizar `ROLES_AND_PERMISSIONS.md`
