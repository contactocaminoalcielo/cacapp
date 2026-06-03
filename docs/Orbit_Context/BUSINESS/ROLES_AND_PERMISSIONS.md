# ROLES_AND_PERMISSIONS.md — Roles y permisos

## Roles reales en DB (`roles_personal`)

| ID | Nombre | Descripción operativa |
|----|--------|-----------------------|
| 1 | COORDINADOR | Gestión operativa completa: asigna técnicos, supervisa estados, acceso a Kanban y módulos operativos |
| 2 | TECNICO | Acceso a TecnicoApp: recogidas y entregas asignadas, carga evidencias, reportes cuarto frío |
| 3 | MENSAJERO | Similar a técnico; realiza entregas |
| 4 | PRODUCTOR | Módulo producción: cremación, aquamación, compostaje, cementerio |
| 5 | OPERARIO | Apoyo operativo en producción o cuarto frío |
| 6 | ADMIN | Acceso completo. Configura usuarios, planes, reglas, reportes, auditoría |

## Roles documentados (pendientes de implementar en DB)

Estos roles existen en el diseño pero no tienen entrada en `roles_personal` aún:

- **Asesor** — Crea clientes, mascotas y servicios. Registra datos de atención. Gestiona fotos. No modifica producción cerrada.
- **Diseñador** — Consulta recordatorios asignados, carga versiones, actualiza estados de diseño.
- **Entregas** — Programa y confirma entregas, carga evidencias, registra parciales.
- **Comercial veterinarias** — Gestiona aliados, consulta servicios referidos, revisa comisiones.
- **Auditor/Gerencia** — Consulta reportes, indicadores y trazabilidad. Solo lectura.

## Permisos por rol actual

### ADMIN
- Acceso completo a todos los módulos.
- Puede ver y modificar cualquier entidad.
- Acceso a Configuración, Finanzas, Reportes.

### COORDINADOR
- Kanban: todas las columnas incluyendo "Solicitudes".
- Registro de servicios.
- CuartoFrío: CRUD completo.
- Gestión (aliados, configuración operativa).
- Calendario.

### TECNICO / MENSAJERO
- TecnicoApp exclusivamente.
- Ve solo servicios asignados a él.
- Carga evidencias de recogida y entrega.
- Reporte diario cuarto frío.

### PRODUCTOR / OPERARIO
- Módulo Producción y Tenjo (compostaje/cenizas).
- Registra estados, fechas, novedades.

## Regla de acceso por rol
El `AuthContext` normaliza: `personalData.rol = data.roles_personal?.nombre` (string: "ADMIN", "COORDINADOR", etc.)
Usar este valor para condicionales de acceso en componentes.
