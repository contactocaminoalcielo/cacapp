-- ============================================================================
-- 033 — Bitácora del técnico: ajustes sugeridos (capa "sombra", NO toca lo real)
-- ----------------------------------------------------------------------------
-- El técnico puede proponer, servicio por servicio en su Bitácora, un valor
-- distinto de lo que el sistema calculó (cuánto cobró, cómo lo repartió entre
-- efectivo/digital, cuánto cree que se le debe reconocer), SIEMPRE con una nota
-- del porqué. Estas sugerencias:
--   • viven en una tabla APARTE (bitacora_ajustes_tecnico);
--   • NUNCA modifican servicios, recibos_tecnico ni cuadre_items;
--   • NUNCA mueven dinero_a_entregar — son solo para comparar contra el cuadre.
-- Gerencia las ve al lado del valor real; si le da la razón al técnico, mueve el
-- valor real con las RPCs que ya existen (set_cuadre_item_valor_recogido, etc.),
-- nunca automático.
--
-- Decisiones de David (2026-07-07):
--   - Puede ajustar montos (cobrado + reconocido) Y el reparto de medios de pago.
--   - Coexiste con la confirmación bilateral (032): es el detalle fino que la
--     respalda. NO se toca confirmar_cuadre_por_tecnico.
--   - Ventana: solo mientras el cuadre del periodo esté en BORRADOR. Una vez el
--     servicio queda en un cuadre CERRADO, sus ajustes de ese servicio se
--     congelan (la RPC los rechaza).
--
-- Aditiva, idempotente, reversible. No pisa datos.
-- Aplicar en VPS (Contabo):
--   ssh -i ~/.ssh/orbit_deploy root@13.140.139.61
--   cd /opt/supabase/docker && \
--   docker compose exec -T db psql -U postgres -d postgres --pset pager=off -f - < 033_bitacora_ajustes_tecnico.sql
-- ============================================================================

BEGIN;

-- ─── 1. Tabla de ajustes (una fila por servicio + técnico) ──────────────────
-- Todas las columnas de sugerencia son nullable: NULL = "de acuerdo con lo
-- automático en ese valor". La fila existe apenas el técnico anota algo (aunque
-- sea solo la nota). `medios_sugeridos` = [{ "metodo": "EFECTIVO", "monto": 0 }].
CREATE TABLE IF NOT EXISTS public.bitacora_ajustes_tecnico (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servicio_id         uuid NOT NULL REFERENCES public.servicios(id) ON DELETE CASCADE,
  tecnico_id          uuid NOT NULL REFERENCES public.personal(id),
  cobrado_sugerido    numeric,                  -- lo que el técnico dice que cobró
  medios_sugeridos    jsonb,                    -- reparto sugerido efectivo/digital
  reconocido_sugerido numeric,                  -- lo que cree que se le debe reconocer
  nota                text NOT NULL,            -- el porqué (obligatoria)
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_bitacora_ajuste_servicio_tecnico UNIQUE (servicio_id, tecnico_id),
  CONSTRAINT chk_bitacora_ajuste_cobrado    CHECK (cobrado_sugerido    IS NULL OR cobrado_sugerido    >= 0),
  CONSTRAINT chk_bitacora_ajuste_reconocido CHECK (reconocido_sugerido IS NULL OR reconocido_sugerido >= 0),
  CONSTRAINT chk_bitacora_ajuste_medios     CHECK (medios_sugeridos    IS NULL OR jsonb_typeof(medios_sugeridos) = 'array')
);

DROP TRIGGER IF EXISTS trg_bitacora_ajustes_updated ON public.bitacora_ajustes_tecnico;
CREATE TRIGGER trg_bitacora_ajustes_updated
  BEFORE UPDATE ON public.bitacora_ajustes_tecnico
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_bitacora_ajustes_tecnico ON public.bitacora_ajustes_tecnico (tecnico_id);
CREATE INDEX IF NOT EXISTS idx_bitacora_ajustes_servicio ON public.bitacora_ajustes_tecnico (servicio_id);

-- ─── 2. GRANTs + RLS (patrón del proyecto, igual que 010/cuadres) ───────────
-- Baseline auth_full: el scoping "cada técnico ve/edita lo suyo" lo hace la UI y
-- la RPC (valida tecnico_id propio), como MisCuadresTab. Gerencia (ADMIN/COORD)
-- lee todo para comparar.
GRANT ALL ON TABLE public.bitacora_ajustes_tecnico TO postgres, anon, authenticated, service_role;
ALTER TABLE public.bitacora_ajustes_tecnico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_full" ON public.bitacora_ajustes_tecnico;
CREATE POLICY "auth_full" ON public.bitacora_ajustes_tecnico FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

