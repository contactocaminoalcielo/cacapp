-- ============================================================================
-- 164 — El técnico revisa su bitácora al generar el recibo
-- ----------------------------------------------------------------------------
-- Pedido de David (2026-09-17): al terminar de generar el recibo de una mascota,
-- el técnico no puede irse sin dejar dicho si lo que quedó registrado coincide
-- con lo que él realmente cobró.
--
-- Hasta hoy la única forma de anotar algo era `bitacora_ajustes_tecnico` (033),
-- que es una SUGERENCIA con nota obligatoria y que gerencia lee como "acá hay
-- algo que revisar". Obligar a llenarla en cada recibo habría convertido esa
-- alerta en ruido: todos los servicios aparecerían como pendientes de revisar.
--
-- Por eso la revisión vive aparte:
--   • «Todo coincide»  → fila acá con coincide = true  y NINGUNA sugerencia.
--   • «No coincide»    → el técnico llena el ajuste de 033 y esa misma RPC deja
--                        acá la fila con coincide = false.
-- Así gerencia sigue viendo como sugerencia solo lo que de verdad lo es, y de
-- paso gana lo que antes no existía: constancia de que el técnico miró la plata
-- servicio por servicio, con lo que tenía en pantalla cuando lo dijo.
--
-- Esta tabla NO mueve dinero: no toca servicios, recibos_tecnico ni cuadre_items.
--
-- Aditiva, idempotente, reversible. No pisa datos.
-- Aplicar en VPS (Contabo):
--   ssh -i ~/.ssh/orbit_deploy root@13.140.139.61
--   cd /opt/supabase/docker && \
--   docker compose exec -T db psql -U postgres -d postgres --pset pager=off -f - < 164_bitacora_revision_tecnico.sql
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ─── 1. Tabla de revisiones (una fila por servicio + técnico) ───────────────
-- El snapshot `visto_*` guarda lo que el técnico TENÍA EN PANTALLA al responder.
-- Sin él, un «todo coincide» de hoy no se puede leer mañana: si el valor cambia
-- después (adicional vendido, recálculo por peso), no habría forma de saber
-- sobre qué cifra dijo que sí. Mismo motivo por el que el recibo guarda su
-- propio valor en vez de derivarlo del servicio.
CREATE TABLE IF NOT EXISTS public.bitacora_revisiones_tecnico (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servicio_id      uuid NOT NULL REFERENCES public.servicios(id) ON DELETE CASCADE,
  tecnico_id       uuid NOT NULL REFERENCES public.personal(id),
  recibo_id        uuid REFERENCES public.recibos_tecnico(id) ON DELETE SET NULL,
  coincide         boolean NOT NULL,          -- true = «todo coincide»; false = revisó y ajustó
  visto_cobrado    numeric,                   -- lo que decía la pantalla al responder
  visto_efectivo   numeric,
  visto_digital    numeric,
  visto_transporte numeric,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_bitacora_revision_servicio_tecnico UNIQUE (servicio_id, tecnico_id)
);

DROP TRIGGER IF EXISTS trg_bitacora_revisiones_updated ON public.bitacora_revisiones_tecnico;
CREATE TRIGGER trg_bitacora_revisiones_updated
  BEFORE UPDATE ON public.bitacora_revisiones_tecnico
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_bitacora_revisiones_tecnico  ON public.bitacora_revisiones_tecnico (tecnico_id);
CREATE INDEX IF NOT EXISTS idx_bitacora_revisiones_servicio ON public.bitacora_revisiones_tecnico (servicio_id);

-- ─── 2. GRANTs + RLS (patrón del proyecto) ──────────────────────────────────
-- Creada con SQL raw ⇒ los GRANT van a mano (Supabase no los pone solo).
GRANT SELECT, INSERT, UPDATE ON TABLE public.bitacora_revisiones_tecnico TO authenticated;
GRANT SELECT                 ON TABLE public.bitacora_revisiones_tecnico TO orbit_backend;
GRANT ALL                    ON TABLE public.bitacora_revisiones_tecnico TO postgres, service_role;

ALTER TABLE public.bitacora_revisiones_tecnico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_full" ON public.bitacora_revisiones_tecnico;
CREATE POLICY "auth_full" ON public.bitacora_revisiones_tecnico FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

