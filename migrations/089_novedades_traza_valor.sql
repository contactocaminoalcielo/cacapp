-- 089 · Trazabilidad del VALOR del servicio
--
-- Problema: el valor de un servicio se mueve desde varios lados (recálculo por
-- peso, cambio de plan, adicional, ítem quitado, interruptor de comisión) y
-- cada uno dejaba —cuando dejaba— una frase distinta en `descripcion`. Para
-- saber "antes valía X, por el nuevo plan pasó a Y, y hoy el total es Z" había
-- que leer texto libre, y el interruptor de comisión de Gestión no dejaba nada:
-- el valor cambiaba en silencio (así se perdió el rastro del caso BRUNO,
-- 07-08-2026, ver migración de código en lib/precios.js).
--
-- Solución: las novedades que mueven plata guardan el antes/después como
-- NÚMEROS, no como frase. La descripción sigue siendo para leer; estas columnas
-- son para mostrar la cadena del valor en la parte de pago del servicio.

ALTER TABLE public.novedades_servicio
  ADD COLUMN IF NOT EXISTS valor_antes   numeric,
  ADD COLUMN IF NOT EXISTS valor_despues numeric,
  ADD COLUMN IF NOT EXISTS motivo_valor  text;

COMMENT ON COLUMN public.novedades_servicio.valor_antes   IS 'valor_total del servicio ANTES de este cambio (NULL si la novedad no mueve el valor)';
COMMENT ON COLUMN public.novedades_servicio.valor_despues IS 'valor_total del servicio DESPUÉS de este cambio';
COMMENT ON COLUMN public.novedades_servicio.motivo_valor  IS 'PESO | PLAN | ADICIONAL | ITEM_QUITADO | COMISION | CORRECCION';

-- Solo valores válidos, y siempre en pareja: media traza no sirve para nada.
ALTER TABLE public.novedades_servicio
  DROP CONSTRAINT IF EXISTS novedades_servicio_motivo_valor_check;
ALTER TABLE public.novedades_servicio
  ADD CONSTRAINT novedades_servicio_motivo_valor_check
  CHECK (motivo_valor IS NULL OR motivo_valor IN
    ('PESO','PLAN','ADICIONAL','ITEM_QUITADO','COMISION','CORRECCION'));

ALTER TABLE public.novedades_servicio
  DROP CONSTRAINT IF EXISTS novedades_servicio_valor_par_check;
ALTER TABLE public.novedades_servicio
  ADD CONSTRAINT novedades_servicio_valor_par_check
  CHECK ((valor_antes IS NULL) = (valor_despues IS NULL));

-- Solo se consultan las filas que SÍ mueven el valor, y son pocas frente al
-- total de novedades → índice parcial.
CREATE INDEX IF NOT EXISTS idx_novedades_traza_valor
  ON public.novedades_servicio (servicio_id, created_at)
  WHERE valor_antes IS NOT NULL;

-- ── Backfill: recategorizaciones por peso ya registradas ────────────────────
-- Su texto tiene formato fijo ("valor $ 164.250 → $ 141.750 · comisión ...") y
-- es la única fuente que ya venía completa. Se capturan los DOS primeros
-- números que siguen a "valor " sin depender del carácter de flecha (el espacio
-- tras $ es U+00A0 y las miles van con punto).
WITH m AS (
  SELECT id, regexp_match(descripcion, 'valor [^0-9]*([0-9][0-9.]*)[^0-9]+([0-9][0-9.]*)') AS g
  FROM public.novedades_servicio
  WHERE tipo_novedad = 'RECATEGORIZACION_PESO' AND valor_antes IS NULL
)
UPDATE public.novedades_servicio n
   SET valor_antes   = replace(m.g[1], '.', '')::numeric,
       valor_despues = replace(m.g[2], '.', '')::numeric,
       motivo_valor  = 'PESO'
  FROM m
 WHERE m.id = n.id AND m.g IS NOT NULL;
