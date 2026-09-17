-- Revocación de una autorización, desde Orbit.
--
-- La política le promete al titular que puede revocar «en cualquier momento».
-- Hasta ahora eso no se podía registrar: la tabla solo aceptaba filas con
-- accion='AUTORIZA' (migración 162), así que la promesa no tenía dónde vivir.
--
-- Una revocación NO borra ni edita la autorización: es otra fila que apunta a
-- ella. Las dos tienen que poder mostrarse — hay que poder probar que se
-- autorizó, y también que después se retiró.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- La revocación la registra el equipo cuando el titular la pide por WhatsApp,
-- correo o teléfono: es un origen distinto de los siete puntos de captura.
ALTER TABLE public.autorizaciones_datos
  DROP CONSTRAINT IF EXISTS autorizaciones_datos_origen_check,
  ADD CONSTRAINT autorizaciones_datos_origen_check CHECK (origen IN (
    'SOLICITUD_CLIENTE','SOLICITUD_ALIADO','AFILIACION_ALIADO',
    'PORTAL_FOTOS','PORTAL_PLANTA','PORTAL_VISITA','REGISTRO_INTERNO',
    'REVOCACION'));

-- A cuál autorización apunta. Sin esto, «revocada» sería una adivinanza cuando
-- un mismo titular autorizó varias veces.
ALTER TABLE public.autorizaciones_datos
  ADD COLUMN IF NOT EXISTS revoca_id uuid REFERENCES public.autorizaciones_datos(id);

CREATE INDEX IF NOT EXISTS ix_autorizaciones_revoca ON public.autorizaciones_datos (revoca_id)
  WHERE revoca_id IS NOT NULL;

-- Una autorización no se revoca dos veces: la segunda no agrega nada y ensucia
-- la lectura de la pantalla.
CREATE UNIQUE INDEX IF NOT EXISTS ux_autorizaciones_revoca_una
  ON public.autorizaciones_datos (revoca_id) WHERE revoca_id IS NOT NULL;

-- Una sesión del equipo puede: registrar el consentimiento del registro
-- interno, o registrar una revocación que apunte a una autorización existente.
-- Nada más: sigue sin poder fabricar una que parezca marcada por la familia.
DROP POLICY IF EXISTS auth_insert ON public.autorizaciones_datos;
CREATE POLICY auth_insert ON public.autorizaciones_datos FOR INSERT TO authenticated
WITH CHECK (
  (     origen = 'REGISTRO_INTERNO'
    AND medio  = 'DECLARADA_POR_PERSONAL'
    AND accion = 'AUTORIZA'
    AND revoca_id IS NULL)
  OR
  (     origen = 'REVOCACION'
    AND medio  = 'DECLARADA_POR_PERSONAL'
    AND accion = 'REVOCA'
    AND revoca_id IS NOT NULL)
);

COMMIT;