-- ============================================================================
-- 3. RPC confirmar_bitacora_tecnico — «todo coincide»
-- ----------------------------------------------------------------------------
-- Valida que el servicio sea del técnico (asignación directa o recogida suya) e
-- inserta/actualiza su revisión. A diferencia del ajuste (033), NO exige que el
-- cuadre esté en BORRADOR: esto no cambia ningún valor, y rechazarlo dejaría al
-- técnico encerrado en la pantalla del recibo sin poder responder.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.confirmar_bitacora_tecnico(
  p_servicio_id      uuid,
  p_tecnico_id       uuid,
  p_coincide         boolean DEFAULT true,
  p_recibo_id        uuid    DEFAULT NULL,
  p_visto_cobrado    numeric DEFAULT NULL,
  p_visto_efectivo   numeric DEFAULT NULL,
  p_visto_digital    numeric DEFAULT NULL,
  p_visto_transporte numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_servicio_id IS NULL OR p_tecnico_id IS NULL THEN
    RAISE EXCEPTION 'PARAMS_INVALIDOS: servicio y técnico son obligatorios';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.servicios s WHERE s.id = p_servicio_id AND s.tecnico_id = p_tecnico_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.recogidas r WHERE r.servicio_id = p_servicio_id AND r.tecnico_id = p_tecnico_id
  ) THEN
    RAISE EXCEPTION 'SERVICIO_AJENO: solo puedes revisar tus propios servicios';
  END IF;

  INSERT INTO public.bitacora_revisiones_tecnico (
    servicio_id, tecnico_id, recibo_id, coincide,
    visto_cobrado, visto_efectivo, visto_digital, visto_transporte
  ) VALUES (
    p_servicio_id, p_tecnico_id, p_recibo_id, COALESCE(p_coincide, true),
    p_visto_cobrado, p_visto_efectivo, p_visto_digital, p_visto_transporte
  )
  ON CONFLICT (servicio_id, tecnico_id) DO UPDATE SET
    recibo_id        = COALESCE(EXCLUDED.recibo_id, bitacora_revisiones_tecnico.recibo_id),
    coincide         = EXCLUDED.coincide,
    -- El snapshot solo se pisa si la respuesta nueva trae uno: una revisión
    -- hecha desde el ajuste (que no manda cifras) no debe borrar lo que vio.
    visto_cobrado    = COALESCE(EXCLUDED.visto_cobrado,    bitacora_revisiones_tecnico.visto_cobrado),
    visto_efectivo   = COALESCE(EXCLUDED.visto_efectivo,   bitacora_revisiones_tecnico.visto_efectivo),
    visto_digital    = COALESCE(EXCLUDED.visto_digital,    bitacora_revisiones_tecnico.visto_digital),
    visto_transporte = COALESCE(EXCLUDED.visto_transporte, bitacora_revisiones_tecnico.visto_transporte)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'servicio_id', p_servicio_id, 'coincide', COALESCE(p_coincide, true));
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirmar_bitacora_tecnico(uuid, uuid, boolean, uuid, numeric, numeric, numeric, numeric)
  TO authenticated, service_role;

-- ============================================================================
-- 4. upsert_bitacora_ajuste — ahora también deja la revisión
-- ----------------------------------------------------------------------------
-- Idéntica a la de 033 salvo el bloque final: quien anota un ajuste YA revisó su
-- bitácora, y tiene que contar como tal venga de donde venga (la pantalla del
-- recibo o la pestaña Bitácora). Si quedara solo en el frontend del recibo, un
-- ajuste hecho desde la bitácora dejaría la puerta del recibo trabada.
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

  -- Dejar constancia de la revisión (coincide = false: anotó algo distinto).
  INSERT INTO public.bitacora_revisiones_tecnico (servicio_id, tecnico_id, coincide)
  VALUES (p_servicio_id, p_tecnico_id, false)
  ON CONFLICT (servicio_id, tecnico_id) DO UPDATE SET coincide = false;

  RETURN jsonb_build_object('id', v_id, 'servicio_id', p_servicio_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_bitacora_ajuste(uuid, uuid, text, numeric, jsonb, numeric)
  TO authenticated, service_role;

-- ─── 5. Los ajustes que ya existían cuentan como revisados ──────────────────
-- No se inventa ningún «todo coincide» del pasado: solo se reconoce lo que el
-- técnico YA había anotado. Lo demás queda sin revisión, que es la verdad.
INSERT INTO public.bitacora_revisiones_tecnico (servicio_id, tecnico_id, coincide, created_at)
SELECT a.servicio_id, a.tecnico_id, false, a.created_at
FROM public.bitacora_ajustes_tecnico a
ON CONFLICT (servicio_id, tecnico_id) DO NOTHING;

-- Sin esto PostgREST no ve ni la tabla ni la función nueva, y el técnico recibe
-- un "could not find the function" al responder.
NOTIFY pgrst, 'reload schema';

-- ─── Verificación rápida (opcional) ─────────────────────────────────────────
-- \d+ public.bitacora_revisiones_tecnico
-- SELECT coincide, count(*) FROM public.bitacora_revisiones_tecnico GROUP BY 1;
