-- 204 · Entregas de compras de recordatorios SIN servicio, con cobro en la puerta
--
-- Hasta aquí una entrega era SIEMPRE de un servicio (`entregas.servicio_id`
-- NOT NULL). Las compras de recordatorios sin servicio funerario (migr. 168 y
-- 200) se entregaban «a mano»: nadie las veía en la app del mensajero y la
-- plata que él cobraba no tenía dónde quedar.
--
-- Qué cambia:
--   1. `entregas.compra_id`: una entrega es de un servicio O de una compra
--      (CHECK XOR). Una sola entrega por compra (índice único parcial).
--   2. `servicio_id` deja de ser NOT NULL. Lo que filtra por servicio_id
--      (triggers 169/173/185, entrega_es_mia, cascarón del servicio) sigue
--      igual: una entrega de compra simplemente no le aparece.
--   3. Evento `ENTREGA` en la bitácora de la compra (programada, completada).
--   4. `generar_cuadre_tecnico`: el lazo de cobros en entrega pasa de
--      JOIN servicios a LEFT JOIN servicios + compras. Es la definición que
--      corría en producción el 2026-11-03 (idéntica a la 191) con SOLO ese
--      cambio; el resto de la función no se tocó.
--
-- Quién escribe: programar y completar una entrega de compra va por
-- orbit-backend (transacción + pago en compra_recordatorio_pagos + líneas a
-- ENTREGADO + evento). El navegador no escribe estas filas directo.
--
-- ⚠️ ORDEN DE DESPLIEGUE: esta migración ANTES del frontend. La app del
-- mensajero pide `compra:compra_id(...)`; sin la columna, PostgREST falla y
-- la pestaña Entregas se queda vacía.
--
-- Aplicar:
--   cat migrations/204_entregas_de_compras.sql | ssh -i ~/.ssh/orbit_deploy root@13.140.139.61 --     "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 -f -"
--
-- Verificar:
--   SELECT count(*) FILTER (WHERE servicio_id IS NULL) AS de_compra, count(*) FROM public.entregas;
--   -- y regenerar un cuadre BORRADOR de un mensajero: las cifras no cambian.
--
-- Reversa (solo si no hay entregas de compra):
--   DROP INDEX public.uq_entregas_compra;
--   ALTER TABLE public.entregas DROP CONSTRAINT entregas_servicio_o_compra_check,
--     DROP COLUMN compra_id, ALTER COLUMN servicio_id SET NOT NULL;
--   y volver a correr la definición de generar_cuadre_tecnico de la migración 191.

ALTER TABLE public.entregas
  ADD COLUMN IF NOT EXISTS compra_id uuid REFERENCES public.compras_recordatorios(id);

COMMENT ON COLUMN public.entregas.compra_id IS
  'Compra de recordatorios sin servicio (migr. 204). Excluyente con servicio_id: una entrega es de uno o de otro.';

ALTER TABLE public.entregas ALTER COLUMN servicio_id DROP NOT NULL;

