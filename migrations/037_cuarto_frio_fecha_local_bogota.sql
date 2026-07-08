-- ============================================================================
-- 037 — Fechas DATE en hora LOCAL de Bogotá en toda la DB (hermana de la 036)
--
-- CURRENT_DATE en el servidor corre en UTC: después de las 7:00 p.m. hora
-- Colombia ya es "mañana". Todo default o función que fechaba "hoy" con
-- CURRENT_DATE quedaba corrido +1 día en operaciones nocturnas. La 036 corrigió
-- los recibos del técnico (recargo dominical perdido); esta cierra el resto:
--
--   A. estado_cuarto_frio: backfill de 16 reportes corridos (el técnico que
--      reportaba neveras de noche quedaba fechado al día siguiente y el badge
--      "falta el reporte de hoy" no lo encontraba).
--   B. Defaults CURRENT_DATE → día Bogotá en las 9 columnas DATE que lo usaban.
--      Riesgo cero: solo aplica cuando el INSERT no manda la columna, y el día
--      correcto siempre es el colombiano. (El frontend ya manda fecha local en
--      casi todas; esto es defensa en profundidad.)
--   C. Funciones con CURRENT_DATE → día Bogotá, SIN tocar su lógica:
--      - fn_dias_habiles_hasta: "hoy" para SLAs/alertas (de noche calculaba
--        los días hábiles desde mañana).
--      - crear_nps_al_entregado: entregas marcadas de noche programaban el
--        NPS post-entrega para el día siguiente (y corría los 90/180 días).
--      - fn_gestionar_comision_recogida: conteo mensual, vigencia de tarifas
--        y periodo_factura usaban el día UTC (recogidas completadas de noche
--        a fin de mes caían al mes siguiente).
-- ============================================================================

BEGIN;

-- ── A. Backfill estado_cuarto_frio (fecha real desde created_at) ─────────────
SELECT id, fecha AS fecha_mal,
       (created_at AT TIME ZONE 'America/Bogota')::date AS fecha_real,
       created_at AT TIME ZONE 'America/Bogota' AS creado_bogota
FROM public.estado_cuarto_frio
WHERE fecha = ((created_at AT TIME ZONE 'America/Bogota')::date + 1)
ORDER BY created_at;

UPDATE public.estado_cuarto_frio
SET fecha = (created_at AT TIME ZONE 'America/Bogota')::date
WHERE fecha = ((created_at AT TIME ZONE 'America/Bogota')::date + 1);

-- ── B. Defaults CURRENT_DATE → día Bogotá ────────────────────────────────────
ALTER TABLE public.estado_cuarto_frio    ALTER COLUMN fecha            SET DEFAULT ((now() AT TIME ZONE 'America/Bogota')::date);
ALTER TABLE public.servicios             ALTER COLUMN fecha_ingreso    SET DEFAULT ((now() AT TIME ZONE 'America/Bogota')::date);
ALTER TABLE public.recibos_tecnico       ALTER COLUMN fecha_emision    SET DEFAULT ((now() AT TIME ZONE 'America/Bogota')::date);
ALTER TABLE public.certificados_emitidos ALTER COLUMN fecha_emision    SET DEFAULT ((now() AT TIME ZONE 'America/Bogota')::date);
ALTER TABLE public.comisiones_aliados    ALTER COLUMN fecha_generacion SET DEFAULT ((now() AT TIME ZONE 'America/Bogota')::date);
ALTER TABLE public.config_comisiones     ALTER COLUMN vigente_desde    SET DEFAULT ((now() AT TIME ZONE 'America/Bogota')::date);
ALTER TABLE public.eutanasia_tarifas     ALTER COLUMN vigente_desde    SET DEFAULT ((now() AT TIME ZONE 'America/Bogota')::date);
ALTER TABLE public.planes_presequiales   ALTER COLUMN fecha_inicio     SET DEFAULT ((now() AT TIME ZONE 'America/Bogota')::date);
ALTER TABLE public.solicitudes_imagenes  ALTER COLUMN fecha_solicitud  SET DEFAULT ((now() AT TIME ZONE 'America/Bogota')::date);

-- ── C1. fn_dias_habiles_hasta — "hoy" en Bogotá ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_dias_habiles_hasta(fecha_fin date)
RETURNS integer
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_hoy DATE := (now() AT TIME ZONE 'America/Bogota')::date;
  v_inicio DATE := (now() AT TIME ZONE 'America/Bogota')::date;
  v_fin DATE := fecha_fin; v_signo INTEGER := 1; v_count INTEGER;
BEGIN
  IF fecha_fin IS NULL THEN RETURN NULL; END IF;
  IF v_fin < v_inicio THEN v_signo := -1; v_inicio := fecha_fin; v_fin := v_hoy; END IF;
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM generate_series(v_inicio, v_fin, '1 day'::interval) d
  WHERE public.fn_es_dia_habil(d::date) AND d::date <> v_inicio;
  RETURN v_signo * v_count;
