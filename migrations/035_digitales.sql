-- 035_digitales.sql — Módulo "Digitales": memoriales → piezas_digitales.
-- Une las tres piezas digitales publicables de un servicio (MEMORIAL, VIDEO, SHORT)
-- en una sola tabla, agrega el registro de envíos al cliente y la config del módulo.
-- Diseño: docs/Modulo_Digitales_Diseno.md
-- El pipeline del memorial (render Remotion) NO cambia: mismas filas, mismos estados,
-- mismos archivos en el volumen.
-- Acceso: SOLO vía orbit-backend (rol postgres). RLS deny-all igual que 025.

BEGIN;

-- ── 1. memoriales → piezas_digitales ─────────────────────────────────────────
ALTER TABLE public.memoriales RENAME TO piezas_digitales;

ALTER TABLE public.piezas_digitales
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'MEMORIAL'
    CHECK (tipo IN ('MEMORIAL','VIDEO','SHORT')),
  ADD COLUMN IF NOT EXISTS plataforma text
    CHECK (plataforma IN ('INSTAGRAM','YOUTUBE')),
  ADD COLUMN IF NOT EXISTS url_publica text,           -- permalink IG o URL de YouTube
  ADD COLUMN IF NOT EXISTS publicacion_media_id text,  -- container/media id de la Graph API
  ADD COLUMN IF NOT EXISTS publicado_auto boolean NOT NULL DEFAULT false;

-- Backfill de las filas existentes (todas son memoriales de Instagram).
UPDATE public.piezas_digitales
SET plataforma = 'INSTAGRAM',
    url_publica = COALESCE(url_publica, instagram_url);

-- El enlace vive ahora en url_publica.
ALTER TABLE public.piezas_digitales DROP COLUMN instagram_url;

-- Unicidad por servicio+tipo (antes: una sola pieza por servicio).
ALTER TABLE public.piezas_digitales DROP CONSTRAINT memoriales_servicio_id_key;
ALTER TABLE public.piezas_digitales
  ADD CONSTRAINT piezas_digitales_servicio_tipo_key UNIQUE (servicio_id, tipo);

-- Estados: + PENDIENTE (pieza esperada sin nada, p. ej. video aún sin enlace)
--          + PUBLICANDO (contenedor de Instagram creado, esperando a Meta).
ALTER TABLE public.piezas_digitales DROP CONSTRAINT memoriales_estado_check;
ALTER TABLE public.piezas_digitales
  ADD CONSTRAINT piezas_digitales_estado_check CHECK (estado IN
    ('PENDIENTE','GENERANDO','GENERADO','APROBADO','PUBLICANDO','PUBLICADO','ERROR','DESCARTADO'));

COMMENT ON TABLE public.piezas_digitales IS
  'Piezas digitales publicables por servicio (MEMORIAL render propio → Instagram; VIDEO/SHORT de Canva → YouTube). Acceso solo vía orbit-backend.';

-- ── 2. Registro de envíos al cliente ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.digitales_envios (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servicio_id  uuid NOT NULL REFERENCES public.servicios(id) ON DELETE CASCADE,
  canal        text NOT NULL DEFAULT 'WHATSAPP_MANUAL'
                 CHECK (canal IN ('WHATSAPP_MANUAL','ZOLUTIUM')),
  telefono     text,
  enlaces      jsonb NOT NULL,        -- [{tipo, url}] tal como se enviaron
  mensaje      text,
  enviado_por  uuid REFERENCES public.personal(id),
  enviado_en   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_digitales_envios_servicio
  ON public.digitales_envios (servicio_id);

ALTER TABLE public.digitales_envios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.digitales_envios FROM anon, authenticated;

COMMENT ON TABLE public.digitales_envios IS
  'Cada envío de enlaces digitales al cliente (quién, cuándo, qué enlaces, canal). Al registrarse, el backend marca ENTREGADO en servicio_recordatorios.';

-- ── 3. Configuración del módulo ──────────────────────────────────────────────
-- Mapa tipo de pieza → recordatorio del catálogo (define qué espera cada servicio).
INSERT INTO public.config_operativa (modulo, clave, valor, descripcion)
SELECT 'DIGITALES', 'recordatorios_tipo',
  jsonb_build_object(
    'MEMORIAL', (SELECT id FROM public.recordatorios WHERE nombre = 'Memorial digital'     LIMIT 1),
    'VIDEO',    (SELECT id FROM public.recordatorios WHERE nombre = 'Video conmemorativo'  LIMIT 1),
    'SHORT',    (SELECT id FROM public.recordatorios WHERE nombre = 'Short YouTube'        LIMIT 1)
  ),
  'Mapa tipo de pieza digital → id del recordatorio del catálogo.'
ON CONFLICT (modulo, clave) DO NOTHING;

INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
  ('DIGITALES', 'mensaje_cliente',
   '"Hola 💛 Somos Camino al Cielo. Te compartimos los recuerdos digitales de {mascota}:\n\n{enlaces}\n\nEsperamos que estos recuerdos acompañen su memoria. Un abrazo 🕊️"'::jsonb,
   'Plantilla del mensaje de WhatsApp al cliente. Variables: {mascota}, {enlaces}.'),
  ('DIGITALES', 'caption_instagram',
   '"En memoria de {mascota} 🕊️ Siempre en nuestro corazón.\n\n#CaminoAlCielo #MemorialDeMascotas #Mascotas #Bogota"'::jsonb,
   'Caption de la publicación automática en Instagram. Variable: {mascota}.')
ON CONFLICT (modulo, clave) DO NOTHING;

COMMIT;
