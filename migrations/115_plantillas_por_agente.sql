-- 115 — Las plantillas dejan de ser "las del .env" y pasan a ser las DEL AGENTE
--
-- Una plantilla vive en una WABA (la cuenta de WhatsApp) y se envía por UNA
-- línea. Hasta hoy las dos cosas eran constantes del servidor:
--
--   · la cuenta la fijaba `WHATSAPP_WABA_ID`
--   · la línea de salida era `WHATSAPP_ALLOWED_PHONE_IDS.split(',')[0]`
--
-- Con un solo agente eso funcionaba **por casualidad**: la primera línea de la
-- lista resulta ser la buena. Con el segundo agente —el que va a traer la otra
-- empresa— la plantilla saldría por la línea de la empresa que no es, sin dar
-- un solo error: es el mismo fallo mudo que la migración 109 vino a cerrar en
-- la bandeja (y el 6,9 % de envíos de la época de GHL).
--
-- Aquí se le da dueño a las dos cosas.

BEGIN;

-- ── 1. En qué cuenta de WhatsApp viven las plantillas de este agente ────────
--
-- NULL = la del `.env`, que es lo que hay hoy: así el agente que ya existe no
-- cambia de comportamiento hasta que alguien escriba su cuenta a mano.
--
-- ⚠️ No se deduce de `phone_number_ids` a propósito: preguntarle a Meta por la
-- WABA de una línea es una llamada más en cada listado, y si el token pierde el
-- permiso el módulo se queda sin plantillas sin decir por qué. Es un dato de
-- configuración y se guarda como tal.
ALTER TABLE public.agente_wa
  ADD COLUMN IF NOT EXISTS waba_id text;

COMMENT ON COLUMN public.agente_wa.waba_id IS
  'WABA donde viven las plantillas de este agente. NULL = WHATSAPP_WABA_ID del servidor.';

-- ── 2. Por qué línea sale una campaña ──────────────────────────────────────
--
-- Una campaña se crea un día y se envía otro. Sin el agente guardado, al
-- reanudarla mañana saldría por la línea que estuviera primera en el `.env` ese
-- día, no por la que la persona eligió al crearla.
ALTER TABLE public.whatsapp_campanas
  ADD COLUMN IF NOT EXISTS agente_id integer REFERENCES public.agente_wa(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.whatsapp_campanas.agente_id IS
  'Agente (y con él, la línea) por el que sale esta campaña. NULL = la primera línea del servidor.';

-- Lo que ya existe es del agente que ya existe: dejarlo en NULL sería dejarlo
-- dependiendo del orden del `.env`, que es justo lo que se viene a quitar.
UPDATE public.whatsapp_campanas
   SET agente_id = COALESCE(
     (SELECT id FROM public.agente_wa WHERE clave = 'VETERINARIAS'),
     (SELECT min(id) FROM public.agente_wa)
   )
 WHERE agente_id IS NULL;

-- ── 3. Borrar el archivo de una cabecera deja de atascarse ─────────────────
--
-- 🩸 `ON DELETE SET NULL` contra una tabla que EXIGE material o url deja el
-- borrado en un callejón sin salida: al quitar el material, Postgres intenta
-- poner la referencia a NULL, la CHECK lo rechaza y lo que falla es el borrado
-- del material —con un error de restricción que no menciona ninguna plantilla.
--
-- Hasta ahora no mordía porque nadie había asignado un archivo; desde que la
-- pantalla los sube sola, mordería. CASCADE dice la verdad: si el archivo ya no
-- está, esa plantilla se queda sin archivo y lo avisa al enviarla.
ALTER TABLE public.whatsapp_plantilla_cabecera
  DROP CONSTRAINT IF EXISTS whatsapp_plantilla_cabecera_material_id_fkey;
ALTER TABLE public.whatsapp_plantilla_cabecera
  ADD  CONSTRAINT whatsapp_plantilla_cabecera_material_id_fkey
  FOREIGN KEY (material_id) REFERENCES public.whatsapp_materiales(id) ON DELETE CASCADE;

COMMIT;