END;
$$;

-- ── C2. crear_nps_al_entregado — programación NPS con día Bogotá ─────────────
CREATE OR REPLACE FUNCTION public.crear_nps_al_entregado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Bogota')::date;
BEGIN
  IF NEW.estado = 'ENTREGADO' AND (OLD.estado IS DISTINCT FROM 'ENTREGADO') THEN
    IF NOT EXISTS (
      SELECT 1 FROM nps_seguimiento
      WHERE servicio_id = NEW.id AND tipo = 'POST_ENTREGA'
    ) THEN
      INSERT INTO nps_seguimiento (servicio_id, tipo, estado, fecha_programada)
      VALUES
        (NEW.id, 'POST_ENTREGA',     'PENDIENTE', v_hoy),
        (NEW.id, 'RECORDATORIO_3M',  'PENDIENTE', v_hoy + INTERVAL '90 days'),
        (NEW.id, 'RECORDATORIO_6M',  'PENDIENTE', v_hoy + INTERVAL '180 days');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── C3. fn_gestionar_comision_recogida — solo CURRENT_DATE → día Bogotá ──────
-- (Lógica de negocio intacta; únicamente cambia el "hoy" del conteo mensual,
--  la vigencia de config_comisiones y el periodo_factura.)
CREATE OR REPLACE FUNCTION public.fn_gestionar_comision_recogida()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_hoy DATE := (now() AT TIME ZONE 'America/Bogota')::date;
    v_aliado_id UUID;
    v_plan_id UUID;
    v_valor_servicio NUMERIC;
    v_modalidad VARCHAR;
    v_porcentaje NUMERIC;
    v_valor_comision NUMERIC;
    v_servicios_mes INTEGER;
BEGIN
    IF NEW.estado = 'COMPLETADA' AND OLD.estado != 'COMPLETADA' THEN
        SELECT aliado_origen_id, plan_id, valor_total
        INTO v_aliado_id, v_plan_id, v_valor_servicio
        FROM servicios WHERE id = NEW.servicio_id;

        IF v_aliado_id IS NOT NULL THEN
            SELECT modalidad_comision INTO v_modalidad
            FROM aliados WHERE id_aliado = v_aliado_id;

            -- Contar servicios del aliado en el mes
            SELECT COUNT(*) INTO v_servicios_mes
            FROM servicios s
            JOIN recogidas r ON r.servicio_id = s.id
            WHERE s.aliado_origen_id = v_aliado_id
              AND r.estado = 'COMPLETADA'
              AND DATE_TRUNC('month', r.fecha_realizada) = DATE_TRUNC('month', v_hoy);

            -- Buscar porcentaje vigente según plan y volumen
            SELECT COALESCE(porcentaje, 0) INTO v_porcentaje
            FROM config_comisiones
            WHERE (plan_id = v_plan_id OR plan_id IS NULL)
              AND (rango_min <= v_servicios_mes)
              AND (rango_max IS NULL OR rango_max >= v_servicios_mes)
              AND vigente_desde <= v_hoy
              AND (vigente_hasta IS NULL OR vigente_hasta >= v_hoy)
            ORDER BY plan_id NULLS LAST, rango_min DESC
            LIMIT 1;

            v_valor_comision := ROUND(v_valor_servicio * v_porcentaje / 100, 0);

            IF v_valor_comision > 0 THEN
                INSERT INTO comisiones_aliados
                    (aliado_id, servicio_id, valor_comision, porcentaje_aplicado, modalidad_pago, estado, periodo_factura)
                VALUES (
                    v_aliado_id, NEW.servicio_id, v_valor_comision, v_porcentaje,
                    v_modalidad,
                    CASE v_modalidad
                        WHEN 'DESCUENTO_INMEDIATO' THEN 'PAGADA'
                        WHEN 'FACTURACION_MENSUAL' THEN 'FACTURADA'
                        ELSE 'ACUMULADA'
                    END,
                    TO_CHAR(v_hoy, 'YYYY-MM')
                );

                -- Si es crédito acumulado, actualizar saldo del aliado
                IF v_modalidad = 'CREDITO_ACUMULADO' THEN
                    UPDATE aliados SET saldo_comision = saldo_comision + v_valor_comision
                    WHERE id_aliado = v_aliado_id;
                END IF;

                -- Actualizar comisión en el servicio
                UPDATE servicios SET
                    comision_aliado = v_valor_comision,
                    comision_descontada = (v_modalidad = 'DESCUENTO_INMEDIATO')
                WHERE id = NEW.servicio_id;
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

COMMIT;

-- Verificación post-aplicación (debe dar 0):
-- SELECT count(*) FROM estado_cuarto_frio
-- WHERE fecha = ((created_at AT TIME ZONE 'America/Bogota')::date + 1);
