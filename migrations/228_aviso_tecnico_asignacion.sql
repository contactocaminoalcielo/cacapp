-- 228_aviso_tecnico_asignacion.sql
-- Aviso automático al TÉCNICO cuando se le asigna un servicio.
--
-- REPORTE ORBIT 2026-11-26 (Tablero, urgencia crítica/alta): «una vez se asigne
-- el servicio al técnico correspondiente, el sistema deberá enviarle
-- automáticamente una notificación con toda la información necesaria para la
-- ejecución del servicio».
--
-- Lo que había: al cambiar el técnico en la ficha del Kanban se creaba una fila
-- en `notificaciones`… que el técnico NUNCA ve (la app de campo no tiene la
-- campanita del AppShell). Al registrar un servicio o convertir una solicitud
-- con técnico ya puesto, nada. El mensaje completo existía solo como el botón
-- manual «Notificar técnico» (wa.me), que alguien tenía que acordarse de tocar.
--
-- Decisiones de David (2026-11-27):
--  · WhatsApp automático por la LÍNEA DE VETERINARIAS (plantilla UTILITY).
--  · Con el COBRO (valor a cobrar al cliente / a la vet y medio acordado).
--  · Si el técnico responde, el agente de IA no le contesta (cambio en el
--    backend, agente-wa.js: números del personal activo → lo atiende una persona).
--
-- `avisos_tecnico` es la traza Y el candado: el envío se RESERVA (ENVIANDO)
-- antes de ir a Meta, así un doble clic o dos pestañas no le mandan dos mensajes
-- al mismo técnico por el mismo servicio. Reasignar a OTRO técnico sí avisa.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.avisos_tecnico (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servicio_id    uuid NOT NULL REFERENCES public.servicios(id) ON DELETE CASCADE,
  -- SET NULL: si se borra a la persona, el registro de que se le avisó queda.
  tecnico_id     uuid REFERENCES public.personal(id) ON DELETE SET NULL,
  estado         text NOT NULL DEFAULT 'ENVIANDO'
                 CHECK (estado IN ('ENVIANDO', 'ENVIADO', 'ERROR')),
  -- Dónde se asignó: REGISTRO, SOLICITUD, FICHA o RELANZAR (desde /automatizaciones).
  origen         text,
  destino        varchar(20),
  mensaje_id     text,
  error          text,
  disparado_por  uuid REFERENCES public.personal(id) ON DELETE SET NULL,
  enviado_en     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_avisos_tecnico_servicio
  ON public.avisos_tecnico (servicio_id, tecnico_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_avisos_tecnico_fecha
  ON public.avisos_tecnico (created_at DESC);

DROP TRIGGER IF EXISTS trg_avisos_tecnico_updated ON public.avisos_tecnico;
CREATE TRIGGER trg_avisos_tecnico_updated BEFORE UPDATE ON public.avisos_tecnico
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.avisos_tecnico IS
  'WhatsApp automático al técnico al asignarle un servicio (migr. 228). ENVIANDO se reserva ANTES de ir a Meta: es el candado contra el doble envío.';
COMMENT ON COLUMN public.avisos_tecnico.destino IS
  'Número al que se envió, tal como se resolvió en ese momento (el WhatsApp del técnico puede cambiar).';
COMMENT ON COLUMN public.avisos_tecnico.mensaje_id IS
  'wa_message_id de Meta: la llave para cruzar con whatsapp_mensajes y saber si le llegó.';

-- Lee y escribe el backend (rol orbit_backend); el frontend solo lee.
GRANT SELECT, INSERT, UPDATE ON TABLE public.avisos_tecnico TO orbit_backend;
GRANT SELECT ON TABLE public.avisos_tecnico TO authenticated, service_role;
ALTER TABLE public.avisos_tecnico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_read ON public.avisos_tecnico;
CREATE POLICY auth_read ON public.avisos_tecnico
  FOR SELECT TO authenticated USING (true);

-- ── Configuración ───────────────────────────────────────────────────────────
-- `activo` arranca en FALSE: la plantilla `asignacion_servicio_tecnico` hay que
-- crearla en la WABA de veterinarias y esperar a que Meta la apruebe. Se
-- enciende desde /automatizaciones («Aviso al técnico al asignarle un servicio»).
INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
  ('AVISO_TECNICO_ASIGNACION', 'activo', 'false'::jsonb,
   'Interruptor del WhatsApp automático al técnico cuando se le asigna un servicio (migr. 228).'),
  ('AVISO_TECNICO_ASIGNACION', 'plantilla',
   '{"nombre":"asignacion_servicio_tecnico","idioma":"es_MX","categoria":"UTILITY"}'::jsonb,
   'Plantilla de la WABA de veterinarias. Huecos CON NOMBRE: tecnico, mascota, plan, propietario, contacto, direccion, hora, indicaciones, cobro. NULL → no se envía nada.')
ON CONFLICT (modulo, clave) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 🪤 ORDEN: migración → backend (scp + docker compose build) → frontend (git push).
-- Sin la migración, el backend responde «no disponible» y la asignación sigue
-- normal (el aviso es best-effort: nunca bloquea guardar el técnico).
--
-- ── Verificación ────────────────────────────────────────────────────────────
-- SELECT clave, valor FROM public.config_operativa WHERE modulo = 'AVISO_TECNICO_ASIGNACION';
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'avisos_tecnico';   -- t
--
-- ── Encender (cuando Meta apruebe la plantilla) ─────────────────────────────
-- Desde /automatizaciones, o:
--   UPDATE public.config_operativa SET valor = 'true'::jsonb
--    WHERE modulo = 'AVISO_TECNICO_ASIGNACION' AND clave = 'activo';
--
-- ── Reversa ─────────────────────────────────────────────────────────────────
--   BEGIN;
--     DROP TABLE IF EXISTS public.avisos_tecnico;
--     DELETE FROM public.config_operativa WHERE modulo = 'AVISO_TECNICO_ASIGNACION';
--   COMMIT;
--   NOTIFY pgrst, 'reload schema';
