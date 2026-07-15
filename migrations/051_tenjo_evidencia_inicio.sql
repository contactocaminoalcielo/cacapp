-- 051_tenjo_evidencia_inicio.sql
-- Evidencias obligatorias al iniciar el proceso en la Jornada de Tenjo.
--
-- El operario, al dar "Iniciar proceso" en cualquier mascota individual, debe
-- cargar fotos antes de poder iniciar (compuerta dura):
--   - Cremación individual:  evidencia del altar + evidencia de ingreso al horno.
--   - Compostaje individual: dos fotos del cubículo.
-- Se guardan etiquetadas en evidencia_inicio (jsonb) y además se copian al array
-- evidencia_urls existente (galería / validación de cierre).
--
-- Aditivo. DEFAULT '{}' → las filas existentes quedan sin evidencia de inicio.

ALTER TABLE public.lotes_tenjo_items
  ADD COLUMN IF NOT EXISTS evidencia_inicio jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.lotes_tenjo_items.evidencia_inicio IS
  'Fotos etiquetadas cargadas al iniciar el proceso. Cremación: {altar,horno}; Compostaje: {cubiculo_1,cubiculo_2}. También se copian a evidencia_urls.';

-- GRANTs a nivel tabla ya cubren la columna; RLS auth_full deja escribir al OPERARIO.

-- Verificación:
--   select id, estado, evidencia_inicio from lotes_tenjo_items
--     where evidencia_inicio <> '{}'::jsonb order by fecha_inicio_proceso desc limit 10;

-- ROLLBACK:
--   ALTER TABLE public.lotes_tenjo_items DROP COLUMN IF EXISTS evidencia_inicio;
