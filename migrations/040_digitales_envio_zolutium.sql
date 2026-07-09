-- 040 — Envío automático de digitales por Zolutium (plantillas HSM aprobadas)
-- El backend envía la plantilla aprobada y persiste la evidencia (message_id,
-- contact_id, estado) en digitales_envios, igual que reportes_grupales_envios.
-- Plantillas reales aprobadas en Meta/Zolutium (2026-07-09):
--   envio_digitales_individual (es_MX) — planes con los 3 digitales:
--     {{1}} video · {{2}} short · {{3}} memorial
--   envio_digitales (es) — básicos/ecogrupales, solo memorial: {{1}} memorial
BEGIN;

-- ── 1. Evidencia del envío en digitales_envios ───────────────────────────────
ALTER TABLE public.digitales_envios
  ADD COLUMN IF NOT EXISTS estado     text NOT NULL DEFAULT 'ENVIADO',
  ADD COLUMN IF NOT EXISTS error      text,
  ADD COLUMN IF NOT EXISTS plantilla  text,
  ADD COLUMN IF NOT EXISTS message_id text,
  ADD COLUMN IF NOT EXISTS contact_id text;

ALTER TABLE public.digitales_envios
  ADD CONSTRAINT digitales_envios_estado_check CHECK (estado IN ('ENVIADO', 'ERROR'));

COMMENT ON COLUMN public.digitales_envios.estado IS
  'ENVIADO = entregado a GHL/Zolutium (hay message_id) · ERROR = el envío automático falló (ver error). Los registros manuales (WHATSAPP_MANUAL) siempre quedan ENVIADO.';
COMMENT ON COLUMN public.digitales_envios.plantilla IS
  'Nombre de la plantilla HSM usada en el envío automático (NULL en envíos manuales).';

-- ── 2. Configuración del envío automático ────────────────────────────────────
INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
  ('DIGITALES', 'usar_plantilla', 'true'::jsonb,
   'Envío automático por Zolutium con plantilla aprobada. false = solo envío manual (wa.me).'),
  ('DIGITALES', 'plantilla_completos',
   '{"nombre": "envio_digitales_individual", "idioma": "es_MX", "categoria": "UTILITY"}'::jsonb,
   'Plantilla HSM para servicios con los 3 digitales. Variables: {{1}} video, {{2}} short, {{3}} memorial.'),
  ('DIGITALES', 'plantilla_memorial',
   '{"nombre": "envio_digitales", "idioma": "es", "categoria": "UTILITY"}'::jsonb,
   'Plantilla HSM para servicios con solo memorial (básicos/ecogrupales). Variable: {{1}} memorial.')
ON CONFLICT (modulo, clave) DO NOTHING;

COMMIT;
