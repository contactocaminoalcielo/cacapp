-- 220: Diseño carga desde Orbit la foto de un recordatorio que no la tiene.
--
-- REPORTE (Tablero – Producción y Diseño, urgencia alta): la familia sube sus fotos,
-- el portal se cierra (`servicios.fecha_imagenes_recibidas`), y DESPUÉS compra un
-- recordatorio adicional. Coordinación lo agrega en el Tablero, pero ese ítem queda
-- SIN foto y no había cómo ponérsela: la 058 solo REEMPLAZA una posición que ya
-- existe (`La posición 1 no existe en este recordatorio`). La foto terminaba
-- manejándose por WhatsApp, fuera del sistema y sin rastro de cuál se usó.
--
-- Caso vivo al escribir esto: Arequipe · Portarretrato Promoción (agregado 17-nov,
-- portal cerrado 10-nov). En 90 días hubo 10 adicionales así.
--
-- Qué hace: AGREGA una foto al final de la lista del recordatorio, con el mismo
-- contrato que la 058:
--   · no hay foto agregada sin fila en produccion_imagen_log (url_anterior NULL =
--     "estaba vacía", que el historial ya sabe pintar);
--   · la columna singular se reescribe SIEMPRE desde el array (Digitales elige con
--     COALESCE(imagen_cliente_url, imagenes_cliente_urls[1]));
--   · nunca borra archivos: la URL puede ser una foto NUEVA subida al bucket o una
--     que la familia ya mandó para otro recordatorio del servicio (se reutiliza).
--
-- Tope: max_fotos del catálogo × cantidad (5 llaveros pueden llevar fotos
-- distintas). Si el catálogo dice que el ítem no lleva foto (requiere_imagen=false
-- o solo_nombre), se rechaza: la regla vive en Configuración › Recordatorios, no aquí.
BEGIN;

CREATE OR REPLACE FUNCTION public.agregar_imagen_recordatorio(
  p_sr_id     uuid,
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
  v_rec_nombre      text;
  v_requiere        boolean;
  v_solo_nombre     boolean;
  v_max_fotos       integer;
  v_tope            integer;
  v_urls            text[];
  v_n               integer;
  v_mascota_nombre  text;
  v_log_id          bigint;
BEGIN
  IF p_url_nueva IS NULL OR btrim(p_url_nueva) = '' THEN
    RAISE EXCEPTION 'La URL de la imagen es obligatoria';
  END IF;

  SELECT * INTO v_sr FROM public.servicio_recordatorios WHERE id = p_sr_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El recordatorio no existe';
  END IF;
  IF COALESCE(v_sr.origen,'') = 'REMOVIDO' OR v_sr.estado = 'NA' THEN
    RAISE EXCEPTION 'Ese recordatorio no está activo en el servicio';
  END IF;

  SELECT nombre, requiere_imagen, solo_nombre, max_fotos
    INTO v_rec_nombre, v_requiere, v_solo_nombre, v_max_fotos
    FROM public.recordatorios WHERE id = v_sr.recordatorio_id;

  IF NOT COALESCE(v_requiere, false) OR COALESCE(v_solo_nombre, false) OR COALESCE(v_max_fotos, 0) <= 0 THEN
    RAISE EXCEPTION '«%» no lleva foto según el catálogo (Configuración › Recordatorios)', COALESCE(v_rec_nombre, 'Este ítem');
  END IF;

  -- Fuente de verdad = el array. Un array VACÍO ('{}') con la singular llena se
  -- trata como dato viejo: COALESCE no lo atraparía porque '{}' no es NULL.
  v_urls := CASE
    WHEN COALESCE(array_length(v_sr.imagenes_cliente_urls, 1), 0) > 0 THEN v_sr.imagenes_cliente_urls
    WHEN v_sr.imagen_cliente_url IS NOT NULL THEN ARRAY[v_sr.imagen_cliente_url]
    ELSE '{}'::text[]
  END;
  v_n := COALESCE(array_length(v_urls, 1), 0);

  v_tope := v_max_fotos * GREATEST(COALESCE(v_sr.cantidad, 1), 1);
  IF v_n >= v_tope THEN
    RAISE EXCEPTION '«%» ya tiene sus % foto(s). Para cambiar una, usa «Cambiar» sobre la foto.', v_rec_nombre, v_tope;
  END IF;
  IF p_url_nueva = ANY(v_urls) THEN
    RAISE EXCEPTION 'Esa foto ya está en «%»', v_rec_nombre;
  END IF;

  v_urls := array_append(v_urls, p_url_nueva);
  v_n    := v_n + 1;

  UPDATE public.servicio_recordatorios
     SET imagenes_cliente_urls = v_urls,
         imagen_cliente_url    = v_urls[1]
   WHERE id = p_sr_id;

  SELECT id, NULLIF(btrim(COALESCE(nombre,'') || ' ' || COALESCE(apellido,'')), '')
    INTO v_personal_id, v_personal_nombre
    FROM public.personal WHERE auth_user_id = v_auth LIMIT 1;

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
    v_n, NULL, p_url_nueva, NULLIF(btrim(COALESCE(p_motivo,'')), ''),
    v_personal_id, v_personal_nombre, v_auth
  ) RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'ok', true,
    'log_id', v_log_id,
    'posicion', v_n,
    'tope', v_tope,
    'urls', to_jsonb(v_urls),
    'cambiado_por_nombre', v_personal_nombre
  );
END;
$$;

COMMENT ON FUNCTION public.agregar_imagen_recordatorio(uuid, text, text)
  IS 'Agrega una foto (nueva o reutilizada del mismo servicio) a un recordatorio que aún no completa sus fotos, y deja constancia en produccion_imagen_log con url_anterior NULL. Atómica: no hay foto agregada sin log. Migr. 220.';

REVOKE ALL ON FUNCTION public.agregar_imagen_recordatorio(uuid, text, text) FROM PUBLIC;
-- Supabase concede EXECUTE a anon por default privileges: FROM PUBLIC no lo quita.
REVOKE ALL ON FUNCTION public.agregar_imagen_recordatorio(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.agregar_imagen_recordatorio(uuid, text, text) TO authenticated;

COMMIT;
