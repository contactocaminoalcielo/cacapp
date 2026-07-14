-- ============================================================================
-- 044 — Seguimiento automático de solicitudes de imágenes (2º y 3er contacto)
-- Fecha: 2026-07-14
--
-- Problema: la solicitud de imágenes se envía UNA vez (contacto 1, autorizado a
-- mano en la bandeja) y si el cliente no carga nada, nadie vuelve a insistir. No
-- hay cadencia ni trazabilidad de cuántas veces se contactó a cada persona.
--
-- Decisiones de David (2026-07-14):
--   - Contacto 1: SIGUE siendo manual (POR_VALIDAR → alguien autoriza). No cambia.
--   - Contacto 2: +3 días hábiles  DESDE EL ENVÍO DEL CONTACTO 1  (automático).
--   - Contacto 3: +15 días hábiles DESDE EL ENVÍO DEL CONTACTO 1  (automático).
--     ⚠️ Ancla ÚNICA = fecha de envío del contacto 1 (no encadenado). Así la fecha
--     de cada contacto es reproducible: recalcularla siempre da lo mismo.
--   - Tras el 3º sin respuesta: solicitud → SIN_RESPUESTA + alerta operativa para
--     llamar. El enlace del portal SIGUE VIVO (el cliente puede cargar tarde).
--
-- Días hábiles = public.fn_sumar_dias_habiles (respeta la tabla `festivos`, la
-- misma que gobierna el SLA de reportes grupales — migración 006/007).
--
-- NOTA DESPLIEGUE: migración MANUAL por SSH→psql en Contabo. Aditiva y reversible.
-- orbit_backend (BYPASSRLS) ya tiene DML por ALTER DEFAULT PRIVILEGES (migr. 004).
-- ============================================================================

-- ─── 0. Hoy en Bogotá (las columnas DATE se comparan en hora local, no UTC) ──
-- El contenedor corre en UTC: CURRENT_DATE adelanta un día entre 19:00 y 23:59
-- Bogotá y haría "vencer" un contacto antes de tiempo. Ver migraciones 036/037.
CREATE OR REPLACE FUNCTION public.fn_hoy_bogota()
RETURNS date LANGUAGE sql STABLE AS $func$
  SELECT (now() AT TIME ZONE 'America/Bogota')::date;
$func$;

