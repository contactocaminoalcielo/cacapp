-- ============================================================================
-- 078 — Módulo de OFERTAS (inventario de anuncios del portal de fotos)
--
-- Una oferta = una pieza publicitaria (foto + descripción + precio) atada a un
-- recordatorio del catálogo, que se le muestra al cliente en el portal donde
-- carga las imágenes (/#/fotos/CODIGO). El cliente decide:
--   - ACEPTA  → se habilita la carga de la(s) foto(s)/textos de ESE recordatorio,
--               y al enviar el backend lo agrega como adicional al precio de
--               oferta (precio tomado de la DB, NUNCA del navegador).
--   - RECHAZA → no pasa nada; queda el registro para medir la conversión.
--
-- Reglas:
--   · Solo se muestra UNA oferta por servicio (la de menor `orden`).
--   · Solo si el plan del servicio está entre los planes elegidos de la oferta
--     (o si la oferta aplica a todos los planes).
--   · Nunca se ofrece un recordatorio que el servicio YA tiene.
--   · Nunca se vuelve a ofrecer algo ya respondido (unique servicio+oferta).
--
-- Ejecutar por SSH→psql en Contabo (ver memory/ops_aplicar_migraciones_vps.md).
-- Reversible: bloque de ROLLBACK al pie.
-- ============================================================================

BEGIN;

-- ─── Catálogo de ofertas ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ofertas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo              text    NOT NULL,
  descripcion         text,
  imagen_url          text,
  -- Qué se vende. El recordatorio manda qué se le pide al cliente
  -- (requiere_imagen / max_fotos / campos_texto) y en qué máquina se produce.
  recordatorio_id     uuid    NOT NULL REFERENCES public.recordatorios(id) ON DELETE RESTRICT,
  -- Precio REAL que se cobra si acepta. Es la única fuente de verdad del cobro.
  precio_oferta       numeric NOT NULL CHECK (precio_oferta >= 0),
  -- Precio "antes" que se muestra tachado. NULL → se usa recordatorios.precio_base.
  precio_lista        numeric CHECK (precio_lista IS NULL OR precio_lista >= 0),
  -- Menor = mayor prioridad cuando varias ofertas aplican al mismo plan.
  orden               integer NOT NULL DEFAULT 100,
  aplica_todos_planes boolean NOT NULL DEFAULT false,
  vigencia_desde      date,
  vigencia_hasta      date,
  activo              boolean NOT NULL DEFAULT true,
  creado_por          uuid REFERENCES public.personal(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ofertas_vigencia_coherente
    CHECK (vigencia_desde IS NULL OR vigencia_hasta IS NULL OR vigencia_hasta >= vigencia_desde)
);

COMMENT ON TABLE  public.ofertas               IS 'Anuncios que ve el cliente en el portal de fotos. precio_oferta es la fuente de verdad del cobro: el navegador nunca envía precios.';
COMMENT ON COLUMN public.ofertas.orden         IS 'Menor = mayor prioridad. Solo se muestra la primera oferta aplicable.';
COMMENT ON COLUMN public.ofertas.precio_lista  IS 'Precio tachado (solo display). NULL → recordatorios.precio_base.';

-- ─── En qué planes se muestra ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.oferta_planes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oferta_id  uuid NOT NULL REFERENCES public.ofertas(id) ON DELETE CASCADE,
  plan_id    uuid NOT NULL REFERENCES public.planes(id)  ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_oferta_plan UNIQUE (oferta_id, plan_id)
);

COMMENT ON TABLE public.oferta_planes IS 'Planes en los que se muestra la oferta. Vacío + aplica_todos_planes=false → la oferta no se muestra en ninguno.';

-- ─── Qué respondió cada cliente ─────────────────────────────────────────────
-- Una fila por (servicio, oferta): es a la vez el registro de conversión y el
-- candado que evita volver a ofrecer lo mismo o cobrarlo dos veces.
CREATE TABLE IF NOT EXISTS public.oferta_respuestas (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oferta_id                uuid NOT NULL REFERENCES public.ofertas(id)    ON DELETE CASCADE,
  servicio_id              uuid NOT NULL REFERENCES public.servicios(id)  ON DELETE CASCADE,
  respuesta                text NOT NULL CHECK (respuesta IN ('ACEPTADA', 'RECHAZADA')),
  -- Snapshot del precio con el que se le ofreció (la oferta puede cambiar después).
  precio_ofrecido          numeric,
  -- El adicional creado cuando aceptó (NULL si rechazó).
  servicio_recordatorio_id uuid REFERENCES public.servicio_recordatorios(id) ON DELETE SET NULL,
  respondido_en            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_oferta_respuesta_servicio UNIQUE (servicio_id, oferta_id)
);

