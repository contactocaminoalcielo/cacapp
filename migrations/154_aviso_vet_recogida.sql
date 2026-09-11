-- 154_aviso_vet_recogida.sql
-- Aviso automático a la veterinaria cuando el técnico da su hora de llegada.
--
-- Pedido de David (2026-09-11): al iniciar ruta, el técnico ya pone la hora
-- estimada (`recogidas.hora_programada`, migración 045). Hasta hoy eso solo
-- levantaba un toast en el Kanban con un `wa.me` que el coordinador tenía que
-- tocar a mano — si nadie estaba mirando, la clínica no se enteraba. Ahora sale
-- solo, por la LÍNEA DE VETERINARIAS, en el mismo instante en que confirma la hora.
--
-- Decisiones cerradas con David antes de escribir esto:
--  · Solo cuando la recogida es EN la clínica (`recogidas.tipo_lugar =
--    'CLINICA_ALIADA'`). Un servicio referido por una vet pero recogido en casa
--    de la familia NO avisa: la vet no está en esa puerta. Medido sobre 90 días:
--    786 recogidas en clínica contra 41 a domicilio con aliado.
--  · Va al WhatsApp del aliado (`aliados.whatsapp`) — es el número que ya
--    conversa con la línea de veterinarias, así el aviso cae en el hilo que
--    existe y no abre uno nuevo. Si falta, se cae a `recogidas.contacto_telefono`.
--    Cobertura: 243 de 244 aliados activos tienen `whatsapp`.
--
-- Estas columnas son la traza del aviso Y su candado de idempotencia: el envío
-- se "reclama" poniendo `aviso_vet_enviado_en` con un UPDATE condicionado a que
-- esté NULL, así un doble toque del técnico o un reintento con mala señal no
-- le manda dos mensajes a la clínica. Si Meta rechaza, se devuelve a NULL y el
-- motivo queda en `aviso_vet_error` (mismo criterio que `planta_elecciones`).

BEGIN;
SET LOCAL lock_timeout = '5s';

-- `recogidas` tiene un AFTER UPDATE (`trg_gestionar_comision`) que solo hace algo
-- cuando `estado` pasa a COMPLETADA. Escribir estas columnas no lo dispara:
-- verificado leyendo `fn_gestionar_comision_recogida` antes de añadirlas.
ALTER TABLE public.recogidas
  ADD COLUMN IF NOT EXISTS aviso_vet_enviado_en timestamptz,
  ADD COLUMN IF NOT EXISTS aviso_vet_destino    varchar(20),
  ADD COLUMN IF NOT EXISTS aviso_vet_mensaje_id text,
  ADD COLUMN IF NOT EXISTS aviso_vet_error      text;

COMMENT ON COLUMN public.recogidas.aviso_vet_enviado_en
  IS 'Cuándo salió el aviso de hora estimada a la veterinaria. Se reclama ANTES de enviar (UPDATE ... WHERE aviso_vet_enviado_en IS NULL) para que dos toques no manden dos mensajes; si el envío falla vuelve a NULL.';
COMMENT ON COLUMN public.recogidas.aviso_vet_destino
  IS 'Número al que se envió, tal y como se resolvió en ese momento. Guardarlo evita reconstruirlo después: el WhatsApp del aliado puede cambiar.';
COMMENT ON COLUMN public.recogidas.aviso_vet_mensaje_id
  IS 'wa_message_id de Meta. Es la llave para cruzar con whatsapp_mensajes y ver si la clínica lo leyó.';
COMMENT ON COLUMN public.recogidas.aviso_vet_error
  IS 'Motivo del último intento fallido (plantilla no aprobada, número inválido, cupo de Meta). NULL cuando salió bien.';

-- Lo que va a preguntar coordinación: qué avisos fallaron. Son la minoría dentro
-- de la tabla → índice parcial.
CREATE INDEX IF NOT EXISTS idx_recogidas_aviso_vet_error
  ON public.recogidas (created_at DESC)
  WHERE aviso_vet_error IS NOT NULL;

-- ─── Configuración del módulo ───────────────────────────────────────────────
-- `activo` arranca en FALSE a propósito: la plantilla `aviso_recogida_vet` se
-- creó en la WABA de veterinarias (596644673438490) el 2026-09-11 y entró en
-- PENDING. Encenderla antes de que Meta la apruebe haría que cada inicio de ruta
-- gastara un intento para recibir "la plantilla está PENDING". Se enciende con:
--   UPDATE public.config_operativa SET valor = 'true'::jsonb
--    WHERE modulo = 'AVISO_VET_RECOGIDA' AND clave = 'activo';
INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
  ('AVISO_VET_RECOGIDA', 'activo', 'false'::jsonb,
   'Interruptor del aviso de hora estimada a la veterinaria al iniciar ruta.'),
  ('AVISO_VET_RECOGIDA', 'plantilla',
   '{"nombre":"aviso_recogida_vet","idioma":"es_MX","categoria":"UTILITY","vars":["tecnico","mascota","hora"]}'::jsonb,
   'Plantilla HSM de la WABA de veterinarias. `vars` son los huecos CON NOMBRE (parameter_format NAMED). NULL → no se envía nada.')
ON CONFLICT (modulo, clave) DO NOTHING;

COMMIT;

-- ── Verificación ────────────────────────────────────────────────────────────
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'recogidas' AND column_name LIKE 'aviso_vet%' ORDER BY 1;
-- SELECT clave, valor FROM public.config_operativa WHERE modulo = 'AVISO_VET_RECOGIDA';
--
-- ── Reversa ─────────────────────────────────────────────────────────────────
--   BEGIN;
--     ALTER TABLE public.recogidas
--       DROP COLUMN IF EXISTS aviso_vet_enviado_en,
--       DROP COLUMN IF EXISTS aviso_vet_destino,
--       DROP COLUMN IF EXISTS aviso_vet_mensaje_id,
--       DROP COLUMN IF EXISTS aviso_vet_error;
--     DELETE FROM public.config_operativa WHERE modulo = 'AVISO_VET_RECOGIDA';
--   COMMIT;
--   NOTIFY pgrst, 'reload schema';
