-- 054_afiliaciones_multi_mascota.sql — Un contrato cubre VARIAS mascotas.
-- Decisión de David 2026-07-16, a partir de lo que mostraron los datos reales:
--
--   · Un contrato = titular + fecha + tipo + nivel. El número (ABR1124SR10-BR1)
--     ya agrupa exactamente por eso, así que NO cambia de formato. Lo comprobé
--     con Luis Dueñas: el mismo día tomó PLATA (ENE1025LD11-PL0) y ORO
--     (ENE1025LD11-OR0) → el código ya los separó solo.
--   · La activación es POR MASCOTA: si fallece una, las demás siguen vigentes.
--     Por eso el estado de "esta mascota ya se usó" baja al nivel de la mascota.
--   · `afiliacion_contratos.valor` es el precio POR MASCOTA (unitario), no el
--     total. Es lo que ya guardan las 149 filas sin excepción (BRONCE anual
--     37.000, PLATA vitalicio 380.000, ORO vitalicio 870.000...). El total del
--     contrato = valor × nº de mascotas y se calcula, no se guarda: guardarlo
--     sería una segunda fuente que se desincroniza (ver comprobantes del recibo).
--
-- La realidad que había en producción: el mismo caso ("un contrato, varias
-- mascotas") estaba registrado de DOS formas incompatibles, ninguna usable:
--   A) 53 de 149 afiliaciones metían todas las mascotas en el NOMBRE de un solo
--      registro ('Axel, Orus, Coco, Naya, Milu, Agata'). Imposible activar una.
--   B) 12 filas (4 números repetidos) creaban una afiliación por mascota con el
--      mismo numero_contrato. Estructuralmente bien, número duplicado.
-- Esta migración lleva las dos a la forma B con el número único por contrato.

BEGIN;

-- ── 1. Las mascotas que cubre cada contrato, con su propio estado ────────────
CREATE TABLE IF NOT EXISTS public.afiliacion_mascotas (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  afiliacion_id        uuid NOT NULL REFERENCES public.afiliaciones(id) ON DELETE CASCADE,
  mascota_id           uuid NOT NULL REFERENCES public.mascotas(id_mascota),
  -- VIGENTE = cubierta · ACTIVADA = falleció y ya usó el servicio
  -- RETIRADA = sacada del contrato sin usarlo (no renovada individualmente)
  estado               text NOT NULL DEFAULT 'VIGENTE'
                         CHECK (estado IN ('VIGENTE','ACTIVADA','RETIRADA')),
  servicio_activado_id uuid REFERENCES public.servicios(id),  -- write-back desde Registro
  fecha_activacion     date,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (afiliacion_id, mascota_id)
);

CREATE INDEX IF NOT EXISTS idx_afil_mascotas_afiliacion ON public.afiliacion_mascotas (afiliacion_id);
CREATE INDEX IF NOT EXISTS idx_afil_mascotas_mascota    ON public.afiliacion_mascotas (mascota_id);

COMMENT ON TABLE public.afiliacion_mascotas IS
  'Mascotas cubiertas por una afiliación (un contrato cubre varias). El estado es por mascota: activar una por fallecimiento no toca a las demás.';

-- ── 2. Backfill: cada afiliación actual aporta su mascota ───────────────────
INSERT INTO public.afiliacion_mascotas
  (afiliacion_id, mascota_id, estado, servicio_activado_id, fecha_activacion)
SELECT a.id, a.mascota_id,
       CASE WHEN a.estado = 'ACTIVADA' THEN 'ACTIVADA' ELSE 'VIGENTE' END,
       a.servicio_activado_id, a.fecha_activacion
FROM public.afiliaciones a
ON CONFLICT (afiliacion_id, mascota_id) DO NOTHING;

-- ── 3. Unificar los contratos que ya venían repetidos (caso B) ──────────────
-- Mismo numero_contrato = mismo contrato: se queda la afiliación más antigua y
-- las mascotas de las demás se le cuelgan. Al borrar las sobrantes, el CASCADE
-- se lleva sus contratos duplicados (mismo número, mismo valor unitario).
DO $$
DECLARE g RECORD; survivor uuid; movidas int; borradas int := 0;
BEGIN
  FOR g IN
    SELECT ct.numero_contrato,
           array_agg(a.id ORDER BY a.created_at, a.numero) AS ids
    FROM public.afiliacion_contratos ct
    JOIN public.afiliaciones a ON a.id = ct.afiliacion_id
    GROUP BY ct.numero_contrato
    HAVING count(*) > 1
  LOOP
    survivor := g.ids[1];
    UPDATE public.afiliacion_mascotas SET afiliacion_id = survivor
     WHERE afiliacion_id = ANY(g.ids) AND afiliacion_id <> survivor;
    GET DIAGNOSTICS movidas = ROW_COUNT;
    DELETE FROM public.afiliaciones WHERE id = ANY(g.ids) AND id <> survivor;
    borradas := borradas + array_length(g.ids, 1) - 1;
    RAISE NOTICE 'Contrato % unificado: % mascotas movidas', g.numero_contrato, movidas;
  END LOOP;
  RAISE NOTICE 'Afiliaciones redundantes eliminadas: %', borradas;
END $$;