COMMENT ON TABLE  public.oferta_respuestas                 IS 'Sí/No del cliente por oferta. El UNIQUE(servicio,oferta) es el candado anti doble cobro.';
COMMENT ON COLUMN public.oferta_respuestas.precio_ofrecido IS 'Precio mostrado y cobrado en ese momento; la oferta puede cambiar de precio después.';

CREATE INDEX IF NOT EXISTS idx_ofertas_activas         ON public.ofertas (activo, orden);
CREATE INDEX IF NOT EXISTS idx_ofertas_recordatorio    ON public.ofertas (recordatorio_id);
CREATE INDEX IF NOT EXISTS idx_oferta_planes_plan      ON public.oferta_planes (plan_id);
CREATE INDEX IF NOT EXISTS idx_oferta_resp_servicio    ON public.oferta_respuestas (servicio_id);
CREATE INDEX IF NOT EXISTS idx_oferta_resp_oferta      ON public.oferta_respuestas (oferta_id, respuesta);

-- updated_at automático (el módulo edita precios con frecuencia)
CREATE OR REPLACE FUNCTION public.fn_ofertas_touch() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ofertas_touch ON public.ofertas;
CREATE TRIGGER trg_ofertas_touch BEFORE UPDATE ON public.ofertas
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertas_touch();

-- ─── GRANTs + RLS ───────────────────────────────────────────────────────────
-- Tablas creadas por SQL raw: Supabase NO aplica grants automáticos.
-- El portal público NO lee estas tablas por PostgREST — las lee el backend
-- propio con conexión directa a Postgres, así que `anon` no necesita acceso.
GRANT ALL ON TABLE public.ofertas           TO postgres, authenticated, service_role;
GRANT ALL ON TABLE public.oferta_planes     TO postgres, authenticated, service_role;
GRANT ALL ON TABLE public.oferta_respuestas TO postgres, authenticated, service_role;

ALTER TABLE public.ofertas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oferta_planes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oferta_respuestas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ofertas_auth_all           ON public.ofertas;
DROP POLICY IF EXISTS oferta_planes_auth_all     ON public.oferta_planes;
DROP POLICY IF EXISTS oferta_respuestas_auth_all ON public.oferta_respuestas;

CREATE POLICY ofertas_auth_all ON public.ofertas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY oferta_planes_auth_all ON public.oferta_planes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- Las respuestas las escribe el backend (rol postgres, sin RLS): el personal
-- solo necesita leerlas para el tablero de conversión.
CREATE POLICY oferta_respuestas_auth_all ON public.oferta_respuestas
  FOR SELECT TO authenticated USING (true);

-- ─── Bucket público de las fotos de las ofertas ─────────────────────────────
-- El portal es anónimo: la foto del anuncio debe ser legible sin sesión.
-- No contiene datos de clientes, solo material publicitario de Camino al Cielo.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ofertas', 'ofertas', true, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = 5242880,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "ofertas_select_publico"  ON storage.objects;
DROP POLICY IF EXISTS "ofertas_insert_auth"     ON storage.objects;
DROP POLICY IF EXISTS "ofertas_update_auth"     ON storage.objects;
DROP POLICY IF EXISTS "ofertas_delete_auth"     ON storage.objects;

CREATE POLICY "ofertas_select_publico" ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'ofertas');
CREATE POLICY "ofertas_insert_auth" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'ofertas');
CREATE POLICY "ofertas_update_auth" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'ofertas');
CREATE POLICY "ofertas_delete_auth" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'ofertas');

COMMIT;

-- Recargar el esquema de PostgREST para que el frontend vea las tablas nuevas:
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK
--   BEGIN;
--     DROP POLICY IF EXISTS "ofertas_select_publico" ON storage.objects;
--     DROP POLICY IF EXISTS "ofertas_insert_auth"    ON storage.objects;
--     DROP POLICY IF EXISTS "ofertas_update_auth"    ON storage.objects;
--     DROP POLICY IF EXISTS "ofertas_delete_auth"    ON storage.objects;
--     DELETE FROM storage.buckets WHERE id = 'ofertas';   -- solo si está vacío
--     DROP TABLE IF EXISTS public.oferta_respuestas;
--     DROP TABLE IF EXISTS public.oferta_planes;
--     DROP TABLE IF EXISTS public.ofertas;
--     DROP FUNCTION IF EXISTS public.fn_ofertas_touch();
--   COMMIT;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================
