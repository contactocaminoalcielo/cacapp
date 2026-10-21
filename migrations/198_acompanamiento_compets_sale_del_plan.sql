-- ════════════════════════════════════════════════════════════════════════════
-- 198 — El acompañamiento de los planes COMPETS sale del PLAN (decisión de David, 21-oct-2026)
-- ════════════════════════════════════════════════════════════════════════════
-- «Si es COMPETS_EVIDENCIA simplemente es evidencia, si es presencial pues es
-- presencial y ya.» Solo en los EXCLUSIVOS (y el resto de individuales) varía y
-- se escoge.
--
-- 🩸 El acompañamiento se escogía a mano y nada lo amarraba al plan: Registro
-- arrancaba en EVIDENCIA, la conversión de solicitudes en el Kanban arrancaba en
-- PRESENCIAL, y cambiar el plan después no lo tocaba. Al 21-oct había 26
-- servicios COMPETS cruzados (19 COMPETS_EVIDENCIA en PRESENCIAL, 7
-- COMPETS_PRESENCIAL en EVIDENCIA). Efecto visible: Tenjo → Evidencias no
-- preparaba la de CHELSEA ni la de LEIA (filtra por `tipo_acompanamiento`), y las
-- COMPETS_EVIDENCIA mal marcadas pedían confirmar visita a la familia.
--
-- Va en trigger y no solo en pantalla: el plan se escribe desde Registro, el
-- Kanban, la app del técnico y el backend. El mismo mapa vive en
-- `ACOMP_FIJO_POR_PLAN` (src/lib/utils.js) para que la pantalla no ofrezca
-- escoger lo que la DB va a corregir.
--
-- NO es SECURITY DEFINER: solo lee `planes` (catálogo, legible para todos) y
-- así no se salta la guardia de la migración 192.

BEGIN;

CREATE OR REPLACE FUNCTION public.servicio_acompanamiento_del_plan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_codigo text;
BEGIN
  IF NEW.plan_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT codigo INTO v_codigo FROM public.planes WHERE id = NEW.plan_id;
  NEW.tipo_acompanamiento := CASE v_codigo
    WHEN 'COMPETS_EVIDENCIA'  THEN 'EVIDENCIA'
    WHEN 'COMPETS_PRESENCIAL' THEN 'PRESENCIAL'
    ELSE NEW.tipo_acompanamiento
  END;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_servicios_acompanamiento_plan ON public.servicios;
CREATE TRIGGER trg_servicios_acompanamiento_plan
  BEFORE INSERT OR UPDATE OF plan_id, tipo_acompanamiento ON public.servicios
  FOR EACH ROW EXECUTE FUNCTION public.servicio_acompanamiento_del_plan();

-- Los que ya están cruzados (26 activos al 21-oct; también los cancelados, por coherencia).
UPDATE public.servicios s
   SET tipo_acompanamiento = CASE p.codigo WHEN 'COMPETS_EVIDENCIA' THEN 'EVIDENCIA' ELSE 'PRESENCIAL' END
  FROM public.planes p
 WHERE p.id = s.plan_id
   AND (   (p.codigo = 'COMPETS_EVIDENCIA'  AND s.tipo_acompanamiento IS DISTINCT FROM 'EVIDENCIA')
        OR (p.codigo = 'COMPETS_PRESENCIAL' AND s.tipo_acompanamiento IS DISTINCT FROM 'PRESENCIAL'));

COMMIT;
