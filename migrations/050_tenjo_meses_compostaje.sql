-- 050_tenjo_meses_compostaje.sql
-- Duración del compostaje elegible por el operario: 2 o 3 meses.
--
-- Hasta ahora la duración estaba fija en 2 meses (MESES_COMPOST en lib/tenjo.js).
-- El operario de Tenjo ya define el cubículo al finalizar el compostaje; ahora
-- además decide si ese cubículo dura 2 o 3 meses. La fecha "listo estimado" se
-- recalcula desde fecha_compostaje_inicio + meses_compostaje.
--
-- Aditivo y con DEFAULT 2 → las filas existentes conservan el comportamiento
-- actual (2 meses). CHECK acota a los dos valores permitidos.

ALTER TABLE public.lotes_tenjo_items
  ADD COLUMN IF NOT EXISTS meses_compostaje smallint NOT NULL DEFAULT 2
    CHECK (meses_compostaje IN (2, 3));

COMMENT ON COLUMN public.lotes_tenjo_items.meses_compostaje IS
  'Duración del compostaje en meses (2 o 3), decidida por el operario al finalizar. La fecha de listo = fecha_compostaje_inicio + meses_compostaje.';

-- GRANTs a nivel tabla ya cubren la columna nueva; RLS auth_full deja escribir al OPERARIO.

-- Verificación:
--   select id, cubiculo_codigo, fecha_compostaje_inicio, meses_compostaje
--     from lotes_tenjo_items where meses_compostaje = 3 order by fecha_fin_proceso desc limit 10;

-- ROLLBACK:
--   ALTER TABLE public.lotes_tenjo_items DROP COLUMN IF EXISTS meses_compostaje;
