-- ============================================================================
-- 171 — "Esperan respuesta de coordinación": la alerta cuando el agente escala
-- ----------------------------------------------------------------------------
-- Por qué (reporte de coordinación, 23-sep): una clínica con la recogida
-- confirmada a las 4:20 pidió pasarla a las 5:00. El agente le dijo que
-- coordinación le respondía… y lo único que hizo fue poner una ETIQUETA. La
-- etiqueta solo se ve entrando a /whatsapp y filtrando por Novedades, así que
-- nadie se enteró de que había alguien esperando.
--
-- Qué se agrega:
--   1. `whatsapp_etiquetas.alerta` — qué tan fuerte avisa una etiqueta cuando la
--      pone el AGENTE (nunca cuando la pone una persona):
--        NULL       → no avisa (Cotización, Servicio en curso, …)
--        ESPERA     → franja arriba; a los 10 min sin respuesta, pantalla completa
--        INMEDIATA  → pantalla completa desde el primer momento
--      Es un dato, como el resto del catálogo: se cambia con un UPDATE, sin
--      desplegar.
--   2. `whatsapp_esperas` — UNA fila por cada vez que el agente deja a alguien
--      esperando. No se deriva de `whatsapp_conversacion_etiquetas.creado_en`
--      a propósito: esa fila no se renueva cuando el agente repite la etiqueta
--      (el upsert solo toca `motivo`), y como casi nadie las quita, una
--      URGENTE_TECNICO de la semana pasada haría pasar por vieja una espera de
--      hace un minuto.
--      Se CIERRA sola cuando una persona responde en esa conversación desde
--      Orbit (lo decide el backend al listar, mirando `enviado_por`), o a mano
--      con "Ya lo resolví" — que deja quién y cuándo.
--   3. La etiqueta REPROGRAMAR_RECOGIDA del agente de veterinarias: el caso que
--      originó esto no tenía una etiqueta propia.
--
-- Aditiva e idempotente. Aplicar en VPS (Contabo):
--   cat migrations/171_whatsapp_esperas_coordinacion.sql | \
--     ssh -i ~/.ssh/orbit_deploy -o BatchMode=yes root@13.140.139.61 \
--     "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -"
-- 🪤 Orden: migración → backend → frontend. El backend nuevo lee `alerta`; sin
--    la columna, `etiquetar()` fallaría y el agente dejaría de etiquetar.
-- ============================================================================
BEGIN;

-- ── 1. Nivel de alerta por etiqueta ─────────────────────────────────────────
ALTER TABLE public.whatsapp_etiquetas
  ADD COLUMN IF NOT EXISTS alerta text
  CHECK (alerta IN ('ESPERA', 'INMEDIATA'));

COMMENT ON COLUMN public.whatsapp_etiquetas.alerta IS
  'Si la pone el AGENTE, abre una espera de coordinación. ESPERA = franja arriba y pantalla completa a los 10 min sin respuesta; INMEDIATA = pantalla completa ya. NULL = no avisa.';

-- La clínica está esperando en la puerta, o la recogida cambia hoy: no espera
-- diez minutos.
UPDATE public.whatsapp_etiquetas SET alerta = 'INMEDIATA'
 WHERE clave IN ('URGENTE_TECNICO');

-- Alguien quedó esperando a una persona. `SOLICITUD` NO está aquí: esa ya tiene
-- su columna en el Kanban y es trabajo de otra pantalla.
UPDATE public.whatsapp_etiquetas SET alerta = 'ESPERA'
 WHERE clave IN ('RECLAMO', 'FUERA_COBERTURA', 'CONVENIO', 'SIN_RESPUESTA',
                 'FALLO_AGENTE', 'AUDIO_O_IMAGEN', 'BUCLE',
                 'FAM_ASESOR', 'FAM_RECLAMO')
   AND alerta IS NULL;

-- ── 2. La etiqueta del caso que originó esto ────────────────────────────────
-- La `descripcion` es el criterio que lee el agente: le dice qué NO hacer.
INSERT INTO public.whatsapp_etiquetas (agente_id, clave, nombre, grupo, color, orden, descripcion, alerta)
SELECT a.id, 'REPROGRAMAR_RECOGIDA', 'Cambiar hora o cancelar recogida', 'NOVEDAD', '#E11D48', 1,
       'La clínica pide cambiar la hora o el día de una recogida que ya está programada o confirmada, o cancelarla. Tú NO puedes confirmar el cambio: dile que coordinación lo confirma en unos minutos y pon esta etiqueta con la hora nueva que pidieron en el motivo (ej: "de 4:20 pm a 5:00 pm, mascota LUNA").',
       'INMEDIATA'
  FROM public.agente_wa a
 WHERE a.clave = 'VETERINARIAS'
ON CONFLICT (agente_id, clave) DO UPDATE
   SET alerta = EXCLUDED.alerta, activo = true;

-- ── 3. Las esperas ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_esperas (
  id              bigserial PRIMARY KEY,
  phone_number_id text NOT NULL,
  contacto        text NOT NULL,
  -- La que la abrió o la última que la subió de nivel.
  etiqueta_id     integer REFERENCES public.whatsapp_etiquetas(id) ON DELETE SET NULL,
  nivel           text NOT NULL CHECK (nivel IN ('ESPERA', 'INMEDIATA')),
  motivo          text,
  abierta_en      timestamptz NOT NULL DEFAULT now(),
  cerrada_en      timestamptz,
  -- RESPUESTA = una persona contestó en el hilo · MANUAL = "Ya lo resolví".
  cierre          text CHECK (cierre IN ('RESPUESTA', 'MANUAL')),
  cerrada_por     uuid REFERENCES public.personal(id) ON DELETE SET NULL,
  CONSTRAINT whatsapp_esperas_conversacion_fkey
    FOREIGN KEY (phone_number_id, contacto)
    REFERENCES public.whatsapp_contactos (phone_number_id, contacto) ON DELETE CASCADE,
  CONSTRAINT whatsapp_esperas_cierre_coherente
    CHECK ((cerrada_en IS NULL) = (cierre IS NULL))
);

-- Una sola espera ABIERTA por conversación: si el agente vuelve a escalar
-- mientras siguen esperando, es la misma espera (se actualiza el motivo y, si
-- toca, sube de nivel) — el reloj NO vuelve a cero.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_espera_abierta
  ON public.whatsapp_esperas (phone_number_id, contacto)
  WHERE cerrada_en IS NULL;

-- Para medir después cuánto se tardó coordinación en responder.
CREATE INDEX IF NOT EXISTS idx_wa_esperas_abierta_en
  ON public.whatsapp_esperas (abierta_en DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_esperas TO orbit_backend;
GRANT USAGE, SELECT ON SEQUENCE public.whatsapp_esperas_id_seq         TO orbit_backend;
REVOKE ALL ON TABLE public.whatsapp_esperas FROM anon, authenticated;

COMMIT;
