-- 054_tenjo_cubiculos_catalogo.sql
-- Tenjo: catálogo oficial de cubículos de compostaje individual + asignación.
--
-- Problema: `lotes_tenjo_items.cubiculo_codigo` (migración 008) es TEXTO LIBRE.
-- En producción ya derivó a 8 grafías distintas para el mismo esquema mental:
--   Amarillo-p-8 · Azul-g-1 · "Azul p-14" · Azul-p-5 · Azul-p-7 · Rojo-M-1
--   · "Verde g-9" · N-2
-- Con texto libre no hay forma de saber qué cubículo está ocupado ni de impedir
-- que dos mascotas caigan en el mismo.
--
-- Solución: catálogo cerrado de los 218 cubículos reales de la planta
-- (zona por color → talla P/M/G → número), y el item apunta al cubículo por FK.
--
-- Nomenclatura oficial (boceto de planta, 2026-07-16):
--   AZUL      P 1-15  M 1-15  G 1-15   = 45
--   AMARILLO  P 1-15  M 1-15  G 1-15   = 45
--   ROJO      P 1-14  M 1-14  G 1-14   = 42
--   VERDE     P 1-14  M 1-14  G 1-14   = 42
--   GRIS      P 1-8   M 1-5   G 1-11   = 24
--   NARANJA   M 1-12                   = 12
--   MORADO    G 1-8                    =  8
--                                       ───
--                                       218
--
-- OCUPACIÓN: no existe columna de estado. Un cubículo está ocupado si y solo si
-- hay un item que lo apunta y aún no fue liberado (`cubiculo_liberado_en IS NULL`).
-- Se deriva del hecho físico, nunca de un estado que se pueda desincronizar
-- (mismo patrón de bug que ya costó 3 incidentes: gates por `servicios.estado`).
-- La liberación es MANUAL: la hace el operario desde el mapa cuando el cubículo
-- queda físicamente libre — decisión de David 2026-07-16.
--
-- Todo aditivo y re-ejecutable. `cubiculo_codigo` se CONSERVA como texto
-- histórico: los códigos que no calzan con el esquema (N-2) quedan con
-- cubiculo_id NULL y visibles en la UI para que David los corrija.

