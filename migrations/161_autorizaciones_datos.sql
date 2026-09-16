-- Prueba de la autorización de tratamiento de datos (Ley 1581 de 2012, art. 9 y
-- Decreto 1377 de 2013 compilado en el Decreto 1074 de 2015, art. 2.2.2.25.2.4:
-- el Responsable debe conservar prueba de la autorización).
--
-- Una fila por autorización dada. NO se borra ni se sobrescribe: si alguien
-- vuelve a autorizar, o revoca, entra otra fila. La revocación se guarda igual
-- que la autorización porque también hay que poder probarla.
--
-- Guarda A QUÉ VERSIÓN de la política dijo que sí: el texto cambia con el
-- tiempo y una autorización solo prueba algo si se sabe qué decía lo aceptado.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.autorizaciones_datos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Dónde se dio. Cada portal y el registro interno se distinguen porque el
  -- valor probatorio no es el mismo: en unos la marcó el titular, en otros
  -- alguien declara que el titular autorizó.
  origen            text NOT NULL CHECK (origen IN (
                      'SOLICITUD_CLIENTE','SOLICITUD_ALIADO','AFILIACION_ALIADO',
                      'PORTAL_FOTOS','PORTAL_PLANTA','PORTAL_VISITA','REGISTRO_INTERNO')),
  medio             text NOT NULL CHECK (medio IN (
                      'PORTAL_WEB','DECLARADA_POR_ALIADO','DECLARADA_POR_PERSONAL')),
  accion            text NOT NULL DEFAULT 'AUTORIZA' CHECK (accion IN ('AUTORIZA','REVOCA')),
  politica_version  text NOT NULL,
  -- Finalidades aceptadas. Hoy siempre {SERVICIO}; queda en arreglo para que
  -- una finalidad opcional futura (publicar el memorial en redes) sea otro
  -- elemento y no otra tabla.
  finalidades       text[] NOT NULL DEFAULT ARRAY['SERVICIO'],

  -- A quién pertenecen los datos. Se guarda el dato tal como se dio, no solo
  -- la llave: el titular puede preguntar años después y el cliente pudo haber
  -- cambiado de teléfono o haberse fusionado con otro registro.
  titular_nombre    text,
  titular_documento text,
  titular_telefono  text,
  titular_email     text,

  servicio_id       uuid REFERENCES public.servicios(id),
  cliente_id        uuid REFERENCES public.clientes(id_cliente),
  solicitud_id      uuid REFERENCES public.solicitudes_servicio(id),
  aliado_id         uuid REFERENCES public.aliados(id_aliado),
  -- Quién declaró la autorización cuando no la marcó el titular.
  declarada_por     uuid REFERENCES public.personal(id),

  ip                inet,
  user_agent        text,
  notas             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.autorizaciones_datos IS
  'Prueba de autorización de tratamiento de datos personales (Ley 1581/2012). Solo se agrega: nunca UPDATE ni DELETE.';

CREATE INDEX IF NOT EXISTS ix_autorizaciones_servicio  ON public.autorizaciones_datos (servicio_id) WHERE servicio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_autorizaciones_cliente   ON public.autorizaciones_datos (cliente_id)  WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_autorizaciones_telefono  ON public.autorizaciones_datos (titular_telefono) WHERE titular_telefono IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_autorizaciones_fecha     ON public.autorizaciones_datos (created_at DESC);

-- Permisos. anon solo puede INSERTAR: el portal público escribe su propia
-- autorización y no puede leer las de nadie. La tabla se creó con SQL, así que
-- los GRANT van a mano (Supabase no los pone solo).
ALTER TABLE public.autorizaciones_datos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.autorizaciones_datos FROM PUBLIC, anon, authenticated;
GRANT INSERT ON TABLE public.autorizaciones_datos TO anon;
GRANT SELECT, INSERT ON TABLE public.autorizaciones_datos TO authenticated;
GRANT SELECT, INSERT ON TABLE public.autorizaciones_datos TO orbit_backend;
GRANT ALL ON TABLE public.autorizaciones_datos TO postgres, service_role;

DROP POLICY IF EXISTS anon_insert_only ON public.autorizaciones_datos;
CREATE POLICY anon_insert_only ON public.autorizaciones_datos FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS auth_lectura ON public.autorizaciones_datos;
CREATE POLICY auth_lectura ON public.autorizaciones_datos FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS auth_insert ON public.autorizaciones_datos;
CREATE POLICY auth_insert ON public.autorizaciones_datos FOR INSERT TO authenticated WITH CHECK (true);

COMMIT;
