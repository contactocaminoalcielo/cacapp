-- ============================================================================
-- 052 — Recordatorio "Foto para el cofre" (planes EXCLUSIVO_*_SIN_REC)
-- Fecha: 2026-07-15
--
-- Los planes exclusivos "sin recordatorios" (EXCLUSIVO_PRESENCIAL_SIN_REC,
-- EXCLUSIVO_VIDEOLLAMADA_SIN_REC) no traen recordatorios, pero el cofre SÍ lleva
-- una foto de la mascota. Para que ese pedido de foto fluya por TODO el pipeline
-- existente (primer contacto → portal → Producción → entrega) sin casos
-- especiales, se modela como un recordatorio de catálogo que el job de imágenes
-- auto-adjunta (origen PLAN, precio 0). Ver regla David 2026-07-15.
--
-- categoria 'fisico': el cofre es físico y alguien en Producción debe colocar la
-- foto. requiere_imagen=true, 1 foto, no solo_nombre → el portal la pide.
-- precio_base 0: no altera dinero (ya viene incluida en el plan exclusivo).
--
-- Idempotente (no re-inserta si ya existe por nombre). Aplicar por SSH→psql.
-- ============================================================================

INSERT INTO public.recordatorios
  (nombre, descripcion, categoria, requiere_imagen, solo_nombre, precio_base, max_fotos, campos_texto)
SELECT 'Foto para el cofre',
       'Foto de la mascota para el cofre del plan exclusivo',
       'fisico', true, false, 0, 1, '[]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.recordatorios WHERE nombre = 'Foto para el cofre'
);
