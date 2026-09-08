-- Ejecutar en una transacción consistente. Compara la implementación vigente
-- con la definición de negocio fn_es_dia_habil, sin modificar datos operativos.
DO $$
DECLARE diferencias integer;
BEGIN
  WITH hoy AS (
    SELECT (now() AT TIME ZONE 'America/Bogota')::date AS fecha
  ), fechas AS (
    SELECT fecha + n AS fin FROM hoy CROSS JOIN generate_series(-400,400) n
    UNION SELECT fecha_limite_entrega FROM public.servicios
    UNION SELECT fecha_codigo_enviado FROM public.servicios
    UNION SELECT fecha + n FROM public.festivos CROSS JOIN generate_series(-1,1) n
    UNION SELECT d::date FROM generate_series('2024-02-28'::date,'2024-03-01'::date,'1 day') d
    UNION SELECT d::date FROM generate_series('2028-02-28'::date,'2028-03-01'::date,'1 day') d
    UNION SELECT NULL::date
  ), resultados AS (
    SELECT fin, public.fn_dias_habiles_hasta(fin) AS actual,
      CASE WHEN fin IS NULL THEN NULL ELSE
        (CASE WHEN fin < hoy.fecha THEN -1 ELSE 1 END) * (
          SELECT count(*)::integer
          FROM generate_series(least(fin,hoy.fecha),greatest(fin,hoy.fecha),'1 day'::interval) d
          WHERE public.fn_es_dia_habil(d::date)
            AND d::date <> least(fin,hoy.fecha)
        ) END AS esperado
    FROM fechas CROSS JOIN hoy
  ) SELECT count(*) INTO diferencias FROM resultados
    WHERE actual IS DISTINCT FROM esperado;
  IF diferencias <> 0 THEN
    RAISE EXCEPTION 'Cambió el cálculo de días hábiles: % fechas', diferencias;
  END IF;
END;
$$;
