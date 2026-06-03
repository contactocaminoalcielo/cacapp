# ADR-002 — Sincronización docs con implementación real

## Fecha
2026-06-03

## Decisión
Los documentos de `docs/Orbit_Context/` se actualizan para reflejar la implementación real de CACapp, no solo el modelo conceptual original.

## Contexto
Al leer los docs originales junto con la memoria de sesiones previas, se detectaron 12 brechas entre el spec y lo implementado:
- Aliados ≠ Veterinarias (nomenclatura diferente en DB)
- Estados de servicios en SCREAMING_SNAKE_CASE con estados extra (EN_CUARTO_FRIO, LISTO)
- Módulo Cuarto Frío completo en código, invisible en docs
- Roles reales (6) vs roles en spec (9), con diferencias de nombre
- PKs no estándar (id_cliente, id_mascota, id_aliado)
- Tabla Comisión no existe; lógica calculada on-the-fly

## Cambios realizados en esta sesión
- `ARCHITECTURE.md` — Stack definitivo, decisiones tomadas, estructura de archivos
- `DATA_MODEL.md` — PKs reales, columnas correctas, tablas nuevas (neveras, solicitudes_servicio, cuarto_frio)
- `ROLES_AND_PERMISSIONS.md` — Roles reales de DB + roles pendientes de implementar
- `MODULES/SERVICIOS.md` — Estados reales, flujo de Registro.jsx, flujo de solicitud web
- `MODULES/VETERINARIAS.md` — Renombrado a Aliados, campos reales, lógica de comisiones
- `MODULES/CUARTO_FRIO.md` — Nuevo módulo documentado
- `BUSINESS/PROCESSES.md` — Cuarto frío como etapa, proceso de solicitud web
- `CLAUDE_context_orbit.md` — Instrucciones actualizadas + guía de mantenimiento continuo

## Consecuencia
Los docs ahora son confiables como fuente de verdad técnica y de negocio.
Mantener este contrato: **al finalizar cada sesión de desarrollo, actualizar los docs afectados.**
