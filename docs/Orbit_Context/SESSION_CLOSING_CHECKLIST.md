# SESSION_CLOSING_CHECKLIST.md — Cierre de sesión

Al finalizar cada sesión de desarrollo, recorrer esta lista antes de cerrar.
Toma menos de 5 minutos si se hace en el momento; cuesta horas reconstruir después.

---

## 1. DB — ¿Cambiaron tablas o columnas?
- [ ] Tabla nueva → agregar a `TECHNICAL/DATA_MODEL.md`
- [ ] Columna nueva o renombrada → actualizar la entidad correspondiente en `DATA_MODEL.md`
- [ ] Enum nuevo o valor nuevo → actualizar `DATA_MODEL.md` + `memory/feedback_db_corrections.md`
- [ ] PK o FK no estándar → agregar a la sección "PKs que NO son lo que parecen"

## 2. Flujos o procesos — ¿Cambió cómo funciona algo?
- [ ] Paso nuevo en el flujo de servicio → actualizar `BUSINESS/PROCESSES.md`
- [ ] Proceso nuevo (formulario, conversión, integración) → agregar sección en `PROCESSES.md`
- [ ] Estados nuevos o renombrados → actualizar `MODULES/SERVICIOS.md` + `PROCESSES.md`

## 3. Reglas de negocio — ¿Se definió o cambió alguna regla?
- [ ] Regla nueva → agregar en `BUSINESS/BUSINESS_RULES.md` con código RNxxx
- [ ] Regla que estaba en "pendientes" y ya se resolvió → moverla a la sección correspondiente
- [ ] Regla que aplica a precios/comisiones → actualizar también `MODULES/VETERINARIAS.md`

## 4. Módulos — ¿Se creó o modificó un módulo?
- [ ] Módulo nuevo → crear `MODULES/NOMBRE.md` con propósito, funciones, estados, riesgos
- [ ] Módulo modificado en comportamiento → actualizar su `.md`
- [ ] Componente nuevo relevante para el contexto → agregar en `ARCHITECTURE.md`

## 5. Roles o permisos — ¿Cambió quién puede hacer qué?
- [ ] Rol nuevo en DB → agregar a tabla en `ROLES_AND_PERMISSIONS.md`
- [ ] Permiso nuevo por rol → actualizar sección del rol afectado

## 6. Brechas resueltas — ¿Se cerró alguna brecha del spec?
- [ ] Revisar `memory/orbit_spec_gaps.md` — marcar o eliminar brechas ya resueltas
- [ ] Si se tomó una decisión sobre una brecha pendiente → crear `DECISIONS/ADR-00X.md`

## 7. Memoria de sesión — ¿Hay algo que no debo olvidar?
- [ ] Bug crítico encontrado y corregido → agregar a `memory/feedback_db_corrections.md`
- [ ] Feedback de David sobre cómo trabajar → agregar a `memory/feedback_*.md`
- [ ] Cambio de estado del proyecto → actualizar `memory/project_status.md`

---

## Formato sugerido para el resumen de sesión en `project_status.md`

```
## Estado al YYYY-MM-DD — Sesión N

### Implementado esta sesión:
- [descripción breve por ítem]

### DB changes:
- [tabla.columna tipo acción] ✅

### Archivos nuevos:
- src/pages/NombrePagina.jsx — descripción

### Archivos modificados:
- src/pages/NombrePagina.jsx — qué cambió

### Pendientes conocidos:
- [ítem pendiente]
```
