-- 057: constancia de envío del contrato de afiliación al cliente.
-- WhatsApp va por wa.me (lo abre el coordinador desde la ficha); email lo manda
-- orbit-backend por SMTP con el PDF adjunto. Aquí solo queda la evidencia.
BEGIN;

ALTER TABLE public.afiliacion_contratos
  ADD COLUMN IF NOT EXISTS enviado_wa_at    timestamptz,
  ADD COLUMN IF NOT EXISTS enviado_email_at timestamptz,
  ADD COLUMN IF NOT EXISTS enviado_email_a  text;

COMMENT ON COLUMN public.afiliacion_contratos.enviado_wa_at    IS 'Última vez que el coordinador abrió wa.me con el enlace del PDF';
COMMENT ON COLUMN public.afiliacion_contratos.enviado_email_at IS 'Última vez que orbit-backend envió el PDF adjunto por correo';
COMMENT ON COLUMN public.afiliacion_contratos.enviado_email_a  IS 'Correo de destino del último envío por email';

COMMIT;
