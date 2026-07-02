-- 025_memoriales.sql — Memorial "Camino al Cielo" (video animado por servicio).
-- Diagnóstico y decisiones: docs/Memorial_Canva_Diagnostico.md
-- Motor de render: Remotion self-host en orbit-backend (NO Canva Enterprise).
-- Disparador de candidatura: servicios.fecha_imagenes_recibidas IS NOT NULL
--   y el plan NO está en la lista de excluidos (config MEMORIAL.planes_excluidos).
-- Acceso: SOLO vía orbit-backend (conexión postgres directa). El frontend NO
--   consulta esta tabla por PostgREST → RLS habilitado sin policies (deny-all).

BEGIN;

CREATE TABLE IF NOT EXISTS public.memoriales (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servicio_id    uuid NOT NULL UNIQUE REFERENCES public.servicios(id) ON DELETE CASCADE,
  estado         text NOT NULL DEFAULT 'GENERANDO'
                   CHECK (estado IN ('GENERANDO','GENERADO','APROBADO','PUBLICADO','ERROR','DESCARTADO')),
  mascota_nombre text,
  fecha_texto    text,                 -- fecha tal como se muestra en la pieza
  formato        text DEFAULT '1080x1350',
  archivo_path   text,                 -- ruta relativa dentro del volumen de memoriales
  error          text,                 -- último error de render (si estado = ERROR)
  instagram_url  text,                 -- enlace de la publicación (lo pega el humano)
  intentos       integer NOT NULL DEFAULT 0,
  generado_por   uuid REFERENCES public.personal(id),
  aprobado_por   uuid REFERENCES public.personal(id),
  publicado_por  uuid REFERENCES public.personal(id),
  generado_en    timestamptz,
  aprobado_en    timestamptz,
  publicado_en   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memoriales_estado ON public.memoriales (estado);

-- RLS: sin policies → PostgREST (anon/authenticated) no puede leer ni escribir.
-- El backend entra como 'postgres' (bypassa RLS). Coherente con la directriz de
-- "permisos en el backend, no RLS" para módulos nuevos.
ALTER TABLE public.memoriales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.memoriales FROM anon, authenticated;

COMMENT ON TABLE public.memoriales IS
  'Memorial animado por servicio (Remotion self-host). Acceso solo vía orbit-backend.';

-- ── Configuración editable del módulo ────────────────────────────────────────
INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
  ('MEMORIAL', 'activo', 'true'::jsonb,
   'Interruptor general del módulo de memoriales.'),
  ('MEMORIAL', 'planes_excluidos', '["ANGEL","DESAMPARADO"]'::jsonb,
   'Códigos de plan que NO llevan memorial. El resto sí.'),
  ('MEMORIAL', 'formato', '"1080x1350"'::jsonb,
   'Resolución de salida. 1080x1350 = feed 4:5. (1080x1920 = Reels/Historias).'),
  ('MEMORIAL', 'frase', '"Siempre en nuestro corazón"'::jsonb,
   'Frase inferior de la pieza.')
ON CONFLICT (modulo, clave) DO NOTHING;

COMMIT;
