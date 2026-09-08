-- Misma regla de fn_es_dia_habil: lunes a viernes, excluyendo festivos.
-- Expresar el anti-join dentro de la consulta permite planificar festivos una
-- sola vez, en vez de ejecutar una función SQL con subconsulta por cada día.
-- Conserva Bogotá, signo, exclusión del extremo inicial y NULL de la función.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fn_dias_habiles_hasta(fecha_fin date)
RETURNS integer
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_hoy DATE := (now() AT TIME ZONE 'America/Bogota')::date;
  v_inicio DATE := (now() AT TIME ZONE 'America/Bogota')::date;
  v_fin DATE := fecha_fin;
  v_signo INTEGER := 1;
  v_count INTEGER;
BEGIN
  IF fecha_fin IS NULL THEN RETURN NULL; END IF;
  IF v_fin < v_inicio THEN
    v_signo := -1; v_inicio := fecha_fin; v_fin := v_hoy;
  END IF;
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM generate_series(v_inicio, v_fin, '1 day'::interval) d
  WHERE extract(isodow FROM d::date) < 6
    AND NOT EXISTS (SELECT 1 FROM public.festivos f WHERE f.fecha = d::date)
    AND d::date <> v_inicio;
  RETURN v_signo * v_count;
END;
$$;

COMMIT;