-- ── 4. Separar las mascotas con varios nombres en un solo registro (caso A) ──
-- 'Axel, Orus, Coco, Naya, Milu, Agata' → 6 mascotas reales en el mismo contrato.
-- Seguro: ninguna de estas 53 tiene servicios asociados (verificado 2026-07-16),
-- así que no hay historial que romper. El registro original se conserva y se
-- renombra al primer nombre; los demás se crean copiando sus datos.
DO $$
DECLARE r RECORD; nombres text[]; n text; nueva uuid; creadas int := 0; tocadas int := 0;
BEGIN
  FOR r IN
    SELECT am.id AS am_id, am.afiliacion_id, m.id_mascota, m.nombre, m.cliente_id,
           m.especie_id, m.raza, m.sexo, m.tamano, m.peso_kg
    FROM public.afiliacion_mascotas am
    JOIN public.mascotas m ON m.id_mascota = am.mascota_id
    WHERE m.nombre ~* '(,|\s+y\s+)'
  LOOP
    -- separa por comas y por " y " (con espacios, para no partir nombres con 'y')
    SELECT array_agg(t) INTO nombres
    FROM (
      SELECT btrim(x) AS t
      FROM unnest(regexp_split_to_array(r.nombre, '\s*,\s*|\s+[yY]\s+')) AS x
      WHERE btrim(x) <> ''
    ) s;

    IF array_length(nombres, 1) IS NULL OR array_length(nombres, 1) < 2 THEN
      CONTINUE;
    END IF;

    -- el registro existente se queda con el primer nombre
    UPDATE public.mascotas SET nombre = nombres[1] WHERE id_mascota = r.id_mascota;
    tocadas := tocadas + 1;

    -- el resto: mascota nueva con los mismos datos, colgada del mismo contrato
    FOREACH n IN ARRAY nombres[2:array_length(nombres, 1)]
    LOOP
      INSERT INTO public.mascotas
        (nombre, cliente_id, especie_id, raza, sexo, tamano, peso_kg, fallecida, notas)
      VALUES (n, r.cliente_id, r.especie_id, r.raza, r.sexo, r.tamano, r.peso_kg, false,
              'Separada de la afiliación importada "' || r.nombre || '" (migración 054).')
      RETURNING id_mascota INTO nueva;

      INSERT INTO public.afiliacion_mascotas (afiliacion_id, mascota_id, estado)
      VALUES (r.afiliacion_id, nueva, 'VIGENTE')
      ON CONFLICT (afiliacion_id, mascota_id) DO NOTHING;
      creadas := creadas + 1;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'Registros con nombres pegados separados: % · mascotas nuevas creadas: %', tocadas, creadas;
END $$;

-- ── 5. La mascota deja de vivir en la afiliación ────────────────────────────
DROP INDEX IF EXISTS public.uq_afiliaciones_mascota_viva;

ALTER TABLE public.afiliaciones
  DROP COLUMN IF EXISTS mascota_id,
  DROP COLUMN IF EXISTS servicio_activado_id,
  DROP COLUMN IF EXISTS fecha_activacion;

-- `estado` de la afiliación pasa a ser el ciclo de vida del CONTRATO
-- (VIGENTE/VENCIDA/CANCELADA lo mueve el cron; ACTIVADA = ya no queda ninguna
-- mascota viva). El de cada mascota vive en afiliacion_mascotas.estado.
COMMENT ON COLUMN public.afiliaciones.estado IS
  'Ciclo de vida del contrato: VIGENTE/VENCIDA/CANCELADA (cron de vencimientos) o ACTIVADA cuando ya no queda ninguna mascota cubierta. El estado por mascota vive en afiliacion_mascotas.estado.';

COMMENT ON COLUMN public.afiliacion_contratos.valor IS
  'Precio POR MASCOTA (unitario), congelado al firmar. El total del contrato = valor × nº de mascotas cubiertas — se calcula, no se guarda.';

COMMENT ON TABLE public.afiliaciones IS
  'Contrato de afiliación pre-exequial (ANUAL renovable o VITALICIO) de un titular. Cubre una o varias mascotas (afiliacion_mascotas). Las renovaciones viven en afiliacion_contratos.';

-- ── 6. Una mascota no puede estar en dos contratos vivos a la vez ────────────
-- Antes lo garantizaba un índice parcial sobre afiliaciones.estado; ahora el
-- estado está en la otra tabla, así que va por trigger.
CREATE OR REPLACE FUNCTION public.afiliacion_mascota_unica_viva()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.estado <> 'VIGENTE' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.afiliacion_mascotas am
    JOIN public.afiliaciones a ON a.id = am.afiliacion_id
    WHERE am.mascota_id = NEW.mascota_id
      AND am.id <> NEW.id
      AND am.estado = 'VIGENTE'
      AND a.estado IN ('VIGENTE','VENCIDA')
  ) THEN
    RAISE EXCEPTION 'La mascota ya está cubierta por otra afiliación viva.'
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_afil_mascota_unica_viva ON public.afiliacion_mascotas;
CREATE TRIGGER trg_afil_mascota_unica_viva
  BEFORE INSERT OR UPDATE OF mascota_id, estado ON public.afiliacion_mascotas
  FOR EACH ROW EXECUTE FUNCTION public.afiliacion_mascota_unica_viva();

-- ── 7. GRANTs + RLS (patrón del proyecto: PostgREST + policy auth_full) ──────
GRANT ALL ON TABLE public.afiliacion_mascotas TO postgres, anon, authenticated, service_role;
ALTER TABLE public.afiliacion_mascotas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_full ON public.afiliacion_mascotas;
CREATE POLICY auth_full ON public.afiliacion_mascotas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;