ALTER TABLE public.entregas DROP CONSTRAINT IF EXISTS entregas_servicio_o_compra_check;
ALTER TABLE public.entregas ADD CONSTRAINT entregas_servicio_o_compra_check
  CHECK ((servicio_id IS NULL) <> (compra_id IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS uq_entregas_compra
  ON public.entregas (compra_id) WHERE compra_id IS NOT NULL;

-- Bitácora de la compra: la entrega deja su rastro.
-- El CHECK de la 168 se declaró en línea: su nombre lo puso Postgres. Se busca
-- por definición para no depender de adivinarlo.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.compra_recordatorio_eventos'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%tipo%'
  LOOP
    EXECUTE format('ALTER TABLE public.compra_recordatorio_eventos DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE public.compra_recordatorio_eventos ADD CONSTRAINT compra_recordatorio_eventos_tipo_check
  CHECK (tipo IN ('CREADA','PAGO','ESTADO_ITEM','DATOS_ITEM','ANULADA','NOTA','ENTREGA'));

-- ── generar_cuadre_tecnico: cobros en entrega de servicios Y de compras ─────
CREATE OR REPLACE FUNCTION public.generar_cuadre_tecnico(p_tecnico_id uuid, p_desde date, p_hasta date, p_actor_id uuid DEFAULT NULL::uuid, p_ajustes_manuales numeric DEFAULT 0, p_ajustes_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cuadre_id        uuid;
  v_posterior        numeric;
  v_rec              record;
  v_can              record;
  v_sr               record;
  v_ent              record;   -- cobro hecho en la entrega (migr. 152)
  v_prev_ent         jsonb   := '{}'::jsonb;   -- ediciones previas POR ENTREGA
  v_tarifa_dom       numeric := 0;
  v_tarifa_fes       numeric := 0;
  v_tarifa_noc       numeric := 0;
  v_tarifa_lej       numeric := 0;
  v_tarifa_can       numeric := 0;
  v_lej_svcs         uuid[]  := ARRAY[]::uuid[];
  v_prev             jsonb   := '{}'::jsonb;
  v_p                jsonb;
  v_medios           jsonb;
  v_vehiculo         text;
  v_es_moto          boolean;
  v_a_cobrar         numeric;
  v_efectivo         numeric;
  v_digital          numeric;
  v_cruce            numeric;   -- comision vieja pagada a la vet dentro del recibo (migr. 166)
  v_nmedios          int;
  v_es_dom           boolean;
  v_es_fes           boolean;
  v_es_noc           boolean;
  v_es_lej           boolean;
  v_dia_recargo      numeric;
  v_recargo          numeric;
  v_pago             numeric;
  v_transporte       numeric;
  v_sin_dato         boolean;
  v_via              text;
  v_n                int     := 0;
  v_tot_cobrado      numeric := 0;
  v_tot_efectivo     numeric := 0;
  v_tot_digital      numeric := 0;
  v_tot_transporte   numeric := 0;
  v_tot_recargos     numeric := 0;
  v_tot_pago         numeric := 0;
  v_tot_cancelados   numeric := 0;
  v_tot_reconocido   numeric := 0;
  v_neto             numeric;
  v_entregar         numeric;
  v_saldo_favor      numeric;
BEGIN
  -- 🔒 migr. 191 (RBAC-002): desde el navegador, solo coordinación, y el actor
  -- es la sesión (no lo que declare la petición).
  IF coalesce(auth.jwt() ->> 'role', '') = 'authenticated' THEN
    IF NOT public.es_coordinacion() THEN
      RAISE EXCEPTION 'Solo coordinación puede hacer esto' USING ERRCODE = '42501';
    END IF;
    p_actor_id := public.mi_personal_id();
  END IF;
  IF p_tecnico_id IS NULL OR p_desde IS NULL OR p_hasta IS NULL THEN
    RAISE EXCEPTION 'PARAMS_INVALIDOS: tecnico, desde y hasta son obligatorios';
  END IF;
  IF p_hasta < p_desde THEN
    RAISE EXCEPTION 'RANGO_INVALIDO: la fecha hasta no puede ser anterior a desde';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cuadres_tecnico
    WHERE tecnico_id = p_tecnico_id AND fecha_desde = p_desde
      AND fecha_hasta = p_hasta AND estado = 'CERRADO'
  ) THEN
    RAISE EXCEPTION 'CUADRE_CERRADO: ya existe un cuadre CERRADO para este técnico y rango';
  END IF;

  -- Marcas manuales del BORRADOR previo, POR SERVICIO (una fila por servicio).
  -- ⚠️ Las filas de ENTREGA se excluyen: desde la migración 152 un servicio
  -- puede tener DOS filas (su recogida y su entrega) y este mapa está indexado
  -- por servicio_id — sin el filtro, la corrección manual hecha sobre una se le
  -- aplicaría a la otra. Las de entrega llevan su propio mapa (v_prev_ent).
  SELECT
    COALESCE(array_agg(ci.servicio_id) FILTER (WHERE ci.es_lejania AND NOT ci.es_entrega), ARRAY[]::uuid[]),
    COALESCE(jsonb_object_agg(ci.servicio_id::text, jsonb_build_object(
      'obs', ci.observaciones, 'estado', ci.estado_conciliacion,
      'via', ci.conciliacion_via, 'resuelta', ci.conciliacion_resuelta,
      'efectivo', ci.efectivo, 'digital', ci.digital, 'cruce_comision', ci.cruce_comision,
      'medios_pago', ci.medios_pago,
      'medios_pago_original', ci.medios_pago_original, 'medios_editado_en', ci.medios_editado_en,
      'medios_editado_por', ci.medios_editado_por, 'medios_motivo', ci.medios_motivo,
      'valor_recogido_original', ci.valor_recogido_original, 'valor_recogido_editado_en', ci.valor_recogido_editado_en,
      'valor_recogido_editado_por', ci.valor_recogido_editado_por, 'valor_recogido_motivo', ci.valor_recogido_motivo,
      'recargo_aplicado', ci.recargo_aplicado, 'recargo_manual_original', ci.recargo_manual_original,
      'recargo_manual_editado_en', ci.recargo_manual_editado_en, 'recargo_manual_editado_por', ci.recargo_manual_editado_por,
      'recargo_manual_motivo', ci.recargo_manual_motivo,
      'pago_servicio', ci.pago_servicio, 'pago_servicio_original', ci.pago_servicio_original,
      'pago_servicio_editado_en', ci.pago_servicio_editado_en, 'pago_servicio_editado_por', ci.pago_servicio_editado_por,
      'pago_servicio_motivo', ci.pago_servicio_motivo))
      FILTER (WHERE ci.servicio_id IS NOT NULL AND NOT ci.es_entrega), '{}'::jsonb)
    INTO v_lej_svcs, v_prev
  FROM public.cuadre_items ci
  JOIN public.cuadres_tecnico c ON c.id = ci.cuadre_id
  WHERE c.tecnico_id = p_tecnico_id AND c.fecha_desde = p_desde
    AND c.fecha_hasta = p_hasta AND c.estado = 'BORRADOR';

  -- Las mismas marcas manuales, pero de las filas de ENTREGA y por entrega_id.
  -- Sin esto, regenerar el borrador borraría lo que el coordinador corrigió con
  -- el lápiz sobre un cobro en la puerta (reclasificar el medio, o reconocerle
  -- un pago por la entrega).
  SELECT COALESCE(jsonb_object_agg(ci.entrega_id::text, jsonb_build_object(
      'obs', ci.observaciones, 'estado', ci.estado_conciliacion,
      'via', ci.conciliacion_via, 'resuelta', ci.conciliacion_resuelta,
      'efectivo', ci.efectivo, 'digital', ci.digital, 'medios_pago', ci.medios_pago,
      'medios_pago_original', ci.medios_pago_original, 'medios_editado_en', ci.medios_editado_en,
      'medios_editado_por', ci.medios_editado_por, 'medios_motivo', ci.medios_motivo,
      'recargo_aplicado', ci.recargo_aplicado, 'recargo_manual_original', ci.recargo_manual_original,
      'recargo_manual_editado_en', ci.recargo_manual_editado_en, 'recargo_manual_editado_por', ci.recargo_manual_editado_por,
      'recargo_manual_motivo', ci.recargo_manual_motivo,
      'pago_servicio', ci.pago_servicio, 'pago_servicio_original', ci.pago_servicio_original,
      'pago_servicio_editado_en', ci.pago_servicio_editado_en, 'pago_servicio_editado_por', ci.pago_servicio_editado_por,
      'pago_servicio_motivo', ci.pago_servicio_motivo))
      FILTER (WHERE ci.entrega_id IS NOT NULL), '{}'::jsonb)
    INTO v_prev_ent
  FROM public.cuadre_items ci
  JOIN public.cuadres_tecnico c ON c.id = ci.cuadre_id
  WHERE c.tecnico_id = p_tecnico_id AND c.fecha_desde = p_desde
    AND c.fecha_hasta = p_hasta AND c.estado = 'BORRADOR';

  DELETE FROM public.cuadres_tecnico
  WHERE tecnico_id = p_tecnico_id AND fecha_desde = p_desde
    AND fecha_hasta = p_hasta AND estado = 'BORRADOR';

  SELECT recargo_dominical, recargo_festivo, recargo_nocturno, recargo_lejania, pago_cancelado
    INTO v_tarifa_dom, v_tarifa_fes, v_tarifa_noc, v_tarifa_lej, v_tarifa_can
  FROM public.tarifas_reconocimiento_tecnico
  WHERE activo ORDER BY updated_at DESC LIMIT 1;
  v_tarifa_dom := COALESCE(v_tarifa_dom, 0);
  v_tarifa_fes := COALESCE(v_tarifa_fes, 0);
  v_tarifa_noc := COALESCE(v_tarifa_noc, 0);
  v_tarifa_lej := COALESCE(v_tarifa_lej, 0);
  v_tarifa_can := COALESCE(v_tarifa_can, 0);

  SELECT tipo_vehiculo INTO v_vehiculo FROM public.personal WHERE id = p_tecnico_id;
  v_es_moto := upper(COALESCE(v_vehiculo, '')) = 'MOTO';

  INSERT INTO public.cuadres_tecnico (
    tecnico_id, fecha_desde, fecha_hasta, estado,
    ajustes_manuales, ajustes_motivo, generado_por
  ) VALUES (
    p_tecnico_id, p_desde, p_hasta, 'BORRADOR',
    COALESCE(p_ajustes_manuales, 0), NULLIF(p_ajustes_motivo,''), p_actor_id
  )
  RETURNING id INTO v_cuadre_id;

  -- ── Recibos: UN recibo "contado" por servicio (regla migración 027) ────────
  FOR v_rec IN
    SELECT r.id AS recibo_id, r.servicio_id, r.fecha_emision, r.hora_emision,
           r.valor_cobrado, r.medios_pago, r.valor_total AS recibo_valor_total,
           s.valor_transporte, s.ciudad_recogida, s.plan_id,
           s.valor_total AS svc_valor_total, s.valor_plan AS svc_valor_plan,
           s.valor_adicionales AS svc_valor_adic,
           COALESCE(s.comision_aliado, 0) AS svc_comision,
           s.comision_descontada AS svc_comdesc,
           a.nombre AS veterinaria, a.modalidad_comision AS svc_modalidad,
           m.nombre AS mascota_nombre,
           p.nombre AS plan_nombre
    FROM (
      -- El recibo "contado" del servicio: el más reciente CON dinero;
      -- si ninguno tiene dinero, el más reciente. Elegido entre TODOS los
      -- recibos del servicio (los demás son documentos, no cuentan plata).
      SELECT DISTINCT ON (rt.servicio_id) rt.*
      FROM public.recibos_tecnico rt
      CROSS JOIN LATERAL (
        SELECT COALESCE(
                 (SELECT SUM(mp.monto) FROM public.recibo_medios_pago mp WHERE mp.recibo_id = rt.id),
                 (SELECT SUM(NULLIF(e->>'monto','')::numeric)
                    FROM jsonb_array_elements(COALESCE(rt.medios_pago,'[]'::jsonb)) e),
                 0) AS cobrado
      ) mm
      ORDER BY rt.servicio_id, (mm.cobrado > 0) DESC, rt.created_at DESC
    ) r
    JOIN public.servicios s ON s.id = r.servicio_id
    LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
    LEFT JOIN public.planes   p ON p.id = s.plan_id
    LEFT JOIN public.aliados  a ON a.id_aliado = s.aliado_origen_id
    WHERE r.tecnico_id = p_tecnico_id
      AND s.fecha_ingreso BETWEEN p_desde AND p_hasta
      AND s.estado <> 'CANCELADO'
      -- El dinero del servicio ya se cuadró y CERRÓ (fila con recibo) → fuera.
      -- Filas sin_recibo/cancelado cerradas NO bloquean un cobro posterior.
      AND NOT EXISTS (
        SELECT 1 FROM public.cuadre_items ci2
        JOIN public.cuadres_tecnico c2 ON c2.id = ci2.cuadre_id
        WHERE ci2.servicio_id = r.servicio_id
          AND ci2.recibo_id IS NOT NULL
          AND c2.estado = 'CERRADO'
      )
    ORDER BY s.fecha_ingreso, r.hora_emision
  LOOP
    SELECT COALESCE(SUM(monto) FILTER (WHERE upper(metodo) = 'EFECTIVO'), 0),
           COALESCE(SUM(monto) FILTER (WHERE upper(metodo) NOT IN ('EFECTIVO','CRUCE_COMISION')), 0),
           COALESCE(SUM(monto) FILTER (WHERE upper(metodo) = 'CRUCE_COMISION'), 0),
           COUNT(*),
           COALESCE(jsonb_agg(jsonb_build_object('metodo', metodo, 'monto', monto)
                              ORDER BY created_at), '[]'::jsonb)
      INTO v_efectivo, v_digital, v_cruce, v_nmedios, v_medios
    FROM public.recibo_medios_pago
    WHERE recibo_id = v_rec.recibo_id;

    IF v_nmedios = 0 THEN
      SELECT COALESCE(SUM(CASE WHEN upper(elem->>'metodo') = 'EFECTIVO'
                               THEN NULLIF(elem->>'monto','')::numeric ELSE 0 END), 0),
             COALESCE(SUM(CASE WHEN upper(elem->>'metodo') NOT IN ('EFECTIVO','CRUCE_COMISION')
                               THEN NULLIF(elem->>'monto','')::numeric ELSE 0 END), 0),
             COALESCE(SUM(CASE WHEN upper(elem->>'metodo') = 'CRUCE_COMISION'
                               THEN NULLIF(elem->>'monto','')::numeric ELSE 0 END), 0)
        INTO v_efectivo, v_digital, v_cruce
      FROM jsonb_array_elements(COALESCE(v_rec.medios_pago, '[]'::jsonb)) elem;
      v_medios := COALESCE(v_rec.medios_pago, '[]'::jsonb);
    END IF;

    v_es_dom := extract(isodow FROM v_rec.fecha_emision) = 7;
    v_es_fes := EXISTS (SELECT 1 FROM public.festivos f WHERE f.fecha = v_rec.fecha_emision);
    v_es_noc := v_rec.hora_emision IS NOT NULL AND v_rec.hora_emision >= TIME '18:00';
    v_es_lej := v_rec.servicio_id = ANY(v_lej_svcs);

    v_dia_recargo := CASE WHEN v_es_fes THEN v_tarifa_fes
                          WHEN v_es_dom THEN v_tarifa_dom
                          ELSE 0 END;
    v_recargo := v_dia_recargo
                 + CASE WHEN v_es_noc THEN v_tarifa_noc ELSE 0 END
                 + CASE WHEN v_es_lej THEN v_tarifa_lej ELSE 0 END;

    v_pago := 0;
    IF v_rec.plan_id IS NOT NULL THEN
      SELECT CASE WHEN v_es_moto THEN monto_moto ELSE monto_carro END
        INTO v_pago
      FROM public.tarifas_pago_tecnico_servicio
      WHERE plan_id = v_rec.plan_id;
    END IF;
    v_pago := COALESCE(v_pago, 0);

    v_transporte := COALESCE(v_rec.valor_transporte, 0);
    v_sin_dato   := v_rec.valor_transporte IS NULL
                    AND COALESCE(v_rec.ciudad_recogida, 'Bogotá') <> 'Bogotá';

    v_a_cobrar := COALESCE(v_rec.svc_valor_total, 0)
                  + CASE WHEN v_rec.svc_comdesc THEN v_rec.svc_comision ELSE 0 END;

    -- Lo que se le sumo al servicio DESPUES de que el tecnico emitio su recibo:
    -- adicionales vendidos cuando el ya no estaba. No es plata suya. Se guarda
    -- aparte para que la diferencia del cuadre no se la cobre a el; el saldo
    -- sigue vivo en la cartera de Finanzas, que es donde se persigue el cobro.
    -- Se ignora el caso contrario (el servicio bajo de precio): eso ya lo trata
    -- `excesoValorARecoger`.
    v_posterior := CASE
      WHEN COALESCE(v_rec.recibo_valor_total, 0) > 0
       AND v_a_cobrar > v_rec.recibo_valor_total
      THEN v_a_cobrar - v_rec.recibo_valor_total
      ELSE 0
    END;

    v_p := v_prev -> (v_rec.servicio_id::text);
    -- Vía: preserva la manual; si no, facturación mensual entra a Conciliaciones.
    v_via := COALESCE(v_p->>'via',
                      CASE WHEN v_rec.svc_modalidad = 'FACTURACION_MENSUAL'
                           THEN 'FACTURACION_MENSUAL' END);

    -- Facturación mensual: el técnico NO recoge esta plata — el aliado la paga
    -- por factura al cierre del mes. El recibo VET quedaba con el valor
    -- prellenado como EFECTIVO y inflaba el dinero a entregar (migración 068).
    -- Si de verdad recibió algo, el coordinador lo corrige con el lápiz y esa
    -- edición manda: se aplica abajo, después de esto.
    IF v_rec.svc_modalidad = 'FACTURACION_MENSUAL' THEN
      v_efectivo := 0;
      v_digital  := 0;
      v_cruce    := 0;
      v_medios   := '[]'::jsonb;
    END IF;

    -- Preserva las ediciones manuales del BORRADOR previo (la correccion del
    -- admin es autoritativa y no debe perderse al regenerar): reclasificacion de
    -- medios, valor recogido, recargo manual y pago al tecnico, por servicio.
    IF (v_p->>'medios_editado_en') IS NOT NULL THEN
      v_medios := COALESCE(v_p->'medios_pago', v_medios);
    END IF;
    IF (v_p->>'valor_recogido_editado_en') IS NOT NULL
       OR (v_p->>'medios_editado_en') IS NOT NULL THEN
      v_efectivo := COALESCE((v_p->>'efectivo')::numeric, v_efectivo);
      v_digital  := COALESCE((v_p->>'digital')::numeric, v_digital);
      v_cruce    := COALESCE((v_p->>'cruce_comision')::numeric, v_cruce);
    END IF;
    IF (v_p->>'recargo_manual_editado_en') IS NOT NULL THEN
      v_recargo := COALESCE((v_p->>'recargo_aplicado')::numeric, v_recargo);
    END IF;
    IF (v_p->>'pago_servicio_editado_en') IS NOT NULL THEN
      v_pago := COALESCE((v_p->>'pago_servicio')::numeric, v_pago);
    END IF;

    INSERT INTO public.cuadre_items (
      cuadre_id, servicio_id, recibo_id, fecha, hora,
      mascota_nombre, ciudad, plan_nombre, vehiculo, veterinaria, modalidad_comision, comision,
      valor_a_cobrar, valor_a_recoger, valor_plan, valor_adicionales, valor_posterior_recibo,
      total_cobrado, efectivo, digital, cruce_comision, medios_pago,
      transporte_reconocido, transporte_sin_dato,
      es_dominical, es_festivo, es_nocturno, es_lejania, recargo_aplicado, pago_servicio, es_cancelado,
      observaciones, estado_conciliacion, conciliacion_via, conciliacion_resuelta,
      medios_pago_original, medios_editado_en, medios_editado_por, medios_motivo,
      valor_recogido_original, valor_recogido_editado_en, valor_recogido_editado_por, valor_recogido_motivo,
      recargo_manual_original, recargo_manual_editado_en, recargo_manual_editado_por, recargo_manual_motivo,
      pago_servicio_original, pago_servicio_editado_en, pago_servicio_editado_por, pago_servicio_motivo
    ) VALUES (
      v_cuadre_id, v_rec.servicio_id, v_rec.recibo_id, v_rec.fecha_emision, v_rec.hora_emision,
      v_rec.mascota_nombre, v_rec.ciudad_recogida, v_rec.plan_nombre, v_vehiculo, v_rec.veterinaria, v_rec.svc_modalidad, v_rec.svc_comision,
      v_a_cobrar, COALESCE(v_rec.svc_valor_total, 0), v_rec.svc_valor_plan, v_rec.svc_valor_adic, v_posterior,
      v_efectivo + v_digital + v_cruce, v_efectivo, v_digital, v_cruce, v_medios,
      v_transporte, v_sin_dato,
      v_es_dom, v_es_fes, v_es_noc, v_es_lej, v_recargo, v_pago, false,
      NULLIF(v_p->>'obs',''), v_p->>'estado', v_via,
      COALESCE((v_p->>'resuelta')::boolean, false),
      v_p->'medios_pago_original', (v_p->>'medios_editado_en')::timestamptz, (v_p->>'medios_editado_por')::uuid, NULLIF(v_p->>'medios_motivo',''),
      (v_p->>'valor_recogido_original')::numeric, (v_p->>'valor_recogido_editado_en')::timestamptz, (v_p->>'valor_recogido_editado_por')::uuid, NULLIF(v_p->>'valor_recogido_motivo',''),
      (v_p->>'recargo_manual_original')::numeric, (v_p->>'recargo_manual_editado_en')::timestamptz, (v_p->>'recargo_manual_editado_por')::uuid, NULLIF(v_p->>'recargo_manual_motivo',''),
      (v_p->>'pago_servicio_original')::numeric, (v_p->>'pago_servicio_editado_en')::timestamptz, (v_p->>'pago_servicio_editado_por')::uuid, NULLIF(v_p->>'pago_servicio_motivo','')
    );

    v_n              := v_n + 1;
    v_tot_cobrado    := v_tot_cobrado    + v_efectivo + v_digital + v_cruce;
    v_tot_efectivo   := v_tot_efectivo   + v_efectivo;
    v_tot_digital    := v_tot_digital    + v_digital;
    v_tot_transporte := v_tot_transporte + v_transporte;
    v_tot_recargos   := v_tot_recargos   + v_recargo;
    v_tot_pago       := v_tot_pago       + v_pago;
  END LOOP;

  -- ── Servicios recogidos por el técnico SIN recibo (no cobró) ──────────────
  FOR v_sr IN
    SELECT s.id AS servicio_id, s.fecha_ingreso, s.ciudad_recogida, s.plan_id,
           s.valor_total AS svc_valor_total, s.valor_plan AS svc_valor_plan,
           s.valor_adicionales AS svc_valor_adic,
           COALESCE(s.comision_aliado, 0) AS svc_comision,
           s.comision_descontada AS svc_comdesc,
           a.nombre AS veterinaria, a.modalidad_comision AS svc_modalidad,
           m.nombre AS mascota_nombre, p.nombre AS plan_nombre
    FROM public.servicios s
    LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
    LEFT JOIN public.planes   p ON p.id = s.plan_id
    LEFT JOIN public.aliados  a ON a.id_aliado = s.aliado_origen_id
    WHERE s.estado <> 'CANCELADO'
      AND s.fecha_ingreso BETWEEN p_desde AND p_hasta
      AND COALESCE(
            (SELECT rg.tecnico_id FROM public.recogidas rg
               WHERE rg.servicio_id = s.id AND rg.tecnico_id IS NOT NULL
               ORDER BY rg.id DESC LIMIT 1),
            s.tecnico_id
          ) = p_tecnico_id
      -- sin NINGÚN recibo (si tuviera, lo maneja el loop de recibos arriba)
      AND NOT EXISTS (
        SELECT 1 FROM public.recibos_tecnico r WHERE r.servicio_id = s.id
      )
      -- no incluido ya en un cuadre CERRADO
      -- ⚠️ `AND NOT ci2.es_entrega`: una fila de entrega cerrada NO significa
      -- que la recogida de ese servicio ya se haya cuadrado. Sin este filtro,
      -- cobrar en la puerta y cerrar ese cuadre habría hecho desaparecer para
      -- siempre la recogida sin recibo del mismo servicio (migr. 152).
      AND NOT EXISTS (
        SELECT 1 FROM public.cuadre_items ci2
        JOIN public.cuadres_tecnico c2 ON c2.id = ci2.cuadre_id
        WHERE ci2.servicio_id = s.id AND NOT ci2.es_entrega AND c2.estado = 'CERRADO'
      )
    ORDER BY s.fecha_ingreso
  LOOP
    v_a_cobrar := COALESCE(v_sr.svc_valor_total, 0)
                  + CASE WHEN v_sr.svc_comdesc THEN v_sr.svc_comision ELSE 0 END;
    v_p := v_prev -> (v_sr.servicio_id::text);
    v_via := COALESCE(v_p->>'via',
                      CASE WHEN v_sr.svc_modalidad = 'FACTURACION_MENSUAL'
                           THEN 'FACTURACION_MENSUAL' ELSE 'LLAMAR_COBRAR' END);

    -- Sin recibo no hay hora ni fecha de emisión: los recargos automáticos no
    -- aplican, pero la lejanía marcada a mano y las correcciones manuales del
    -- coordinador sí se conservan al regenerar (067).
    v_es_lej  := v_sr.servicio_id = ANY(v_lej_svcs);
    v_recargo := CASE WHEN v_es_lej THEN v_tarifa_lej ELSE 0 END;
    IF (v_p->>'recargo_manual_editado_en') IS NOT NULL THEN
      v_recargo := COALESCE((v_p->>'recargo_aplicado')::numeric, v_recargo);
    END IF;
    v_pago := 0;
    IF (v_p->>'pago_servicio_editado_en') IS NOT NULL THEN
      v_pago := COALESCE((v_p->>'pago_servicio')::numeric, 0);
    END IF;

    INSERT INTO public.cuadre_items (
      cuadre_id, servicio_id, recibo_id, fecha, hora,
      mascota_nombre, ciudad, plan_nombre, vehiculo, veterinaria, modalidad_comision, comision,
      valor_a_cobrar, valor_a_recoger, valor_plan, valor_adicionales,
      total_cobrado, efectivo, digital, medios_pago,
      transporte_reconocido, transporte_sin_dato,
      es_dominical, es_festivo, es_nocturno, es_lejania, recargo_aplicado, pago_servicio, es_cancelado,
      observaciones, estado_conciliacion, conciliacion_via, conciliacion_resuelta, sin_recibo,
      recargo_manual_original, recargo_manual_editado_en, recargo_manual_editado_por, recargo_manual_motivo,
      pago_servicio_original, pago_servicio_editado_en, pago_servicio_editado_por, pago_servicio_motivo
    ) VALUES (
      v_cuadre_id, v_sr.servicio_id, NULL, v_sr.fecha_ingreso, NULL,
      v_sr.mascota_nombre, v_sr.ciudad_recogida, v_sr.plan_nombre, v_vehiculo, v_sr.veterinaria, v_sr.svc_modalidad, v_sr.svc_comision,
      v_a_cobrar, COALESCE(v_sr.svc_valor_total, 0), v_sr.svc_valor_plan, v_sr.svc_valor_adic,
      0, 0, 0, '[]'::jsonb,
      0, false,
      false, false, false, v_es_lej, v_recargo, v_pago, false,
      NULLIF(v_p->>'obs',''), v_p->>'estado', v_via,
      COALESCE((v_p->>'resuelta')::boolean, false), true,
      (v_p->>'recargo_manual_original')::numeric, (v_p->>'recargo_manual_editado_en')::timestamptz, (v_p->>'recargo_manual_editado_por')::uuid, NULLIF(v_p->>'recargo_manual_motivo',''),
      (v_p->>'pago_servicio_original')::numeric, (v_p->>'pago_servicio_editado_en')::timestamptz, (v_p->>'pago_servicio_editado_por')::uuid, NULLIF(v_p->>'pago_servicio_motivo','')
    );
    v_n            := v_n + 1;
    v_tot_recargos := v_tot_recargos + v_recargo;
    v_tot_pago     := v_tot_pago     + v_pago;
  END LOOP;

  -- ── Servicios CANCELADOS con el técnico ya despachado (viaje perdido) ─────
  -- Entran SIEMPRE (aunque la tarifa esté en 0): el coordinador decide cuánto
  -- reconocer con el lápiz de "Pago téc." y el de recargo (067).
  FOR v_can IN
    SELECT s.id AS servicio_id, s.cancelado_en, s.ciudad_recogida,
           s.valor_total AS svc_valor_total, s.valor_plan AS svc_valor_plan,
           s.valor_adicionales AS svc_valor_adic,
           COALESCE(s.comision_aliado, 0) AS svc_comision,
           s.comision_descontada AS svc_comdesc,
           a.nombre AS veterinaria, a.modalidad_comision AS svc_modalidad,
           m.nombre AS mascota_nombre, p.nombre AS plan_nombre
    FROM public.servicios s
    LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
    LEFT JOIN public.planes   p ON p.id = s.plan_id
    LEFT JOIN public.aliados  a ON a.id_aliado = s.aliado_origen_id
    WHERE s.estado = 'CANCELADO'
      AND s.cancelado_en IS NOT NULL
      AND s.cancelado_en::date BETWEEN p_desde AND p_hasta
      AND COALESCE(s.etapa_cancelacion, 'INGRESADO') <> 'INGRESADO'
      AND COALESCE(
            (SELECT rg.tecnico_id FROM public.recogidas rg
               WHERE rg.servicio_id = s.id AND rg.tecnico_id IS NOT NULL
               ORDER BY rg.id DESC LIMIT 1),
            s.tecnico_id
          ) = p_tecnico_id
      AND NOT EXISTS (
        SELECT 1 FROM public.cuadre_items ci2
        JOIN public.cuadres_tecnico c2 ON c2.id = ci2.cuadre_id
        WHERE ci2.servicio_id = s.id AND ci2.es_cancelado AND c2.estado = 'CERRADO'
      )
    ORDER BY s.cancelado_en
  LOOP
    v_a_cobrar := COALESCE(v_can.svc_valor_total, 0)
                  + CASE WHEN v_can.svc_comdesc THEN v_can.svc_comision ELSE 0 END;
    v_p := v_prev -> (v_can.servicio_id::text);
    v_via := COALESCE(v_p->>'via',
                      CASE WHEN v_can.svc_modalidad = 'FACTURACION_MENSUAL'
                           THEN 'FACTURACION_MENSUAL' END);

    -- Pago del viaje perdido: tarifa fija, salvo corrección manual del cuadre.
    v_pago := v_tarifa_can;
    IF (v_p->>'pago_servicio_editado_en') IS NOT NULL THEN
      v_pago := COALESCE((v_p->>'pago_servicio')::numeric, v_tarifa_can);
    END IF;
    -- Lejanía marcada a mano y recargo manual (el cancelado no tiene recibo del
    -- que deducir dominical/festivo/nocturno).
    v_es_lej  := v_can.servicio_id = ANY(v_lej_svcs);
    v_recargo := CASE WHEN v_es_lej THEN v_tarifa_lej ELSE 0 END;
    IF (v_p->>'recargo_manual_editado_en') IS NOT NULL THEN
      v_recargo := COALESCE((v_p->>'recargo_aplicado')::numeric, v_recargo);
    END IF;

    INSERT INTO public.cuadre_items (
      cuadre_id, servicio_id, recibo_id, fecha, hora,
      mascota_nombre, ciudad, plan_nombre, vehiculo, veterinaria, modalidad_comision, comision,
      valor_a_cobrar, valor_a_recoger, valor_plan, valor_adicionales,
      total_cobrado, efectivo, digital, medios_pago,
      transporte_reconocido, transporte_sin_dato,
      es_dominical, es_festivo, es_nocturno, es_lejania, recargo_aplicado, pago_servicio, es_cancelado,
      observaciones, estado_conciliacion, conciliacion_via, conciliacion_resuelta,
      recargo_manual_original, recargo_manual_editado_en, recargo_manual_editado_por, recargo_manual_motivo,
      pago_servicio_original, pago_servicio_editado_en, pago_servicio_editado_por, pago_servicio_motivo
    ) VALUES (
      v_cuadre_id, v_can.servicio_id, NULL, v_can.cancelado_en::date, NULL,
      v_can.mascota_nombre, v_can.ciudad_recogida, v_can.plan_nombre, v_vehiculo, v_can.veterinaria, v_can.svc_modalidad, v_can.svc_comision,
      v_a_cobrar, COALESCE(v_can.svc_valor_total, 0), v_can.svc_valor_plan, v_can.svc_valor_adic,
      0, 0, 0, '[]'::jsonb,
      0, false,
      false, false, false, v_es_lej, v_recargo, v_pago, true,
      NULLIF(v_p->>'obs',''), v_p->>'estado', v_via,
      COALESCE((v_p->>'resuelta')::boolean, false),
      (v_p->>'recargo_manual_original')::numeric, (v_p->>'recargo_manual_editado_en')::timestamptz, (v_p->>'recargo_manual_editado_por')::uuid, NULLIF(v_p->>'recargo_manual_motivo',''),
      (v_p->>'pago_servicio_original')::numeric, (v_p->>'pago_servicio_editado_en')::timestamptz, (v_p->>'pago_servicio_editado_por')::uuid, NULLIF(v_p->>'pago_servicio_motivo','')
    );
    v_n              := v_n + 1;
    v_tot_cancelados := v_tot_cancelados + v_pago;
    v_tot_recargos   := v_tot_recargos   + v_recargo;
  END LOOP;

  -- ── Dinero que el mensajero cobró AL ENTREGAR (migración 152) ─────────────
  -- Se fecha por el día del cobro (`fecha_realizada` de la entrega, que se
  -- escribe con la fecha LOCAL), no por el ingreso del servicio: la deuda del
  -- mensajero nace el día que recibe la plata. `cobro_registrado_en` es
  -- timestamptz y solo se usa de respaldo, convertido a hora de Bogotá — en UTC
  -- un cobro de la noche saltaría al día siguiente.
  FOR v_ent IN
    SELECT e.id AS entrega_id, e.servicio_id,
           COALESCE(e.cobro_monto, 0) AS monto,
           upper(COALESCE(e.cobro_metodo, 'EFECTIVO')) AS metodo,
           COALESCE(e.fecha_realizada,
                    (e.cobro_registrado_en AT TIME ZONE 'America/Bogota')::date) AS fecha_cobro,
           e.hora_realizada,
           COALESCE(s.ciudad_recogida, e.ciudad) AS ciudad_recogida, s.plan_id,
           a.nombre AS veterinaria,
           m.nombre AS mascota_nombre,
           COALESCE(p.nombre, 'Compra CR-' || cr.numero) AS plan_nombre
    FROM public.entregas e
    -- Migr. 204: una entrega es de un servicio O de una compra de recordatorios
    -- sin servicio. Con el JOIN de antes, el efectivo cobrado al entregar una
    -- compra desaparecía del cuadre sin avisar.
    LEFT JOIN public.servicios s ON s.id = e.servicio_id
    LEFT JOIN public.compras_recordatorios cr ON cr.id = e.compra_id
    LEFT JOIN public.mascotas m ON m.id_mascota = COALESCE(s.mascota_id, cr.mascota_id)
    LEFT JOIN public.planes   p ON p.id = s.plan_id
    LEFT JOIN public.aliados  a ON a.id_aliado = s.aliado_origen_id
    WHERE e.cobro_registrado_por = p_tecnico_id
      AND COALESCE(e.cobro_monto, 0) > 0
      -- Servicio cancelado: fuera, como siempre. Compra ANULADA: se queda,
      -- porque anular conserva los pagos y el mensajero sí tiene esa plata.
      AND ((s.id IS NOT NULL AND s.estado <> 'CANCELADO') OR cr.id IS NOT NULL)
      AND COALESCE(e.fecha_realizada,
                   (e.cobro_registrado_en AT TIME ZONE 'America/Bogota')::date)
          BETWEEN p_desde AND p_hasta
      -- Descarte por ENTREGA, no por servicio: la recogida del mismo servicio
      -- se cuadra por su lado y no debe taparse con esta.
      AND NOT EXISTS (
        SELECT 1 FROM public.cuadre_items ci2
        JOIN public.cuadres_tecnico c2 ON c2.id = ci2.cuadre_id
        WHERE ci2.entrega_id = e.id AND c2.estado = 'CERRADO'
      )
    ORDER BY COALESCE(e.fecha_realizada,
                      (e.cobro_registrado_en AT TIME ZONE 'America/Bogota')::date),
             e.hora_realizada
  LOOP
    -- Misma regla que en el recibo: solo el efectivo es plata que él tiene en
    -- la mano; lo digital entró directo a la empresa.
    IF v_ent.metodo = 'EFECTIVO' THEN
      v_efectivo := v_ent.monto; v_digital := 0;
    ELSE
      v_efectivo := 0; v_digital := v_ent.monto;
    END IF;
    v_medios := jsonb_build_array(jsonb_build_object('metodo', v_ent.metodo, 'monto', v_ent.monto));

    -- Una entrega no es una recogida: sin transporte y sin recargos de día u
    -- hora. Lo que se le quiera reconocer por entregar se pone con el lápiz.
    v_recargo := 0;
    v_pago    := 0;

    v_p := v_prev_ent -> (v_ent.entrega_id::text);
    IF (v_p->>'medios_editado_en') IS NOT NULL THEN
      v_medios   := COALESCE(v_p->'medios_pago', v_medios);
      v_efectivo := COALESCE((v_p->>'efectivo')::numeric, v_efectivo);
      v_digital  := COALESCE((v_p->>'digital')::numeric, v_digital);
    END IF;
    IF (v_p->>'recargo_manual_editado_en') IS NOT NULL THEN
      v_recargo := COALESCE((v_p->>'recargo_aplicado')::numeric, 0);
    END IF;
    IF (v_p->>'pago_servicio_editado_en') IS NOT NULL THEN
      v_pago := COALESCE((v_p->>'pago_servicio')::numeric, 0);
    END IF;

    INSERT INTO public.cuadre_items (
      cuadre_id, servicio_id, recibo_id, entrega_id, es_entrega, fecha, hora,
      mascota_nombre, ciudad, plan_nombre, vehiculo, veterinaria, modalidad_comision, comision,
      valor_a_cobrar, valor_a_recoger, valor_posterior_recibo,
      total_cobrado, efectivo, digital, medios_pago,
      transporte_reconocido, transporte_sin_dato,
      es_dominical, es_festivo, es_nocturno, es_lejania, recargo_aplicado, pago_servicio, es_cancelado,
      observaciones, estado_conciliacion, conciliacion_via, conciliacion_resuelta,
      medios_pago_original, medios_editado_en, medios_editado_por, medios_motivo,
      recargo_manual_original, recargo_manual_editado_en, recargo_manual_editado_por, recargo_manual_motivo,
      pago_servicio_original, pago_servicio_editado_en, pago_servicio_editado_por, pago_servicio_motivo
    ) VALUES (
      -- `hora_realizada` se escribe como 'HH:MM' desde la app: el cast explícito
      -- evita depender de si la columna quedó como time o como texto.
      v_cuadre_id, v_ent.servicio_id, NULL, v_ent.entrega_id, true, v_ent.fecha_cobro, v_ent.hora_realizada::time,
      v_ent.mascota_nombre, v_ent.ciudad_recogida, v_ent.plan_nombre, v_vehiculo, v_ent.veterinaria, NULL, 0,
      -- Cuadrada por construcción: lo que tenía que recoger en la puerta ES lo
      -- que recogió. El saldo que el cliente haya quedado debiendo se persigue
      -- en la cartera de Finanzas, no en el cuadre (misma frontera de la 143).
      v_ent.monto, v_ent.monto, 0,
      v_efectivo + v_digital, v_efectivo, v_digital, v_medios,
      0, false,
      false, false, false, false, v_recargo, v_pago, false,
      NULLIF(v_p->>'obs',''), v_p->>'estado', v_p->>'via',
      COALESCE((v_p->>'resuelta')::boolean, false),
      v_p->'medios_pago_original', (v_p->>'medios_editado_en')::timestamptz, (v_p->>'medios_editado_por')::uuid, NULLIF(v_p->>'medios_motivo',''),
      (v_p->>'recargo_manual_original')::numeric, (v_p->>'recargo_manual_editado_en')::timestamptz, (v_p->>'recargo_manual_editado_por')::uuid, NULLIF(v_p->>'recargo_manual_motivo',''),
      (v_p->>'pago_servicio_original')::numeric, (v_p->>'pago_servicio_editado_en')::timestamptz, (v_p->>'pago_servicio_editado_por')::uuid, NULLIF(v_p->>'pago_servicio_motivo','')
    );

    v_n            := v_n + 1;
    v_tot_cobrado  := v_tot_cobrado  + v_efectivo + v_digital;
    v_tot_efectivo := v_tot_efectivo + v_efectivo;
    v_tot_digital  := v_tot_digital  + v_digital;
    v_tot_recargos := v_tot_recargos + v_recargo;
    v_tot_pago     := v_tot_pago     + v_pago;
  END LOOP;

  v_tot_reconocido := v_tot_transporte + v_tot_recargos + v_tot_pago + v_tot_cancelados;
  v_neto        := v_tot_efectivo - v_tot_reconocido - COALESCE(p_ajustes_manuales, 0);
  v_entregar    := GREATEST(v_neto, 0);
  v_saldo_favor := GREATEST(-v_neto, 0);

  UPDATE public.cuadres_tecnico SET
    total_servicios       = v_n,
    total_cobrado         = v_tot_cobrado,
    efectivo_recibido     = v_tot_efectivo,
    digital_empresa       = v_tot_digital,
    total_transporte      = v_tot_transporte,
    total_recargos        = v_tot_recargos,
    total_pago_servicio   = v_tot_pago,
    total_cancelados      = v_tot_cancelados,
    total_reconocido      = v_tot_reconocido,
    dinero_a_entregar     = v_entregar,
    saldo_a_favor_tecnico = v_saldo_favor
  WHERE id = v_cuadre_id;

  RETURN jsonb_build_object(
    'cuadre_id', v_cuadre_id,
    'total_servicios', v_n,
    'total_cobrado', v_tot_cobrado,
    'efectivo_recibido', v_tot_efectivo,
    'digital_empresa', v_tot_digital,
    'total_pago_servicio', v_tot_pago,
    'total_cancelados', v_tot_cancelados,
    'total_reconocido', v_tot_reconocido,
    'dinero_a_entregar', v_entregar,
    'saldo_a_favor_tecnico', v_saldo_favor
  );
END;
$function$;