-- ============================================================================
-- 3. RPC upsert_bitacora_ajuste — el técnico crea/edita SU sugerencia
-- ----------------------------------------------------------------------------
-- Valida: (a) el servicio es del técnico (por servicios.tecnico_id o por su
-- recogida); (b) nota no vacía; (c) el servicio NO está en un cuadre CERRADO de
-- ese técnico (ventana BORRADOR). Idempotente por (servicio, técnico).
-- No toca servicios/recibos/cuadre_items: solo escribe en la capa sombra.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.upsert_bitacora_ajuste(
  p_servicio_id    uuid,
  p_tecnico_id     uuid,
  p_nota           text,
  p_cobrado        numeric DEFAULT NULL,
  p_medios         jsonb   DEFAULT NULL,
  p_reconocido     numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id   uuid;
  v_nota text := NULLIF(btrim(p_nota), '');
BEGIN
  IF p_servicio_id IS NULL OR p_tecnico_id IS NULL THEN
    RAISE EXCEPTION 'PARAMS_INVALIDOS: servicio y técnico son obligatorios';
  END IF;
  IF v_nota IS NULL THEN
    RAISE EXCEPTION 'NOTA_REQUERIDA: explica por qué anotas un valor distinto';
  END IF;

  -- El servicio debe ser del técnico (recogida propia o asignación directa).
  IF NOT EXISTS (
    SELECT 1 FROM public.servicios s WHERE s.id = p_servicio_id AND s.tecnico_id = p_tecnico_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.recogidas r WHERE r.servicio_id = p_servicio_id AND r.tecnico_id = p_tecnico_id
  ) THEN
    RAISE EXCEPTION 'SERVICIO_AJENO: solo puedes anotar sobre tus propios servicios';
  END IF;

  -- Ventana BORRADOR: si el servicio ya cayó en un cuadre CERRADO del técnico,
  -- su ajuste queda congelado (el ida y vuelta debe ocurrir antes del cierre).
  IF EXISTS (
    SELECT 1 FROM public.cuadre_items ci
    JOIN public.cuadres_tecnico c ON c.id = ci.cuadre_id
    WHERE ci.servicio_id = p_servicio_id
      AND c.tecnico_id = p_tecnico_id
      AND c.estado = 'CERRADO'
  ) THEN
    RAISE EXCEPTION 'CUADRE_CERRADO: este servicio ya se cuadró y cerró; no admite ajustes';
  END IF;

  INSERT INTO public.bitacora_ajustes_tecnico (
    servicio_id, tecnico_id, cobrado_sugerido, medios_sugeridos, reconocido_sugerido, nota
  ) VALUES (
    p_servicio_id, p_tecnico_id, p_cobrado, p_medios, p_reconocido, v_nota
  )
  ON CONFLICT (servicio_id, tecnico_id) DO UPDATE SET
    cobrado_sugerido    = EXCLUDED.cobrado_sugerido,
    medios_sugeridos    = EXCLUDED.medios_sugeridos,
    reconocido_sugerido = EXCLUDED.reconocido_sugerido,
    nota                = EXCLUDED.nota
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'servicio_id', p_servicio_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_bitacora_ajuste(uuid, uuid, text, numeric, jsonb, numeric)
  TO authenticated, service_role;

-- ============================================================================
-- 4. RPC borrar_bitacora_ajuste — el técnico deshace su sugerencia
-- ----------------------------------------------------------------------------
-- Vuelve la fila al valor automático. Misma ventana BORRADOR.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.borrar_bitacora_ajuste(
  p_servicio_id uuid,
  p_tecnico_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.cuadre_items ci
    JOIN public.cuadres_tecnico c ON c.id = ci.cuadre_id
    WHERE ci.servicio_id = p_servicio_id
      AND c.tecnico_id = p_tecnico_id
      AND c.estado = 'CERRADO'
  ) THEN
    RAISE EXCEPTION 'CUADRE_CERRADO: este servicio ya se cuadró y cerró; no admite ajustes';
  END IF;

  DELETE FROM public.bitacora_ajustes_tecnico
  WHERE servicio_id = p_servicio_id AND tecnico_id = p_tecnico_id;

  RETURN jsonb_build_object('servicio_id', p_servicio_id, 'borrado', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.borrar_bitacora_ajuste(uuid, uuid)
  TO authenticated, service_role;

-- ─── Verificación rápida (opcional) ─────────────────────────────────────────
-- \d+ public.bitacora_ajustes_tecnico
-- SELECT proname FROM pg_proc WHERE proname LIKE '%bitacora_ajuste%';
