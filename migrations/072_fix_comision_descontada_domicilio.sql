-- ============================================================================
-- 072 — Corregir comisión descontada en servicios recogidos a domicilio
-- ----------------------------------------------------------------------------
-- David (2026-07-23): corregir el dato de comisión descontada en los servicios
-- donde el técnico recogió el NETO (la comisión SÍ se descontó) pero quedaron
-- registrados como "comisión no descontada".
--
-- Causa (ver [[cuadre_comision_no_descontada_falso_faltante]]): en Registro.jsx
-- `comision_descontada` solo se marca TRUE si la recogida es en CLINICA_ALIADA.
-- Un servicio de DESCUENTO_INMEDIATO recogido a DOMICILIO quedaba con
-- comision_descontada=FALSE y valor_total=BRUTO, aunque el cliente pagó el neto.
--
-- Selección PRECISA (no toca los que de verdad pagaron el bruto): solo servicios
-- DESCUENTO_INMEDIATO, comisión > 0, comision_descontada=FALSE, desde el corte,
-- QUE ADEMÁS tienen un ítem de cuadre con total_cobrado == valor_total − comisión
-- (evidencia dura de que se recogió el NETO). Los que recogieron el bruto o no
-- registran cobro NO entran.
--
-- Cambio por servicio (el flag y el valor van ACOPLADOS: comision_descontada=TRUE
-- significa que valor_total es el neto y el bruto = valor_total + comisión):
--   · comision_descontada: FALSE → TRUE
--   · valor_total: bruto → neto (bruto − comisión)
--   · valor_pagado: → neto (el técnico recibió el neto; corrige de paso el doble
--     conteo de CENICITA, que tenía valor_pagado > bruto)
--   · estado_pago: COMPLETO (neto pagado en su totalidad)
-- `valor_plan` (precio de lista, bruto) NO cambia.
--
-- Los cuadres CERRADOS conservan su snapshot; los BORRADOR toman el valor nuevo
-- al regenerarse (y el frontend ya deriva el neto correcto de todos modos).
-- Ningún trigger de `servicios` pisa estas columnas (verificado en prod).
--
-- Aplicar por SSH→psql en Contabo. Idempotente (tras correr, la condición del
-- total_cobrado == neto ya no vuelve a coincidir).
-- ============================================================================

BEGIN;

CREATE TEMP TABLE tmp_fix_072 ON COMMIT DROP AS
SELECT s.id,
       s.valor_total                          AS bruto,
       s.comision_aliado                      AS com,
       (s.valor_total - s.comision_aliado)    AS neto,
       s.valor_pagado                         AS vp_old
FROM public.servicios s
JOIN public.aliados a ON a.id_aliado = s.aliado_origen_id
WHERE a.modalidad_comision = 'DESCUENTO_INMEDIATO'
  AND COALESCE(s.comision_descontada, false) = false
  AND COALESCE(s.comision_aliado, 0) > 0
  AND s.fecha_ingreso >= '2026-06-09'
  AND s.estado <> 'CANCELADO'
  AND EXISTS (
    SELECT 1 FROM public.cuadre_items ci
    WHERE ci.servicio_id = s.id
      AND ci.total_cobrado = s.valor_total - s.comision_aliado
  );

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM tmp_fix_072;
  RAISE NOTICE 'Servicios a corregir (comisión descontada): %', v_n;
END $$;

-- Auditoría por servicio ANTES de mover los valores
INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion)
SELECT id, 'NOTA',
  'Corrección automática (migración 072): la comisión SÍ se descontó — el técnico '
  || 'recogió el neto. comision_descontada FALSE→TRUE; valor_total '
  || to_char(bruto, 'FM$999,999,999') || '→' || to_char(neto, 'FM$999,999,999')
  || '; valor_pagado ' || to_char(vp_old, 'FM$999,999,999') || '→' || to_char(neto, 'FM$999,999,999')
  || '. La comisión (' || to_char(com, 'FM$999,999,999') || ') queda saldada, ya no pendiente con la veterinaria.'
FROM tmp_fix_072;

UPDATE public.servicios s SET
  comision_descontada = true,
  valor_total         = t.neto,
  valor_pagado        = t.neto,
  estado_pago         = 'COMPLETO'
FROM tmp_fix_072 t
WHERE s.id = t.id;

COMMIT;
