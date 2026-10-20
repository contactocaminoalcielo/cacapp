-- ============================================================================
-- 192 — Seguridad etapa 3: el dinero de un servicio solo lo mueve coordinación
--       (salvo los tres casos de campo que existen de verdad)
-- ----------------------------------------------------------------------------
-- Auditoría integral 2026-10 · RBAC-004 (docs/auditoria/11-matriz-rbac.md).
-- Requiere 188 (es_coordinacion) y 191 (mi_personal_id, servicio_asignado_a_mi,
-- entrega_es_mia).
--
-- `servicios` tiene auth_full: cualquier sesión cambiaba valor_total,
-- valor_pagado, estado_pago o comisiones por la API. El mapa de escrituras del
-- navegador (agente de auditoría, 20-oct) encontró tres casos legítimos de campo
-- y dos huecos:
--   Y1 · cobro en la puerta (TecnicoApp completarEntrega): valor_pagado,
--        estado_pago, metodo_pago — quien tiene la entrega;
--   Y2 · recálculo por peso al confirmar cuarto frío (precios.js): valor_total,
--        valor_plan, estado_pago, comision_aliado — el técnico del servicio;
--   Y3 · recibo de VETERINARIA con descuento inmediato (TecnicoApp): pasa
--        comision_descontada a true y baja valor_total en la comisión;
--   ✗  · el PRODUCTOR cambiaba estado_pago y comision_aliado desde el Kanban
--        (sin control de rol en la pantalla; se oculta en el mismo despliegue).
-- La guardia deja pasar Y1-Y3 SOLO si las cifras cuadran exactamente con lo que
-- calcula el código (no con cualquier número), y bloquea el resto.
-- No toca: backend (orbit_backend), RPC SECURITY DEFINER, procesos internos.
-- El resto de columnas de servicios (estado, notas…) sigue como hoy: etapa 4.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- Misma fórmula que calcularEstadoPago (src/lib/servicios.js:186).
CREATE OR REPLACE FUNCTION public.estado_pago_calculado(p_total numeric, p_pagado numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN coalesce(p_total, 0) > 0 AND coalesce(p_pagado, 0) >= coalesce(p_total, 0) THEN 'COMPLETO'
              WHEN coalesce(p_pagado, 0) > 0 THEN 'PARCIAL'
              ELSE 'PENDIENTE' END
$$;

CREATE OR REPLACE FUNCTION public.fn_servicios_guardia_dinero()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
-- ⚠️ SIN SECURITY DEFINER (ver migr. 188): current_user debe ser quien llama.
DECLARE
  v text[] := ARRAY[]::text[];
  v_d_total numeric; v_d_plan numeric; v_d_com numeric; v_tope numeric;
BEGIN
  IF current_user <> 'authenticated' THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP IN ('INSERT', 'DELETE') THEN
    IF public.es_coordinacion() THEN RETURN COALESCE(NEW, OLD); END IF;
    RAISE EXCEPTION 'Solo coordinación crea o borra servicios' USING ERRCODE = '42501';
  END IF;

  IF NEW.valor_total                IS DISTINCT FROM OLD.valor_total                THEN v := array_append(v, 'valor_total'); END IF;
  IF NEW.valor_pagado               IS DISTINCT FROM OLD.valor_pagado               THEN v := array_append(v, 'valor_pagado'); END IF;
  IF NEW.metodo_pago                IS DISTINCT FROM OLD.metodo_pago                THEN v := array_append(v, 'metodo_pago'); END IF;
  IF NEW.estado_pago                IS DISTINCT FROM OLD.estado_pago                THEN v := array_append(v, 'estado_pago'); END IF;
  IF NEW.comision_aliado            IS DISTINCT FROM OLD.comision_aliado            THEN v := array_append(v, 'comision_aliado'); END IF;
  IF NEW.comision_descontada        IS DISTINCT FROM OLD.comision_descontada        THEN v := array_append(v, 'comision_descontada'); END IF;
  IF NEW.comision_pagada            IS DISTINCT FROM OLD.comision_pagada            THEN v := array_append(v, 'comision_pagada'); END IF;
  IF NEW.medios_pago                IS DISTINCT FROM OLD.medios_pago                THEN v := array_append(v, 'medios_pago'); END IF;
  IF NEW.descuento_adicional        IS DISTINCT FROM OLD.descuento_adicional        THEN v := array_append(v, 'descuento_adicional'); END IF;
  IF NEW.descuento_adicional_motivo IS DISTINCT FROM OLD.descuento_adicional_motivo THEN v := array_append(v, 'descuento_adicional_motivo'); END IF;
  IF NEW.valor_plan                 IS DISTINCT FROM OLD.valor_plan                 THEN v := array_append(v, 'valor_plan'); END IF;
  IF NEW.valor_adicionales          IS DISTINCT FROM OLD.valor_adicionales          THEN v := array_append(v, 'valor_adicionales'); END IF;
  IF NEW.valor_transporte           IS DISTINCT FROM OLD.valor_transporte           THEN v := array_append(v, 'valor_transporte'); END IF;
  IF NEW.recargo_nocturno           IS DISTINCT FROM OLD.recargo_nocturno           THEN v := array_append(v, 'recargo_nocturno'); END IF;
  IF NEW.valor_eutanasia            IS DISTINCT FROM OLD.valor_eutanasia            THEN v := array_append(v, 'valor_eutanasia'); END IF;
  IF NEW.plan_id                    IS DISTINCT FROM OLD.plan_id                    THEN v := array_append(v, 'plan_id'); END IF;

  -- Sin dinero de por medio (la inmensa mayoría: cambios de estado) → pasa
  -- sin consultar nada más.
  IF cardinality(v) = 0 OR public.es_coordinacion() THEN RETURN NEW; END IF;

  -- Y1 · Cobro en la puerta: completa el saldo, nunca lo pasa ni lo baja.
  IF v <@ ARRAY['valor_pagado', 'estado_pago', 'metodo_pago']
     AND public.entrega_es_mia(NEW.id)
     AND coalesce(NEW.valor_pagado, 0) >= coalesce(OLD.valor_pagado, 0)
     AND coalesce(NEW.valor_pagado, 0) <= coalesce(OLD.valor_total, 0) + 1
     AND NEW.estado_pago::text IS NOT DISTINCT FROM public.estado_pago_calculado(OLD.valor_total, NEW.valor_pagado)
  THEN RETURN NEW; END IF;

  -- Y2 · Recálculo por peso (precios.js): el total se mueve EXACTAMENTE lo que
  -- se mueve el plan (menos el delta de comisión si ya va descontada).
  IF v <@ ARRAY['valor_total', 'valor_plan', 'estado_pago', 'comision_aliado']
     AND public.servicio_asignado_a_mi(NEW.id)
     AND OLD.estado::text NOT IN ('ENTREGADO', 'CANCELADO') THEN
    v_d_total := coalesce(NEW.valor_total, 0) - coalesce(OLD.valor_total, 0);
    v_d_plan  := coalesce(NEW.valor_plan, 0)  - coalesce(OLD.valor_plan, 0);
    v_d_com   := CASE WHEN OLD.comision_descontada
                      THEN coalesce(NEW.comision_aliado, 0) - coalesce(OLD.comision_aliado, 0) ELSE 0 END;
    IF abs(v_d_total - (v_d_plan - v_d_com)) <= 1
       -- La comisión solo se limpia (desamparado) o sale de la tarifa (≤ 32 %, el máximo de config_comisiones).
       AND (NEW.comision_aliado IS NOT DISTINCT FROM OLD.comision_aliado
            OR coalesce(NEW.comision_aliado, 0) = 0
            OR NEW.comision_aliado <= round(coalesce(NEW.valor_plan, 0) * 0.32) + 1)
       AND (NEW.estado_pago IS NOT DISTINCT FROM OLD.estado_pago
            OR NEW.estado_pago::text = public.estado_pago_calculado(NEW.valor_total, OLD.valor_pagado))
    THEN RETURN NEW; END IF;
  END IF;

  -- Y3 · Recibo VET con descuento inmediato: el total baja como mucho la comisión
  -- (la guardada o el máximo de tarifa sobre el plan).
  IF v <@ ARRAY['comision_descontada', 'valor_total']
     AND public.servicio_asignado_a_mi(NEW.id)
     AND OLD.comision_descontada IS NOT TRUE AND NEW.comision_descontada IS TRUE THEN
    v_tope := greatest(coalesce(OLD.comision_aliado, 0),
                       round(coalesce(nullif(OLD.valor_plan, 0), OLD.valor_total, 0) * 0.32)) + 1;
    IF coalesce(NEW.valor_total, 0) <= coalesce(OLD.valor_total, 0)
       AND coalesce(OLD.valor_total, 0) - coalesce(NEW.valor_total, 0) <= v_tope
    THEN RETURN NEW; END IF;
  END IF;

  RAISE EXCEPTION 'Solo coordinación puede cambiar el dinero del servicio (%)', array_to_string(v, ', ')
    USING ERRCODE = '42501';
END $$;

-- "00" para que corra ANTES que los demás BEFORE (orden alfabético) y vea solo
-- lo que mandó el cliente.
DROP TRIGGER IF EXISTS trg_00_servicios_guardia_dinero ON public.servicios;
CREATE TRIGGER trg_00_servicios_guardia_dinero
  BEFORE INSERT OR UPDATE OR DELETE ON public.servicios
  FOR EACH ROW EXECUTE FUNCTION public.fn_servicios_guardia_dinero();

-- Trigger dormido de recogidas (migr. 037) que escribe comisión: si algún día lo
-- dispara un técnico, que corra como dueño y no choque con la guardia.
ALTER FUNCTION public.fn_gestionar_comision_recogida() SECURITY DEFINER SET search_path = public;

-- comisiones_aliados: leen todos (Finanzas, Reportes), escribe coordinación.
DROP POLICY IF EXISTS auth_full ON public.comisiones_aliados;
DROP POLICY IF EXISTS leer_todos ON public.comisiones_aliados;
DROP POLICY IF EXISTS escribe_coordinacion ON public.comisiones_aliados;
CREATE POLICY leer_todos ON public.comisiones_aliados FOR SELECT TO authenticated USING (true);
CREATE POLICY escribe_coordinacion ON public.comisiones_aliados FOR ALL TO authenticated
  USING (public.es_coordinacion()) WITH CHECK (public.es_coordinacion());

COMMIT;

-- ============================================================================
-- ROLLBACK:
--   DROP TRIGGER trg_00_servicios_guardia_dinero ON public.servicios;
--   ALTER FUNCTION public.fn_gestionar_comision_recogida() SECURITY INVOKER;
--   comisiones_aliados: DROP POLICY leer_todos/escribe_coordinacion;
--     CREATE POLICY auth_full … FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- ============================================================================
