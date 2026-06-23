-- ============================================================================
-- 010 — Cuadre con técnicos (Finanzas) · Fase 1
-- Fecha: 2026-06-23
--
-- Objetivo (frase rectora): "Cada peso que el técnico recibe en campo debe poder
-- cuadrarse contra lo que entrega a gerencia, separando sin mezclar: lo cobrado
-- al cliente, lo recibido por el técnico, lo que entró directo a la empresa, lo
-- reconocido al técnico y lo que debe entregar."
--
-- Decisiones aprobadas por David (2026-06-23):
--   - El cuadre se arma desde recibos_tecnico (recibo emitido por el técnico),
--     NO desde servicios.valor_pagado (que mezcla cobros de oficina).
--   - SOLO el efectivo se atribuye al técnico. Todo medio digital
--     (transferencia/Nequi/Daviplata/tarjeta) = entró DIRECTO a la empresa.
--   - dinero_a_entregar = efectivo_recibido − total_reconocido − ajustes_manuales
--     · Si da negativo → entrega $0 y queda SALDO A FAVOR del técnico.
--   - Reconocido = transporte (congelado en servicios.valor_transporte) +
--     recargos dominical/festivo/nocturno (montos FIJOS por recogida, globales).
--     · Dominical/festivo por fecha_emision (fn / festivos). Nocturno = hora ≥ 18:00.
--   - Ajustes manuales: a nivel de cuadre completo (monto + motivo).
--   - Transporte: se LEE de servicios.valor_transporte (congelado al registrar).
--     Servicios históricos sin la columna quedan NULL → el cuadre los marca
--     "transporte sin dato" (no se inventa valor; preserva auditabilidad).
--
-- NOTA DESPLIEGUE: migración MANUAL por SSH→psql en Contabo (Supabase Cloud está
-- muerto). Aditiva, idempotente y reversible. No pisa datos.
--   cd /opt/supabase/docker && \
--   docker compose exec -T db psql -U postgres -d postgres --pset pager=off -f - < 010_cuadres_tecnico.sql
-- ============================================================================

BEGIN;

-- ─── 1. Desglose congelado del cobro en `servicios` ─────────────────────────
-- Hereda RLS/GRANTs de `servicios` (ALTER sobre tabla existente). Todas nullable:
-- los servicios históricos quedan NULL y el cuadre los trata como "sin dato".
-- Se llenan desde Registro.jsx (y Kanban.jsx en la conversión de solicitudes).
ALTER TABLE public.servicios
  ADD COLUMN IF NOT EXISTS valor_plan        numeric,
  ADD COLUMN IF NOT EXISTS valor_adicionales numeric,
  ADD COLUMN IF NOT EXISTS valor_transporte  numeric,
  ADD COLUMN IF NOT EXISTS recargo_nocturno  numeric;

COMMENT ON COLUMN public.servicios.valor_transporte
  IS 'Transporte cobrado al cliente, congelado al registrar (recargoCiudad). Fuera de Bogotá = lo que el técnico se lleva. NULL en servicios previos a la migración 010.';

-- ─── 2. tarifas_reconocimiento_tecnico (config global de recargos al técnico) ─
-- Montos FIJOS por recogida. Fila única de configuración (la app lee la activa
-- más reciente). Editable desde Configuración.
CREATE TABLE IF NOT EXISTS public.tarifas_reconocimiento_tecnico (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recargo_dominical numeric NOT NULL DEFAULT 0 CHECK (recargo_dominical >= 0),
  recargo_festivo   numeric NOT NULL DEFAULT 0 CHECK (recargo_festivo   >= 0),
  recargo_nocturno  numeric NOT NULL DEFAULT 0 CHECK (recargo_nocturno  >= 0),
  activo            boolean NOT NULL DEFAULT true,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_tarifas_recon_tecnico_updated ON public.tarifas_reconocimiento_tecnico;
CREATE TRIGGER trg_tarifas_recon_tecnico_updated
  BEFORE UPDATE ON public.tarifas_reconocimiento_tecnico
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Semilla: una fila en cero si la tabla está vacía (no pisa config existente).
INSERT INTO public.tarifas_reconocimiento_tecnico (recargo_dominical, recargo_festivo, recargo_nocturno)
SELECT 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM public.tarifas_reconocimiento_tecnico);

