-- Endurecer la tabla de autorizaciones (migración 161).
--
-- Tal como quedó, `anon` podía INSERTAR cualquier fila: una que dijera
-- `medio='DECLARADA_POR_PERSONAL'` con el id de un coordinador, o una colgada
-- del `servicio_id` de otra familia. Nadie gana nada con eso, pero envenena
-- justo lo único que esta tabla existe para sostener: la prueba.
--
-- `anon` entra por un solo sitio — el portal /solicitud — y ahí siempre es el
-- titular marcando por lo suyo, sin servicio todavía. Eso es lo único que se le
-- permite escribir. La IP y el user_agent los pone el backend; desde el
-- navegador no son prueba de nada, así que tampoco se le aceptan.
--
-- Los topes de largo cierran el otro lado: sin ellos, cualquiera con la llave
-- pública podía dejar filas de megabytes.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.autorizaciones_datos
  DROP CONSTRAINT IF EXISTS autorizaciones_largos,
  ADD CONSTRAINT autorizaciones_largos CHECK (
        length(politica_version)          <= 20
    AND length(COALESCE(titular_nombre,    '')) <= 200
    AND length(COALESCE(titular_documento, '')) <= 60
    AND length(COALESCE(titular_telefono,  '')) <= 60
    AND length(COALESCE(titular_email,     '')) <= 200
    AND length(COALESCE(user_agent,        '')) <= 500
    AND length(COALESCE(notas,             '')) <= 2000
    AND COALESCE(array_length(finalidades, 1), 0) <= 10
  );

-- anon: solo el portal público del cliente, y solo por sí mismo.
DROP POLICY IF EXISTS anon_insert_only ON public.autorizaciones_datos;
CREATE POLICY anon_insert_only ON public.autorizaciones_datos FOR INSERT TO anon
WITH CHECK (
      origen = 'SOLICITUD_CLIENTE'
  AND medio  = 'PORTAL_WEB'
  AND accion = 'AUTORIZA'
  AND declarada_por IS NULL
  AND servicio_id   IS NULL
  AND cliente_id    IS NULL
  AND solicitud_id  IS NULL
  AND aliado_id     IS NULL
  AND ip            IS NULL
  AND user_agent    IS NULL
);

-- authenticated: el registro interno. Quien declara queda firmado con su
-- usuario, y no puede hacerse pasar por un portal.
DROP POLICY IF EXISTS auth_insert ON public.autorizaciones_datos;
CREATE POLICY auth_insert ON public.autorizaciones_datos FOR INSERT TO authenticated
WITH CHECK (
      origen = 'REGISTRO_INTERNO'
  AND medio  = 'DECLARADA_POR_PERSONAL'
  AND accion = 'AUTORIZA'
);

COMMIT;
