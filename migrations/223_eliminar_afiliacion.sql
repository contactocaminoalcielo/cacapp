-- 223 · Eliminar un contrato pre-exequial duplicado (con respaldo)
--
-- REPORTE ORBIT (25-nov, urgencia media): "Poder eliminar un contrato cuando
-- esté duplicado". Hasta hoy no había forma: solo cancelar, y un cancelado
-- sigue en la lista, en el «Recaudado» y en las cuentas del titular.
--
-- Borrar plata y contratos firmados es irreversible desde la pantalla, así que:
--  · Solo coordinación/admin (`es_coordinacion()`, como la migr. 213).
--  · Motivo obligatorio.
--  · NUNCA si alguna mascota ya se ACTIVÓ: ese contrato pagó un servicio real
--    (`servicio_activado_id`) y borrarlo deja al servicio sin su origen.
--  · ANTES de borrar se guarda la foto completa (afiliación + contratos + abonos
--    + mascotas) en `afiliaciones_eliminadas`: si se borró el que no era, los
--    datos están ahí para reconstruirlo.
--  · Las mascotas que SOLO existían por este contrato (sin servicios, sin otro
--    contrato, sin eutanasias ni compras) también se borran: son el duplicado de
--    la mascota que dejó el contrato repetido (caso Amparo Castillo: «Sasha» y
--    «SASHA»). Si algo más la referencia, se queda.
--  · Los archivos (comprobantes, PDF) NO se borran del Storage: la foto guarda
--    sus rutas.
--
-- `afiliacion_contratos`, `afiliacion_mascotas` y `afiliacion_pagos` caen por
-- ON DELETE CASCADE; `ventas_posteriores.afiliacion_id` queda NULL (SET NULL).

BEGIN;

CREATE TABLE IF NOT EXISTS public.afiliaciones_eliminadas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  afiliacion_id     uuid NOT NULL,
  cliente_id        uuid,
  numeros_contrato  text[] NOT NULL DEFAULT '{}',
  motivo            text NOT NULL,
  snapshot          jsonb NOT NULL,
  mascotas_borradas uuid[] NOT NULL DEFAULT '{}',
  eliminado_por     uuid REFERENCES public.personal(id) ON DELETE SET NULL,
  eliminado_en      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.afiliaciones_eliminadas IS
  'Respaldo de cada contrato pre-exequial eliminado desde Orbit (migr. 223): foto completa antes del borrado.';

ALTER TABLE public.afiliaciones_eliminadas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS afil_elim_lectura_coord ON public.afiliaciones_eliminadas;
CREATE POLICY afil_elim_lectura_coord ON public.afiliaciones_eliminadas
  FOR SELECT TO authenticated USING (public.es_coordinacion());
-- Escribir solo por la función (SECURITY DEFINER): no hay policy de INSERT.
REVOKE ALL ON public.afiliaciones_eliminadas FROM PUBLIC, anon;
GRANT SELECT ON public.afiliaciones_eliminadas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.afiliaciones_eliminadas TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.afiliaciones_eliminadas TO orbit_backend;