-- ─── 3. cuadres_tecnico (cabecera, totales congelados) ──────────────────────
CREATE TABLE IF NOT EXISTS public.cuadres_tecnico (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tecnico_id            uuid NOT NULL REFERENCES public.personal(id),
  fecha_desde           date NOT NULL,
  fecha_hasta           date NOT NULL,
  estado                varchar NOT NULL DEFAULT 'BORRADOR'
    CHECK (estado IN ('BORRADOR','CERRADO')),
  -- Totales (snapshot). Lado COBRADO al cliente:
  total_servicios       int     NOT NULL DEFAULT 0,
  total_cobrado         numeric NOT NULL DEFAULT 0,   -- efectivo + digital
  -- Lado RECIBIDO / EMPRESA:
  efectivo_recibido     numeric NOT NULL DEFAULT 0,   -- lo que el técnico tiene en mano
  digital_empresa       numeric NOT NULL DEFAULT 0,   -- entró directo a la empresa
  -- Lado RECONOCIDO al técnico:
  total_transporte      numeric NOT NULL DEFAULT 0,
  total_recargos        numeric NOT NULL DEFAULT 0,
  total_reconocido      numeric NOT NULL DEFAULT 0,   -- transporte + recargos
  -- Ajuste manual a nivel cuadre:
  ajustes_manuales      numeric NOT NULL DEFAULT 0,   -- (+) a favor técnico / (−) en su contra
  ajustes_motivo        text,
  -- Resultado:
  dinero_a_entregar     numeric NOT NULL DEFAULT 0,   -- piso $0
  saldo_a_favor_tecnico numeric NOT NULL DEFAULT 0,   -- empresa le queda debiendo
  -- Trazabilidad:
  generado_por          uuid REFERENCES public.personal(id),
  cerrado_por           uuid REFERENCES public.personal(id),
  cerrado_en            timestamptz,
  firma                 jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_cuadres_tecnico_updated ON public.cuadres_tecnico;
CREATE TRIGGER trg_cuadres_tecnico_updated
  BEFORE UPDATE ON public.cuadres_tecnico
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_cuadres_tecnico_tecnico
  ON public.cuadres_tecnico (tecnico_id, fecha_desde, fecha_hasta);
CREATE INDEX IF NOT EXISTS idx_cuadres_tecnico_estado
  ON public.cuadres_tecnico (estado);

-- ─── 4. cuadre_items (detalle, un recibo/servicio por fila — snapshot) ──────
CREATE TABLE IF NOT EXISTS public.cuadre_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuadre_id             uuid NOT NULL REFERENCES public.cuadres_tecnico(id) ON DELETE CASCADE,
  servicio_id           uuid REFERENCES public.servicios(id),
  recibo_id             uuid REFERENCES public.recibos_tecnico(id),
  fecha                 date,
  hora                  time,
  -- Snapshots (independientes de cambios posteriores del servicio):
  mascota_nombre        text,
  ciudad                text,
  plan_nombre           text,
  total_cobrado         numeric NOT NULL DEFAULT 0,
  efectivo              numeric NOT NULL DEFAULT 0,
  digital               numeric NOT NULL DEFAULT 0,
  transporte_reconocido numeric NOT NULL DEFAULT 0,
  transporte_sin_dato   boolean NOT NULL DEFAULT false,
  es_dominical          boolean NOT NULL DEFAULT false,
  es_festivo            boolean NOT NULL DEFAULT false,
  es_nocturno           boolean NOT NULL DEFAULT false,
  recargo_aplicado      numeric NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cuadre_items_cuadre ON public.cuadre_items (cuadre_id);

-- ─── 5. GRANTs + RLS (patrón del proyecto, igual que 006/recibos) ───────────
GRANT ALL ON TABLE public.tarifas_reconocimiento_tecnico TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.cuadres_tecnico                TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.cuadre_items                   TO postgres, anon, authenticated, service_role;

ALTER TABLE public.tarifas_reconocimiento_tecnico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuadres_tecnico                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuadre_items                   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_full" ON public.tarifas_reconocimiento_tecnico;
DROP POLICY IF EXISTS "auth_full" ON public.cuadres_tecnico;
DROP POLICY IF EXISTS "auth_full" ON public.cuadre_items;
CREATE POLICY "auth_full" ON public.tarifas_reconocimiento_tecnico FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.cuadres_tecnico                FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.cuadre_items                   FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

-- ============================================================================
-- 6. RPC generar_cuadre_tecnico — arma/regenera un cuadre BORRADOR
-- ============================================================================
-- Idempotente por (tecnico, desde, hasta): si ya existe un BORRADOR con ese
-- rango, lo REEMPLAZA (borra items y recalcula). Los CERRADOS son inmutables y
-- nunca se tocan (si existe uno cerrado para el rango exacto, falla).
--
-- Fuente del dinero: recibos_tecnico (por tecnico_id real del recibo) +
-- recibo_medios_pago (efectivo vs digital). Cae al jsonb medios_pago si el
-- recibo no tiene medios formales (recibos previos a 2026-06-16).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.generar_cuadre_tecnico(
  p_tecnico_id        uuid,
  p_desde             date,
  p_hasta             date,
  p_actor_id          uuid    DEFAULT NULL,
  p_ajustes_manuales  numeric DEFAULT 0,
  p_ajustes_motivo    text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cuadre_id        uuid;
  v_rec              record;
  v_tarifa_dom       numeric := 0;
  v_tarifa_fes       numeric := 0;
  v_tarifa_noc       numeric := 0;
  v_efectivo         numeric;
  v_digital          numeric;
  v_nmedios          int;
  v_es_dom           boolean;
  v_es_fes           boolean;
  v_es_noc           boolean;
  v_dia_recargo      numeric;
  v_recargo          numeric;
  v_transporte       numeric;
  v_sin_dato         boolean;
  -- acumuladores
  v_n                int     := 0;
  v_tot_cobrado      numeric := 0;
  v_tot_efectivo     numeric := 0;
  v_tot_digital      numeric := 0;
  v_tot_transporte   numeric := 0;
  v_tot_recargos     numeric := 0;
  v_tot_reconocido   numeric := 0;
  v_neto             numeric;
  v_entregar         numeric;
  v_saldo_favor      numeric;
BEGIN
  IF p_tecnico_id IS NULL OR p_desde IS NULL OR p_hasta IS NULL THEN
    RAISE EXCEPTION 'PARAMS_INVALIDOS: tecnico, desde y hasta son obligatorios';
  END IF;
  IF p_hasta < p_desde THEN
    RAISE EXCEPTION 'RANGO_INVALIDO: la fecha hasta no puede ser anterior a desde';
  END IF;

  -- No tocar cuadres ya cerrados de ese rango exacto.
  IF EXISTS (
    SELECT 1 FROM public.cuadres_tecnico
    WHERE tecnico_id = p_tecnico_id AND fecha_desde = p_desde
      AND fecha_hasta = p_hasta AND estado = 'CERRADO'
  ) THEN
    RAISE EXCEPTION 'CUADRE_CERRADO: ya existe un cuadre CERRADO para este técnico y rango';
  END IF;

  -- Reemplazar BORRADOR previo del mismo rango (regenerar).
  DELETE FROM public.cuadres_tecnico
  WHERE tecnico_id = p_tecnico_id AND fecha_desde = p_desde
    AND fecha_hasta = p_hasta AND estado = 'BORRADOR';

  -- Tarifas activas más recientes.
  SELECT recargo_dominical, recargo_festivo, recargo_nocturno
    INTO v_tarifa_dom, v_tarifa_fes, v_tarifa_noc
  FROM public.tarifas_reconocimiento_tecnico
  WHERE activo
  ORDER BY updated_at DESC
  LIMIT 1;
  v_tarifa_dom := COALESCE(v_tarifa_dom, 0);
  v_tarifa_fes := COALESCE(v_tarifa_fes, 0);
  v_tarifa_noc := COALESCE(v_tarifa_noc, 0);

  -- Cabecera (BORRADOR), totales se actualizan al final.
  INSERT INTO public.cuadres_tecnico (
    tecnico_id, fecha_desde, fecha_hasta, estado,
    ajustes_manuales, ajustes_motivo, generado_por
  ) VALUES (
    p_tecnico_id, p_desde, p_hasta, 'BORRADOR',
    COALESCE(p_ajustes_manuales, 0), NULLIF(p_ajustes_motivo,''), p_actor_id
  )
  RETURNING id INTO v_cuadre_id;

  -- Un ítem por recibo emitido por el técnico en el rango (servicio no cancelado).
  FOR v_rec IN
    SELECT r.id AS recibo_id, r.servicio_id, r.fecha_emision, r.hora_emision,
           r.valor_cobrado, r.medios_pago,
           s.valor_transporte, s.ciudad_recogida,
           m.nombre AS mascota_nombre,
           p.nombre AS plan_nombre
    FROM public.recibos_tecnico r
    JOIN public.servicios s ON s.id = r.servicio_id
    LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
    LEFT JOIN public.planes   p ON p.id = s.plan_id
    WHERE r.tecnico_id = p_tecnico_id
      AND r.fecha_emision BETWEEN p_desde AND p_hasta
      AND s.estado <> 'CANCELADO'
    ORDER BY r.fecha_emision, r.hora_emision
  LOOP
    -- Efectivo vs digital desde la tabla formal de medios.
    SELECT COALESCE(SUM(monto) FILTER (WHERE upper(metodo) = 'EFECTIVO'), 0),
           COALESCE(SUM(monto) FILTER (WHERE upper(metodo) <> 'EFECTIVO'), 0),
           COUNT(*)
      INTO v_efectivo, v_digital, v_nmedios
    FROM public.recibo_medios_pago
    WHERE recibo_id = v_rec.recibo_id;

    -- Fallback al jsonb del recibo (medios previos a la tabla formal).
    IF v_nmedios = 0 THEN
      SELECT COALESCE(SUM(CASE WHEN upper(elem->>'metodo') = 'EFECTIVO'
                               THEN NULLIF(elem->>'monto','')::numeric ELSE 0 END), 0),
             COALESCE(SUM(CASE WHEN upper(elem->>'metodo') <> 'EFECTIVO'
                               THEN NULLIF(elem->>'monto','')::numeric ELSE 0 END), 0)
        INTO v_efectivo, v_digital
      FROM jsonb_array_elements(COALESCE(v_rec.medios_pago, '[]'::jsonb)) elem;
    END IF;

    -- Clasificación temporal del recibo.
    v_es_dom := extract(isodow FROM v_rec.fecha_emision) = 7;
    v_es_fes := EXISTS (SELECT 1 FROM public.festivos f WHERE f.fecha = v_rec.fecha_emision);
    v_es_noc := v_rec.hora_emision IS NOT NULL AND v_rec.hora_emision >= TIME '18:00';

    -- Recargo de día: festivo manda sobre dominical (no se suman entre sí);
    -- el nocturno se suma aparte.
    v_dia_recargo := CASE WHEN v_es_fes THEN v_tarifa_fes
                          WHEN v_es_dom THEN v_tarifa_dom
                          ELSE 0 END;
    v_recargo := v_dia_recargo + CASE WHEN v_es_noc THEN v_tarifa_noc ELSE 0 END;

    -- Transporte reconocido = valor congelado del servicio. Si NULL y la ciudad
    -- no es Bogotá → "sin dato" (no inventamos; lo señalamos para revisión).
    v_transporte := COALESCE(v_rec.valor_transporte, 0);
    v_sin_dato   := v_rec.valor_transporte IS NULL
                    AND COALESCE(v_rec.ciudad_recogida, 'Bogotá') <> 'Bogotá';

    INSERT INTO public.cuadre_items (
      cuadre_id, servicio_id, recibo_id, fecha, hora,
      mascota_nombre, ciudad, plan_nombre,
      total_cobrado, efectivo, digital,
      transporte_reconocido, transporte_sin_dato,
      es_dominical, es_festivo, es_nocturno, recargo_aplicado
    ) VALUES (
      v_cuadre_id, v_rec.servicio_id, v_rec.recibo_id, v_rec.fecha_emision, v_rec.hora_emision,
      v_rec.mascota_nombre, v_rec.ciudad_recogida, v_rec.plan_nombre,
      v_efectivo + v_digital, v_efectivo, v_digital,
      v_transporte, v_sin_dato,
      v_es_dom, v_es_fes, v_es_noc, v_recargo
    );

    v_n              := v_n + 1;
    v_tot_cobrado    := v_tot_cobrado    + v_efectivo + v_digital;
    v_tot_efectivo   := v_tot_efectivo   + v_efectivo;
    v_tot_digital    := v_tot_digital    + v_digital;
    v_tot_transporte := v_tot_transporte + v_transporte;
    v_tot_recargos   := v_tot_recargos   + v_recargo;
  END LOOP;

  v_tot_reconocido := v_tot_transporte + v_tot_recargos;

  -- Fórmula: entrega = efectivo − reconocido − ajustes. Piso $0; resto = a favor.
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
    'total_reconocido', v_tot_reconocido,
    'dinero_a_entregar', v_entregar,
    'saldo_a_favor_tecnico', v_saldo_favor
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.generar_cuadre_tecnico(uuid, date, date, uuid, numeric, text)
  TO authenticated, service_role;

-- ============================================================================
-- 7. RPC cerrar_cuadre — congela el cuadre (inmutable) + firma del técnico
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cerrar_cuadre(
  p_cuadre_id uuid,
  p_actor_id  uuid  DEFAULT NULL,
  p_firma     jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estado text;
BEGIN
  SELECT estado INTO v_estado FROM public.cuadres_tecnico WHERE id = p_cuadre_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUADRE_NO_EXISTE: %', p_cuadre_id;
  END IF;
  IF v_estado = 'CERRADO' THEN
    RAISE EXCEPTION 'CUADRE_YA_CERRADO: este cuadre ya fue cerrado';
  END IF;

  UPDATE public.cuadres_tecnico SET
    estado     = 'CERRADO',
    cerrado_por = p_actor_id,
    cerrado_en = now(),
    firma      = p_firma
  WHERE id = p_cuadre_id;

  RETURN jsonb_build_object('cuadre_id', p_cuadre_id, 'estado', 'CERRADO');
END;
$$;

GRANT EXECUTE ON FUNCTION public.cerrar_cuadre(uuid, uuid, jsonb)
  TO authenticated, service_role;

-- ─── Verificación rápida (opcional) ─────────────────────────────────────────
-- \d+ public.cuadres_tecnico
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='servicios' AND column_name IN
--   ('valor_plan','valor_adicionales','valor_transporte','recargo_nocturno');
