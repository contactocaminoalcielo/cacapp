-- 058: Producción puede reemplazar una foto del cliente por una de mejor calidad.
--
-- Por qué existe: el portal del cliente comprime a 1200px / JPEG 82%
-- (`src/lib/imageUtils.js` → compressImage). Cuando esa foto no da para producir,
-- el equipo consigue una mejor (el cliente la reenvía por WhatsApp, o se retoca) y
-- necesita meterla al servicio SIN perder la que mandó el cliente.
--
-- Decisiones (David 2026-07-17):
--   · La original NO se borra: queda en el log y su archivo sigue vivo en el bucket
--     (cada subida usa una ruta nueva con uuid; nunca se hace upsert ni delete).
--   · Se reemplaza UNA posición de la lista, no la lista entera → dos personas
--     tocando fotos distintas del mismo recordatorio no se pisan.
--   · El log lo escribe la función, no el frontend: no hay forma de cambiar una
--     foto sin dejar rastro de quién fue.
BEGIN;

-- ─── Bitácora de reemplazos ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.produccion_imagen_log (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  servicio_recordatorio_id uuid NOT NULL REFERENCES public.servicio_recordatorios(id) ON DELETE CASCADE,
  servicio_id              uuid,
  recordatorio_nombre      text,
  mascota_nombre           text,
  posicion                 smallint NOT NULL,
  url_anterior             text,
  url_nueva                text NOT NULL,
  motivo                   text,
  cambiado_por             uuid,
  cambiado_por_nombre      text,
  cambiado_por_auth        uuid,
  created_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.produccion_imagen_log            IS 'Quién reemplazó qué foto del cliente, cuándo y por qué. url_anterior sigue descargable: el archivo NO se borra del bucket.';
COMMENT ON COLUMN public.produccion_imagen_log.posicion   IS 'Posición 1-based dentro de servicio_recordatorios.imagenes_cliente_urls';
COMMENT ON COLUMN public.produccion_imagen_log.url_anterior IS 'Foto que estaba antes. NULL solo si la posición estaba vacía.';

CREATE INDEX IF NOT EXISTS ix_prod_img_log_sr       ON public.produccion_imagen_log (servicio_recordatorio_id);
CREATE INDEX IF NOT EXISTS ix_prod_img_log_servicio ON public.produccion_imagen_log (servicio_id);
CREATE INDEX IF NOT EXISTS ix_prod_img_log_created  ON public.produccion_imagen_log (created_at DESC);

-- RLS + GRANTs: mismo patrón que produccion_recordatorio_log (tabla creada con SQL raw).
ALTER TABLE public.produccion_imagen_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_full ON public.produccion_imagen_log;
CREATE POLICY auth_full ON public.produccion_imagen_log
  TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON public.produccion_imagen_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.produccion_imagen_log TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.produccion_imagen_log TO orbit_backend;

-- ─── Reemplazo transaccional ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reemplazar_imagen_recordatorio(
  p_sr_id     uuid,
  p_posicion  smallint,
  p_url_nueva text,
  p_motivo    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_auth            uuid := auth.uid();
  v_personal_id     uuid;
  v_personal_nombre text;
  v_sr              public.servicio_recordatorios%ROWTYPE;
  v_urls            text[];
  v_anterior        text;
  v_rec_nombre      text;
  v_mascota_nombre  text;
  v_log_id          bigint;
BEGIN
  IF p_url_nueva IS NULL OR btrim(p_url_nueva) = '' THEN
    RAISE EXCEPTION 'La URL de la nueva imagen es obligatoria';
  END IF;

  SELECT * INTO v_sr FROM public.servicio_recordatorios WHERE id = p_sr_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El recordatorio no existe';
  END IF;
  IF COALESCE(v_sr.origen,'') = 'REMOVIDO' OR v_sr.estado = 'NA' THEN
    RAISE EXCEPTION 'Ese recordatorio no está activo en el servicio';
  END IF;

  -- Fuente de verdad = el array. Si solo existiera la columna singular (datos
  -- viejos), se normaliza a array de un elemento antes de tocar nada.
  v_urls := COALESCE(
    v_sr.imagenes_cliente_urls,
    CASE WHEN v_sr.imagen_cliente_url IS NOT NULL
         THEN ARRAY[v_sr.imagen_cliente_url] ELSE '{}'::text[] END
  );

  IF p_posicion < 1 OR p_posicion > COALESCE(array_length(v_urls, 1), 0) THEN
    RAISE EXCEPTION 'La posición % no existe en este recordatorio', p_posicion;
  END IF;

  v_anterior := v_urls[p_posicion];
  IF v_anterior IS NOT DISTINCT FROM p_url_nueva THEN
    RAISE EXCEPTION 'La imagen nueva es la misma que ya estaba';
  END IF;

  v_urls[p_posicion] := p_url_nueva;

  -- Digitales elige la foto con COALESCE(imagen_cliente_url, imagenes_cliente_urls[1]).
  -- Si las dos columnas se desincronizan, el memorial seguiría renderizando la foto
  -- vieja aunque en pantalla se vea la nueva (ese bug ya ocurrió: ver modulo_digitales
  -- 2026-07-16). Por eso la singular se reescribe SIEMPRE desde el array.
  UPDATE public.servicio_recordatorios
     SET imagenes_cliente_urls = v_urls,
         imagen_cliente_url    = v_urls[1]
   WHERE id = p_sr_id;

  SELECT id, NULLIF(btrim(COALESCE(nombre,'') || ' ' || COALESCE(apellido,'')), '')
    INTO v_personal_id, v_personal_nombre
    FROM public.personal WHERE auth_user_id = v_auth LIMIT 1;

  SELECT nombre INTO v_rec_nombre
    FROM public.recordatorios WHERE id = v_sr.recordatorio_id;

  SELECT m.nombre INTO v_mascota_nombre
    FROM public.servicios s
    JOIN public.mascotas m ON m.id_mascota = s.mascota_id
   WHERE s.id = v_sr.servicio_id;

  INSERT INTO public.produccion_imagen_log (
    servicio_recordatorio_id, servicio_id, recordatorio_nombre, mascota_nombre,
    posicion, url_anterior, url_nueva, motivo,
    cambiado_por, cambiado_por_nombre, cambiado_por_auth
  ) VALUES (
    p_sr_id, v_sr.servicio_id, v_rec_nombre, v_mascota_nombre,
    p_posicion, v_anterior, p_url_nueva, NULLIF(btrim(COALESCE(p_motivo,'')), ''),
    v_personal_id, v_personal_nombre, v_auth
  ) RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'ok', true,
    'log_id', v_log_id,
    'urls', to_jsonb(v_urls),
    'url_anterior', v_anterior,
    'cambiado_por_nombre', v_personal_nombre
  );
END;
$$;

COMMENT ON FUNCTION public.reemplazar_imagen_recordatorio(uuid, smallint, text, text)
  IS 'Cambia una foto del cliente por otra de mejor calidad y deja constancia en produccion_imagen_log. Atómica: no hay cambio sin log.';

REVOKE ALL ON FUNCTION public.reemplazar_imagen_recordatorio(uuid, smallint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reemplazar_imagen_recordatorio(uuid, smallint, text, text) TO authenticated;

COMMIT;
