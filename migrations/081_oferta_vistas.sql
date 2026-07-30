-- ============================================================================
-- 081 — Vistas de cada oferta (cuánta gente ABRIÓ el link y vio el anuncio)
--
-- Hasta ahora solo se sabía quién RESPONDIÓ (aceptó/rechazó), así que la
-- "conversión" se calculaba sobre los que respondieron y no sobre los que
-- realmente vieron el anuncio. Los que abren el portal y lo abandonan a mitad
-- eran invisibles: una oferta con 5 rechazos y 200 vistas silenciosas se veía
-- igual que una con 5 rechazos y 5 vistas.
--
-- Una fila por (servicio, oferta):
--   · `vistas`           → cuántas veces se abrió el portal con ese anuncio
--                          adentro (el cliente puede recargar la página).
--   · UNIQUE(servicio,oferta) → el conteo de FILAS es "a cuántos servicios
--                          distintos les llegó", que es la métrica honesta
--                          para la conversión.
--
-- La escribe el backend propio (rol postgres) desde `datosPortal`; el personal
-- solo la lee para el tablero. Igual que `oferta_respuestas`, `anon` no la toca.
--
-- Ejecutar por SSH→psql en Contabo (ver memory/ops_aplicar_migraciones_vps.md).
-- Reversible: bloque de ROLLBACK al pie.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.oferta_vistas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oferta_id        uuid NOT NULL REFERENCES public.ofertas(id)   ON DELETE CASCADE,
  servicio_id      uuid NOT NULL REFERENCES public.servicios(id) ON DELETE CASCADE,
  vistas           integer NOT NULL DEFAULT 1,
  primera_vista_en timestamptz NOT NULL DEFAULT now(),
  ultima_vista_en  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_oferta_vista_servicio UNIQUE (servicio_id, oferta_id)
);

COMMENT ON TABLE  public.oferta_vistas        IS 'Impresiones del anuncio en el portal de fotos. Una fila por (servicio, oferta): las FILAS son servicios alcanzados, `vistas` son aperturas.';
COMMENT ON COLUMN public.oferta_vistas.vistas IS 'Aperturas del portal con el anuncio incluido (el cliente puede recargar).';

CREATE INDEX IF NOT EXISTS idx_oferta_vistas_oferta   ON public.oferta_vistas (oferta_id);
CREATE INDEX IF NOT EXISTS idx_oferta_vistas_servicio ON public.oferta_vistas (servicio_id);

-- ─── GRANTs + RLS ───────────────────────────────────────────────────────────
-- Tabla creada por SQL raw: Supabase NO aplica grants automáticos.
-- El portal público NO la lee por PostgREST — la escribe el backend propio con
-- conexión directa a Postgres, así que `anon` no necesita acceso.
GRANT ALL ON TABLE public.oferta_vistas TO postgres, authenticated, service_role;

ALTER TABLE public.oferta_vistas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS oferta_vistas_auth_all ON public.oferta_vistas;

-- Las vistas las escribe el backend (rol postgres, sin RLS): el personal solo
-- necesita leerlas para el tablero de conversión.
CREATE POLICY oferta_vistas_auth_all ON public.oferta_vistas
  FOR SELECT TO authenticated USING (true);

-- ─── Semilla del histórico ──────────────────────────────────────────────────
-- Quien ya respondió una oferta, obviamente la vio. Sin esto el tablero
-- arrancaría mostrando "0 vistas, 5 respuestas", que es imposible y sugiere
-- que el contador está roto.
INSERT INTO public.oferta_vistas (oferta_id, servicio_id, vistas, primera_vista_en, ultima_vista_en)
SELECT r.oferta_id, r.servicio_id, 1, r.respondido_en, r.respondido_en
FROM public.oferta_respuestas r
ON CONFLICT (servicio_id, oferta_id) DO NOTHING;

-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   DROP TABLE IF EXISTS public.oferta_vistas;
-- ============================================================================