CREATE OR REPLACE FUNCTION public.eliminar_afiliacion(p_afiliacion_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_motivo    text := NULLIF(btrim(p_motivo), '');
  v_af        public.afiliaciones%ROWTYPE;
  v_activada  text;
  v_snapshot  jsonb;
  v_numeros   text[];
  v_mascotas  uuid[];
  v_borradas  uuid[] := '{}';
  v_m         uuid;
BEGIN
  IF NOT public.es_coordinacion() THEN
    RAISE EXCEPTION 'NO_AUTORIZADO: solo coordinación puede eliminar un contrato' USING ERRCODE = '42501';
  END IF;
  IF v_motivo IS NULL OR char_length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'Escribe por qué se elimina el contrato (mínimo 5 caracteres)';
  END IF;

  SELECT * INTO v_af FROM public.afiliaciones WHERE id = p_afiliacion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El contrato no existe (¿ya se eliminó?)';
  END IF;

  SELECT m.nombre INTO v_activada
    FROM public.afiliacion_mascotas am
    JOIN public.mascotas m ON m.id_mascota = am.mascota_id
   WHERE am.afiliacion_id = p_afiliacion_id
     AND (am.estado = 'ACTIVADA' OR am.servicio_activado_id IS NOT NULL)
   LIMIT 1;
  IF v_activada IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede eliminar: % ya usó el servicio con este contrato. Cancélalo en vez de eliminarlo.', v_activada;
  END IF;

  SELECT coalesce(array_agg(c.numero_contrato ORDER BY c.numero), '{}')
    INTO v_numeros
    FROM public.afiliacion_contratos c WHERE c.afiliacion_id = p_afiliacion_id;

  SELECT coalesce(array_agg(am.mascota_id), '{}')
    INTO v_mascotas
    FROM public.afiliacion_mascotas am WHERE am.afiliacion_id = p_afiliacion_id;

  v_snapshot := jsonb_build_object(
    'afiliacion', to_jsonb(v_af),
    'contratos', coalesce((
      SELECT jsonb_agg(to_jsonb(c) || jsonb_build_object('pagos', coalesce((
               SELECT jsonb_agg(to_jsonb(p) ORDER BY p.fecha)
                 FROM public.afiliacion_pagos p WHERE p.contrato_id = c.id), '[]'::jsonb))
             ORDER BY c.numero)
        FROM public.afiliacion_contratos c WHERE c.afiliacion_id = p_afiliacion_id), '[]'::jsonb),
    'mascotas', coalesce((
      SELECT jsonb_agg(to_jsonb(am) || jsonb_build_object('mascota', to_jsonb(m)))
        FROM public.afiliacion_mascotas am
        JOIN public.mascotas m ON m.id_mascota = am.mascota_id
       WHERE am.afiliacion_id = p_afiliacion_id), '[]'::jsonb)
  );

  -- Contratos, mascotas cubiertas y abonos caen en cascada.
  DELETE FROM public.afiliaciones WHERE id = p_afiliacion_id;

  -- La mascota que solo existía por este contrato (el duplicado) se va con él.
  FOREACH v_m IN ARRAY v_mascotas LOOP
    IF NOT EXISTS (SELECT 1 FROM public.afiliacion_mascotas WHERE mascota_id = v_m)
       AND NOT EXISTS (SELECT 1 FROM public.servicios WHERE mascota_id = v_m)
       AND NOT EXISTS (SELECT 1 FROM public.eutanasias WHERE mascota_id = v_m)
       AND NOT EXISTS (SELECT 1 FROM public.compras_recordatorios WHERE mascota_id = v_m) THEN
      BEGIN
        DELETE FROM public.mascotas WHERE id_mascota = v_m;
        v_borradas := v_borradas || v_m;
      EXCEPTION WHEN foreign_key_violation THEN
        NULL;  -- algo más la referencia: se queda
      END;
    END IF;
  END LOOP;

  INSERT INTO public.afiliaciones_eliminadas
    (afiliacion_id, cliente_id, numeros_contrato, motivo, snapshot, mascotas_borradas, eliminado_por)
  VALUES
    (p_afiliacion_id, v_af.cliente_id, v_numeros, v_motivo, v_snapshot, v_borradas, public.mi_personal_id());

  RETURN jsonb_build_object('ok', true, 'contratos', v_numeros, 'mascotas_borradas', cardinality(v_borradas));
END;
$$;

COMMENT ON FUNCTION public.eliminar_afiliacion(uuid, text) IS
  'Elimina un contrato pre-exequial (duplicado/cargado por error) con respaldo en afiliaciones_eliminadas. Solo coordinación; nunca uno ya activado (migr. 223).';

REVOKE ALL ON FUNCTION public.eliminar_afiliacion(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eliminar_afiliacion(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.eliminar_afiliacion(uuid, text) TO authenticated;

COMMIT;