-- ─── 1. Catálogo de cubículos ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cubiculos (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zona    varchar NOT NULL CHECK (zona IN ('MORADO','GRIS','NARANJA','VERDE','AMARILLO','AZUL','ROJO')),
  talla   varchar NOT NULL CHECK (talla IN ('P','M','G')),
  numero  smallint NOT NULL CHECK (numero > 0),
  -- Código canónico derivado: imposible que derive como el texto libre anterior.
  codigo  text GENERATED ALWAYS AS (zona || '-' || talla || '-' || lpad(numero::text, 2, '0')) STORED,
  activo  boolean NOT NULL DEFAULT true,
  notas   text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT uq_cubiculo_zona_talla_numero UNIQUE (zona, talla, numero)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cubiculos_codigo ON public.cubiculos (codigo);

COMMENT ON TABLE public.cubiculos IS
  'Catálogo oficial de cubículos de compostaje individual de la planta de Tenjo (218). Zona = color físico, talla = P/M/G, numero = posición dentro de la zona+talla.';
COMMENT ON COLUMN public.cubiculos.codigo IS
  'Código canónico derivado (ZONA-T-NN, ej. AZUL-P-05). Generado: no se escribe a mano.';
COMMENT ON COLUMN public.cubiculos.activo IS
  'false = cubículo fuera de servicio (dañado, en mantenimiento). No se puede asignar, pero conserva su historia.';

-- ─── 2. Asignación del cubículo en el item del lote ─────────────────────────
ALTER TABLE public.lotes_tenjo_items
  ADD COLUMN IF NOT EXISTS cubiculo_id           uuid REFERENCES public.cubiculos(id),
  ADD COLUMN IF NOT EXISTS cubiculo_liberado_en  timestamptz,
  ADD COLUMN IF NOT EXISTS cubiculo_liberado_por uuid REFERENCES public.personal(id);

COMMENT ON COLUMN public.lotes_tenjo_items.cubiculo_id IS
  'Cubículo del catálogo donde quedó la mascota. Reemplaza al texto libre cubiculo_codigo.';
COMMENT ON COLUMN public.lotes_tenjo_items.cubiculo_liberado_en IS
  'Instante en que el operario liberó el cubículo. NULL = el cubículo sigue OCUPADO por esta mascota.';
COMMENT ON COLUMN public.lotes_tenjo_items.cubiculo_liberado_por IS
  'Operario que liberó el cubículo.';
COMMENT ON COLUMN public.lotes_tenjo_items.cubiculo_codigo IS
  'HISTÓRICO (texto libre, pre-054). La fuente de verdad es cubiculo_id → cubiculos.codigo. Solo se conserva para auditar los códigos viejos que no calzaban con el catálogo.';

-- ─── 3. Seed de los 218 cubículos reales ────────────────────────────────────
INSERT INTO public.cubiculos (zona, talla, numero)
SELECT z.zona, z.talla, n
FROM (VALUES
  ('AZUL','P',15), ('AZUL','M',15), ('AZUL','G',15),
  ('AMARILLO','P',15), ('AMARILLO','M',15), ('AMARILLO','G',15),
  ('ROJO','P',14), ('ROJO','M',14), ('ROJO','G',14),
  ('VERDE','P',14), ('VERDE','M',14), ('VERDE','G',14),
  ('GRIS','P',8), ('GRIS','M',5), ('GRIS','G',11),
  ('NARANJA','M',12),
  ('MORADO','G',8)
) AS z(zona, talla, tope),
LATERAL generate_series(1, z.tope) AS n
ON CONFLICT (zona, talla, numero) DO NOTHING;

-- ─── 4. Migración de los códigos viejos que sí calzan ───────────────────────
-- Parsea "Amarillo-p-8", "Azul p-14", "Verde g-9", "Rojo-M-1"… y los enlaza al
-- catálogo. Lo que no case (N-2, o cualquier grafía rara) queda con cubiculo_id
-- NULL: no se pierde nada y la UI lo marca como "código histórico" a revisar.
UPDATE public.lotes_tenjo_items i
SET cubiculo_id = c.id
FROM public.cubiculos c
WHERE i.cubiculo_id IS NULL
  AND i.cubiculo_codigo IS NOT NULL
  AND c.zona   = (regexp_match(upper(btrim(i.cubiculo_codigo)), '^([A-Z]+)'))[1]
  AND c.talla  = (regexp_match(upper(btrim(i.cubiculo_codigo)), '[^A-Z0-9]([PMG])[^A-Z0-9]'))[1]
  AND c.numero = ((regexp_match(btrim(i.cubiculo_codigo), '(\d+)\s*$'))[1])::smallint;

-- ─── 5. Compuerta dura: un cubículo, una mascota ────────────────────────────
-- Hace IMPOSIBLE a nivel de DB que dos mascotas ocupen el mismo cubículo a la
-- vez. Se crea DESPUÉS del backfill para que los datos viejos no lo revienten.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cubiculo_ocupado
  ON public.lotes_tenjo_items (cubiculo_id)
  WHERE cubiculo_id IS NOT NULL AND cubiculo_liberado_en IS NULL;

CREATE INDEX IF NOT EXISTS idx_lotes_tenjo_items_cubiculo
  ON public.lotes_tenjo_items (cubiculo_id);

-- ─── 6. GRANTs + RLS (patrón del proyecto: PostgREST + policy auth_full) ────
GRANT ALL ON TABLE public.cubiculos TO postgres, anon, authenticated, service_role;

ALTER TABLE public.cubiculos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_full ON public.cubiculos;
CREATE POLICY auth_full ON public.cubiculos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- VERIFICACIÓN (esperado: 218 cubículos, 7 items enlazados, 1 sin enlazar "N-2")
--   SELECT count(*) FROM cubiculos;
--   SELECT zona, talla, count(*) FROM cubiculos GROUP BY 1,2 ORDER BY 1,2;
--   SELECT cubiculo_codigo, (SELECT codigo FROM cubiculos c WHERE c.id = i.cubiculo_id)
--     FROM lotes_tenjo_items i WHERE cubiculo_codigo IS NOT NULL ORDER BY 1;
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS public.uq_cubiculo_ocupado;
--   DROP INDEX IF EXISTS public.idx_lotes_tenjo_items_cubiculo;
--   ALTER TABLE public.lotes_tenjo_items
--     DROP COLUMN IF EXISTS cubiculo_liberado_por,
--     DROP COLUMN IF EXISTS cubiculo_liberado_en,
--     DROP COLUMN IF EXISTS cubiculo_id;
--   DROP TABLE IF EXISTS public.cubiculos;
-- ============================================================================
