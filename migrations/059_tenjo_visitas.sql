-- 059_tenjo_visitas.sql
-- Tenjo: agenda de visitas de clientes a la planta.
--
-- El coordinador agenda la visita (mascota + fecha + hora + novedades) y la
-- comparte en el mensaje del grupo operativo junto con los procesos de la
-- jornada. El operario ve en Orbit la agenda del día — con el cubículo donde
-- está cada mascota (catálogo de la migración 055) — y marca la visita como
-- realizada o registra la novedad de cierre.
--
-- El cubículo NO se guarda aquí: se deriva en el momento de la consulta desde
-- lotes_tenjo_items (cubiculo_id activo, cubiculo_liberado_en IS NULL), igual
-- que la ocupación del mapa. Guardarlo duplicaría estado físico.
--
-- Todo aditivo y re-ejecutable.

CREATE TABLE IF NOT EXISTS public.visitas_tenjo (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servicio_id    uuid NOT NULL REFERENCES public.servicios(id),
  fecha_visita   date NOT NULL,
  hora_visita    time,
  novedades      text,          -- indicaciones al agendar (qué preparar, quién viene…)
  estado         text NOT NULL DEFAULT 'PROGRAMADA'
                 CHECK (estado IN ('PROGRAMADA', 'REALIZADA', 'CANCELADA')),
  novedad_cierre text,          -- lo que reporta el operario al cerrar la visita
  realizada_en   timestamptz,
  realizada_por  uuid REFERENCES public.personal(id),
  creado_por     uuid REFERENCES public.personal(id),
  created_at     timestamptz DEFAULT now()
);

COMMENT ON TABLE public.visitas_tenjo IS
  'Visitas de clientes a la planta de Tenjo. Se agendan desde la pestaña Visitas del módulo Tenjo; el operario las ve el día de la visita con el cubículo actual de la mascota (derivado de lotes_tenjo_items).';
COMMENT ON COLUMN public.visitas_tenjo.novedades IS
  'Indicaciones registradas al agendar (visible para el operario y en el mensaje del grupo).';
COMMENT ON COLUMN public.visitas_tenjo.novedad_cierre IS
  'Novedad registrada por el operario al marcar la visita como realizada o cancelada.';

CREATE INDEX IF NOT EXISTS idx_visitas_tenjo_fecha
  ON public.visitas_tenjo (fecha_visita, estado);
CREATE INDEX IF NOT EXISTS idx_visitas_tenjo_servicio
  ON public.visitas_tenjo (servicio_id);

-- ─── GRANTs + RLS (patrón del proyecto: PostgREST + policy auth_full) ────────
GRANT ALL ON TABLE public.visitas_tenjo TO postgres, anon, authenticated, service_role;

ALTER TABLE public.visitas_tenjo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_full ON public.visitas_tenjo;
CREATE POLICY auth_full ON public.visitas_tenjo
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- PostgREST cachea el esquema: sin esto el embed visitas_tenjo(...) da PGRST200
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN:
--   SELECT count(*) FROM visitas_tenjo;                       -- 0 al aplicar
--   \d visitas_tenjo                                          -- columnas + checks
--   SELECT polname FROM pg_policy WHERE polrelid = 'public.visitas_tenjo'::regclass;
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.visitas_tenjo;
-- ============================================================================
