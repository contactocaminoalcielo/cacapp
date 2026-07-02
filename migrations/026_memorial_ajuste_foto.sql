-- 026_memorial_ajuste_foto.sql — Encuadre de la foto del memorial.
-- Guarda {zoom, posX, posY} elegidos por el coordinador al generar, para que
-- la foto no salga recortada donde no debe (objectFit cover recorta por defecto).

BEGIN;

ALTER TABLE public.memoriales ADD COLUMN IF NOT EXISTS ajuste_foto jsonb;

COMMENT ON COLUMN public.memoriales.ajuste_foto IS
  'Encuadre de la foto {zoom: 1-3, posX: 0-100, posY: 0-100} usado en el render.';

COMMIT;