-- ─── 1. Bitácora de contactos: UNA fila por (solicitud, número de contacto) ──
-- Esta tabla es el registro de verdad de "a quién se le escribió, cuándo, con qué
-- plantilla y qué dijo Meta". El índice único (solicitud_id, numero) es la
-- garantía DURA de no duplicar: aunque el cron corra dos veces, aunque alguien
-- dispare el job a mano, el 2º contacto NO puede salir dos veces.
CREATE TABLE IF NOT EXISTS public.solicitud_imagenes_contactos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id     uuid NOT NULL REFERENCES public.solicitudes_imagenes(id) ON DELETE CASCADE,
  servicio_id      uuid NOT NULL REFERENCES public.servicios(id),
  numero           int  NOT NULL CHECK (numero BETWEEN 1 AND 3),
  estado           text NOT NULL DEFAULT 'ENVIANDO'
                     CHECK (estado IN ('ENVIANDO','ENVIADO','ERROR')),
  automatico       boolean NOT NULL DEFAULT true,   -- false = lo forzó una persona
  plantilla        text,
  idioma           text,
  whatsapp_destino text,
  mensaje          text,                            -- texto resuelto que vio el cliente
  message_id       text,
  contact_id       text,
  estado_meta      text,                            -- sent|delivered|read|failed (verificación post-envío)
  ultimo_error     text,
  programado_para  date,                            -- día hábil en que le tocaba
  enviado_en       timestamptz,
  autorizado_por   uuid REFERENCES public.personal(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Anti-duplicado duro (la regla que hace el flujo "sin errores")
CREATE UNIQUE INDEX IF NOT EXISTS uq_sic_solicitud_numero
  ON public.solicitud_imagenes_contactos (solicitud_id, numero);

CREATE INDEX IF NOT EXISTS idx_sic_servicio ON public.solicitud_imagenes_contactos (servicio_id);
CREATE INDEX IF NOT EXISTS idx_sic_estado   ON public.solicitud_imagenes_contactos (estado);

DROP TRIGGER IF EXISTS trg_sic_updated ON public.solicitud_imagenes_contactos;
CREATE TRIGGER trg_sic_updated
  BEFORE UPDATE ON public.solicitud_imagenes_contactos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 2. solicitudes_imagenes: estado de cierre + pausa por caso ─────────────
ALTER TABLE public.solicitudes_imagenes
  ADD COLUMN IF NOT EXISTS seguimiento_pausado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS motivo_cierre       text,
  ADD COLUMN IF NOT EXISTS fecha_cierre        date;

COMMENT ON COLUMN public.solicitudes_imagenes.seguimiento_pausado IS
  'El coordinador excluye este caso de la cadencia automática (cliente sensible, ya se habló por teléfono, etc.). No impide la carga por el portal.';
COMMENT ON COLUMN public.solicitudes_imagenes.motivo_cierre IS
  'Por qué dejó de perseguirse: AGOTADO (3 contactos sin respuesta) | FUERA_DE_VENTANA (el servicio ya no admite carga) | SIN_WHATSAPP.';

-- Nuevo estado terminal SIN_RESPUESTA (agotada la cadencia, sin carga del cliente)
ALTER TABLE public.solicitudes_imagenes DROP CONSTRAINT IF EXISTS solicitudes_imagenes_estado_check;
ALTER TABLE public.solicitudes_imagenes
  ADD CONSTRAINT solicitudes_imagenes_estado_check
  CHECK (estado IN ('POR_VALIDAR','ENVIADO','RECIBIDO','ERROR','CANCELADO','SIN_RESPUESTA'));

-- El índice de "una solicitud activa por servicio" debe incluir SIN_RESPUESTA:
-- una solicitud agotada sigue siendo LA solicitud de ese servicio (el portal la
-- cierra a RECIBIDO si el cliente carga tarde). Sin esto, el servicio podría
-- recibir una segunda solicitud y duplicar contactos.
DROP INDEX IF EXISTS public.uq_solicitud_imagenes_servicio_activa;
CREATE UNIQUE INDEX uq_solicitud_imagenes_servicio_activa
  ON public.solicitudes_imagenes (servicio_id)
  WHERE estado IN ('POR_VALIDAR','ENVIADO','ERROR','SIN_RESPUESTA');

-- ─── 3. Backfill: el contacto 1 de las solicitudes YA enviadas ──────────────
-- Sin esto, el seguimiento no tendría fecha ancla para las solicitudes vivas.
-- Se reconstruye desde la evidencia que ya guarda solicitudes_imagenes.
INSERT INTO public.solicitud_imagenes_contactos
  (solicitud_id, servicio_id, numero, estado, automatico, plantilla, idioma,
   whatsapp_destino, message_id, contact_id, programado_para, enviado_en, autorizado_por)
SELECT s.id, s.servicio_id, 1, 'ENVIADO', false,
       'solicitud_imagenes_cliente', 'es_MX',
       s.whatsapp_destino, s.message_id, s.contact_id,
       COALESCE(s.fecha_envio::date, s.fecha_solicitud),
       COALESCE(s.fecha_envio, s.fecha_solicitud::timestamptz),
       s.autorizado_por
FROM public.solicitudes_imagenes s
WHERE s.fecha_envio IS NOT NULL
  AND s.estado IN ('ENVIADO','RECIBIDO')
ON CONFLICT (solicitud_id, numero) DO NOTHING;

-- ─── 4. GRANTs + RLS (mismo patrón que la tabla madre) ──────────────────────
GRANT ALL ON TABLE public.solicitud_imagenes_contactos TO postgres, anon, authenticated, service_role;
ALTER TABLE public.solicitud_imagenes_contactos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_full" ON public.solicitud_imagenes_contactos;
CREATE POLICY "auth_full" ON public.solicitud_imagenes_contactos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- anon NO accede (la bitácora es interna; el portal del cliente no la lee).

-- ─── 5. Configuración del seguimiento ───────────────────────────────────────
-- ⚠️ ARRANQUE ESCALONADO (decisión David 2026-07-14): al encender esto hay 105
-- clientes que recibieron el contacto 1 hace semanas y nunca cargaron — su
-- recordatorio sigue frenado. SÍ se recuperan (arranque_desde = null: sin corte),
-- pero de a `max_envios_por_corrida` por día hábil: reciben UN mensaje (el de 3er
-- contacto, porque sus 15 días hábiles ya vencieron) y luego se cierran a
-- SIN_RESPUESTA con alerta para llamar. Sin este tope, el primer cron dispararía
-- >100 plantillas en minutos y Meta puede marcar la línea.
--   → Para NO tocar el backlog: arranque_desde = '"2026-07-14"' (solo lo nuevo).
--
-- ⚠️ ARMADO: `plantilla_contacto_2/3` arrancan en null → el job NO envía nada
-- (deja el contacto programado y lo reporta). Sembrar el nombre real de la
-- plantilla aprobada en Zolutium es el acto deliberado que arma la automatización.
INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
 ('SOLICITUDES_IMAGENES','seguimiento_activo','true','Cadencia automática de 2º y 3er contacto (kill-switch: false la apaga entera)'),
 ('SOLICITUDES_IMAGENES','dias_contacto_2','3','Días HÁBILES desde el envío del contacto 1 para el 2º contacto'),
 ('SOLICITUDES_IMAGENES','dias_contacto_3','15','Días HÁBILES desde el envío del contacto 1 para el 3er contacto'),
 ('SOLICITUDES_IMAGENES','dias_cierre','3','Días hábiles tras el 3er contacto sin respuesta → SIN_RESPUESTA + alerta'),
 ('SOLICITUDES_IMAGENES','arranque_desde','null','Fecha de corte: no perseguir contactos 1 anteriores. null = recuperar también el backlog (escalonado por max_envios_por_corrida)'),
 ('SOLICITUDES_IMAGENES','max_envios_por_corrida','20','Tope de mensajes por corrida del job (protege la línea WABA y escalona el backlog)'),
 -- DESARMADAS a propósito (null = el job NO envía; deja el contacto programado y
 -- lo reporta). Las plantillas aprobadas hoy NO llevan el enlace, y sin enlace el
 -- cliente no tiene por dónde cargar: cada portal es único (/#/fotos/CODIGO).
 -- Se arman con el UPDATE de abajo cuando Meta apruebe la variable del enlace.
 ('SOLICITUDES_IMAGENES','plantilla_contacto_2','null',
  '2º contacto — armar con: servicio_recordarimg · vars {{1}} mascota, {{2}} enlace'),
 ('SOLICITUDES_IMAGENES','plantilla_contacto_3','null',
  '3er contacto — armar con: alerta_fin_de_contacto_individuales · vars {{1}} propietario, {{2}} mascota, {{3}} enlace')
ON CONFLICT (modulo, clave) DO NOTHING;

-- ============================================================================
-- CÓMO SE ARMA — ejecutar SOLO cuando Meta apruebe las plantillas CON la variable
-- del enlace. `vars` debe ser el orden EXACTO de las variables del cuerpo aprobado
-- (tokens válidos: nombre | propietario | mascota | enlace | codigo).
--
--   UPDATE public.config_operativa
--      SET valor = '{"nombre":"servicio_recordarimg","idioma":"es_MX","categoria":"UTILITY","vars":["mascota","enlace"]}'
--    WHERE modulo='SOLICITUDES_IMAGENES' AND clave='plantilla_contacto_2';
--
--   UPDATE public.config_operativa
--      SET valor = '{"nombre":"alerta_fin_de_contacto_individuales","idioma":"es_MX","categoria":"UTILITY","vars":["propietario","mascota","enlace"]}'
--    WHERE modulo='SOLICITUDES_IMAGENES' AND clave='plantilla_contacto_3';
--
-- Apagar todo (kill-switch):
--   UPDATE public.config_operativa SET valor='false'
--    WHERE modulo='SOLICITUDES_IMAGENES' AND clave='seguimiento_activo';
--
-- ROLLBACK:
--   DELETE FROM public.config_operativa WHERE modulo='SOLICITUDES_IMAGENES'
--     AND clave IN ('seguimiento_activo','dias_contacto_2','dias_contacto_3','dias_cierre',
--                   'arranque_desde','max_envios_por_corrida','plantilla_contacto_2','plantilla_contacto_3');
--   DROP TABLE IF EXISTS public.solicitud_imagenes_contactos;
--   ALTER TABLE public.solicitudes_imagenes DROP COLUMN IF EXISTS seguimiento_pausado,
--     DROP COLUMN IF EXISTS motivo_cierre, DROP COLUMN IF EXISTS fecha_cierre;
--   ALTER TABLE public.solicitudes_imagenes DROP CONSTRAINT IF EXISTS solicitudes_imagenes_estado_check;
--   ALTER TABLE public.solicitudes_imagenes ADD CONSTRAINT solicitudes_imagenes_estado_check
--     CHECK (estado IN ('POR_VALIDAR','ENVIADO','RECIBIDO','ERROR','CANCELADO'));
--   DROP INDEX IF EXISTS public.uq_solicitud_imagenes_servicio_activa;
--   CREATE UNIQUE INDEX uq_solicitud_imagenes_servicio_activa ON public.solicitudes_imagenes (servicio_id)
--     WHERE estado IN ('POR_VALIDAR','ENVIADO','ERROR');
--   DROP FUNCTION IF EXISTS public.fn_hoy_bogota();
-- ============================================================================
