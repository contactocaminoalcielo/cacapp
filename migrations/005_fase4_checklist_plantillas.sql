-- ============================================================================
-- 005 — Fase 4: plantillas de checklist por variante de proceso individual
-- Fecha: 2026-06-11
--
-- Las plantillas viven en config_operativa (editables sin tocar codigo).
-- Reglas ESTRUCTURALES (no editables, viven en backend orbit-backend):
--   * responsable_proceso_id, fecha_inicio y fecha_fin obligatorios siempre
--   * minimo 1 evidencia (foto) en evidencia_urls para cerrar cualquier item
--   * confirmacion_cliente = true para variantes presencial/videollamada
-- Las plantillas agregan los campos ESPECIFICOS de cada variante.
-- ============================================================================

INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
('TENJO', 'checklist_plantillas', '{
  "INDIVIDUAL_ESTANDAR": [
    {"campo": "observaciones", "label": "Observaciones del proceso", "tipo": "texto", "obligatorio": false}
  ],
  "EXCLUSIVO_PRESENCIAL": [
    {"campo": "fecha_hora_acordada", "label": "Fecha y hora acordada con el cliente", "tipo": "texto", "obligatorio": true},
    {"campo": "asistencia_cliente", "label": "El cliente asistio al proceso", "tipo": "bool", "obligatorio": true},
    {"campo": "observacion_cierre", "label": "Observacion de cierre del acompanamiento", "tipo": "texto", "obligatorio": true}
  ],
  "EXCLUSIVO_VIDEOLLAMADA": [
    {"campo": "medio_conexion", "label": "Medio de conexion (Meet, WhatsApp, etc.)", "tipo": "texto", "obligatorio": true},
    {"campo": "hora_acordada", "label": "Hora acordada con el cliente", "tipo": "texto", "obligatorio": true},
    {"campo": "registro_ejecucion", "label": "Videollamada realizada con el cliente", "tipo": "bool", "obligatorio": true},
    {"campo": "observacion_cierre", "label": "Observacion de cierre", "tipo": "texto", "obligatorio": false}
  ],
  "COMPETS_EVIDENCIA": [
    {"campo": "evidencia_validada", "label": "Evidencia revisada y validada por coordinacion", "tipo": "bool", "obligatorio": true},
    {"campo": "observacion_final", "label": "Observacion final", "tipo": "texto", "obligatorio": false}
  ]
}'::jsonb,
'Campos de checklist por variante de proceso individual. Las reglas estructurales (responsable, fechas, evidencia minima, confirmacion cliente) las valida el backend.')
ON CONFLICT (modulo, clave) DO NOTHING;

-- ROLLBACK:
--   DELETE FROM public.config_operativa WHERE modulo='TENJO' AND clave='checklist_plantillas';
