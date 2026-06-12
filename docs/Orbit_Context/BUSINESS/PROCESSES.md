# PROCESSES.md — Procesos principales Orbit

## 1. Proceso general de servicio (flujo completo)
1. Recepción de solicitud (presencial, llamada, formulario web).
2. Registro o búsqueda del cliente.
3. Registro o búsqueda de la mascota.
4. Selección del plan y cálculo de precio.
5. Confirmación de datos, pago parcial o completo.
6. Definición de dirección y logística de recogida.
7. Asignación de técnico.
8. Confirmación al cliente (WhatsApp).
9. **Recolección** → estado `EN_RECOGIDA`.
10. Ingreso a **Cuarto Frío** → estado `EN_CUARTO_FRIO`.
11. Ingreso a **Producción** según plan → estado `EN_PROCESO`.
12. Gestión de fotografías para recordatorios (si aplica).
13. **Diseño de recordatorios** → estado `EN_PRODUCCION`.
14. Aprobación del cliente.
15. Producción física/digital de recordatorios.
16. Todo listo → estado `LISTO`.
17. Programación y **Entrega** → estado `EN_ENTREGA`.
18. Evidencia de entrega.
19. Cierre operativo → estado `ENTREGADO`.
20. Seguimiento o encuesta NPS.

## 2. Proceso de solicitud web (formulario público)
Entrada: cliente completa formulario en `/solicitud`.
Responsable de conversión: COORDINADOR o ADMIN.
Salida: servicio registrado en sistema.

Pasos:
1. Cliente completa wizard 4 pasos: Propietario → Mascota → Plan → Recogida.
2. INSERT en `solicitudes_servicio` con estado `PENDIENTE`.
3. En Kanban, columna "Solicitudes" (dorada) muestra cards pendientes.
4. Coordinador abre modal de conversión: revisa datos, completa técnico + acompañamiento + pago.
5. Sistema crea: cliente + mascota + servicio + recogida → marca solicitud `CONVERTIDO`.
6. Si se descarta → estado `DESCARTADO`.

## 3. Proceso de recolección
Entrada: servicio confirmado con técnico asignado.
Responsables: coordinador, técnico.
Salida: mascota en cuarto frío, servicio listo para producción.

Estados (`recogidas.estado`):
- `Pendiente de asignación`
- `Técnico asignado`
- `Cliente informado`
- `En ruta`
- `Recolectado`
- `Novedad`
- `Cancelado`

## 4. Proceso de cuarto frío
Entrada: mascota recolectada.
Responsables: técnico, operario, coordinador.
Salida: mascota asignada a nevera, lista para ingresar a producción.

Acciones clave:
- Registrar ingreso con nevera asignada.
- Reporte diario del estado de neveras (N1–N6).
- Registrar salida al enviar a producción.

## 5. Proceso de producción
Entrada: servicio desde cuarto frío.
Responsables: producción/planta.
Salida: proceso finalizado, habilitado para entrega o recordatorios.

Ramas:
- Cremación individual/grupal.
- Aquamación.
- Compostaje grupal (módulo Tenjo).
- Compostaje individual.
- Cementerio.

Estados sugeridos por rama:
- `Pendiente`
- `En proceso`
- `En secado` (si aplica — compostaje)
- `Reporte generado`
- `Finalizado`
- `Novedad`

## 6. Proceso de diseño y recordatorios
Entrada: servicio con recordatorios personalizados incluidos en plan o adicionales.
Responsables: asesor (fotos), diseñador, cliente (aprobación).
Salida: recordatorios aprobados y listos para producción física.

Estados en `servicio_recordatorios.estado` (implementados):
- `PENDIENTE`
- `EN_PROCESO`
- `LISTO`
- `ENTREGADO`
- `NA`

Estados granulares (a implementar si se requiere trazabilidad de aprobación):
- Pendiente de fotos → Fotos recibidas → Pendiente elección cliente → Autorizado elección interna → En diseño → Enviado a aprobación → Ajustes solicitados → Aprobado → Finalizado

## 7. Proceso de entrega
Entrada: servicio en estado `LISTO`, componentes validados.
Responsables: coordinador, mensajero, técnico.
Salida: servicio cerrado con evidencia.

Estados sugeridos:
- `Pendiente de programación`
- `Programada`
- `En ruta`
- `Entregada parcial`
- `Entregada completa`
- `Novedad`
- `Cerrada`

## 8. Proceso veterinarias/aliados
1. Registro del aliado con modalidad de comisión.
2. Asociación de servicios referidos (`aliado_origen_id` en servicio).
3. Cálculo de comisiones según plan, volumen mensual y VIP.
4. Seguimiento de volumen mensual.
5. Clasificación VIP si supera umbral de política activa.
6. Entrega de beneficios o materiales (registro pendiente en DB).
7. Reporte de resultados.

## 9. Cancelación de servicios (implementado 2026-06-12)
Entrada: servicio en cualquier estado activo (no ENTREGADO ni CANCELADO).
Responsables: solo COORDINADOR o ADMIN, desde el modal de detalle del Kanban.
Salida: servicio en estado `CANCELADO` con trazabilidad completa, datos intactos.

Flujo:
1. Botón "Cancelar servicio" → modal con motivo obligatorio (Cliente canceló /
   Servicio duplicado / Error en datos / No se pudo contactar / Cambio de decisión / Otro)
   y observación opcional. Advertencia ámbar si el proceso ya inició (etapa > EN_RECOGIDA).
2. Al confirmar: `servicios.estado='CANCELADO'` + `cancelado_en/por`, `motivo_cancelacion`,
   `observacion_cancelacion`, `etapa_cancelacion` + novedad NOTA en historial +
   notificación al técnico asignado si lo hay.
3. Nada se borra: evidencias, recibos, novedades y datos quedan para auditoría.

Reglas:
- Cancelado sale solo de todas las listas operativas (técnicos, recibos, rutas,
  Calendario, Finanzas, Reportes ya excluían CANCELADO).
- TecnicoApp verifica contra DB antes de iniciar/completar recogida y antes de
  guardar recibo (la UI del técnico puede estar desactualizada).
- Reactivar un cancelado: solo ADMIN, vía "Reactivar a…" en el detalle.
- Auditoría: Gestion (badge Cancelado), Presequiales (tab Cancelados), banner rojo
  con motivo/fecha/usuario/etapa en el detalle del Kanban.
