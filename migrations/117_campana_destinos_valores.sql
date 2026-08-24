-- 117 — Cada destinatario de una campaña puede traer SUS datos
--
-- Hasta hoy una campaña tenía dos fuentes de datos para los huecos de la
-- plantilla:
--
--   · los que salen de Orbit, leídos de `ref_id` justo antes de enviar
--   · `valores_fijos`: lo que se escribe UNA vez y vale para todos
--
-- Faltaba el caso de en medio, que es el que pide una importación: un archivo
-- con 300 filas donde cada una trae su nombre, su mascota o su fecha. Sin esta
-- columna, importar solo podía traer números y mandarles a todos exactamente el
-- mismo texto — que es la puerta de al lado del error de las 251 plantillas,
-- una por mascota.
--
-- `{}` es la respuesta correcta para todo lo que ya existe: esas campañas no
-- traían datos por destinatario y se siguen resolviendo como siempre.

BEGIN;

ALTER TABLE public.whatsapp_campana_destinos
  ADD COLUMN IF NOT EXISTS valores jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.whatsapp_campana_destinos.valores IS
  'Datos de ESTE destinatario para los huecos de la plantilla (clave "BODY:mascota"). Manda sobre valores_fijos; lo leído de Orbit manda sobre ambos.';

COMMIT;
