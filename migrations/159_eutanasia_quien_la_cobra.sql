-- 159 — Quién cobró la eutanasia: el técnico o el doctor.
-- Fecha: 2026-09-16 · pedido de David
--
-- EL PROBLEMA. Un servicio con eutanasia compasiva guarda su valor DENTRO de
-- `servicios.valor_total` (Registro.jsx lo suma al registrar), pero la eutanasia
-- vive en su propia tabla y nadie más se entera. Cuando el doctor le cobra su
-- eutanasia directo a la familia —cosa que pasa seguido— el técnico llega y
-- cobra solo el resto. A partir de ahí TODO queda torcido:
--
--   1. El cuadre le marca al TÉCNICO un faltante por el valor de la eutanasia:
--      compara `servicios.valor_total` contra lo que recogió (migr. 152).
--   2. La cartera persigue a la familia por una plata que ya pagó.
--   3. La eutanasia se queda `PENDIENTE` para siempre en su módulo, aunque sí
--      se haya cobrado.
--
-- Medido en producción el 16-sep-2026 sobre los 18 servicios con eutanasia:
--   · 6 de 15 recibos cobraron EXACTAMENTE el servicio menos la eutanasia
--     (KIRA, BLACK, NICKY, LILU, PANCHA, MANCHAS) → ~$1.178.000 de faltantes
--     falsos repartidos entre los técnicos.
--   · NEO (11-jul): recibo por $689.000 y cobro de $869.000. Los $180.000 de
--     diferencia son su eutanasia EXACTA: se le cobró dos veces a la familia.
--   · 17 de 19 eutanasias seguían en `PENDIENTE`, 8 de ellas con el servicio
--     ya `COMPLETO`.
--
-- LA DECISIÓN DE NEGOCIO (David, 16-sep-2026): la plata de la eutanasia que
-- cobra el doctor ES DEL DOCTOR —él solo le pasa una ganancia a Camino—, así
-- que NO puede quedar como saldo por cobrar a la familia: sale del valor del
-- servicio. Esa ganancia del doctor NO se liquida en Orbit todavía; lo que sí
-- queda es el dato (quién cobró, cuánto, qué veterinario y cuándo) para poder
-- liquidarla el día que se quiera.
--
-- 🩸 LA TRAMPA QUE HUBO QUE DESACTIVAR. `cobro_conjunto = true` NO significa
-- "su valor está dentro del total del servicio": el módulo /eutanasias crea
-- eutanasias con esa bandera SIN tocar `servicios.valor_total`, y vincula el
-- servicio después. En producción está KIRA CRISTANCHO, cuyo `valor_total`
-- ($169.000) es MENOR que su eutanasia ($200.000). Restar por la bandera le
-- habría dejado el servicio en negativo. Por eso nace `servicios.valor_eutanasia`
-- (cuánto del total ES eutanasia, escrito por Registro) y el backfill de abajo
-- no adivina: verifica la aritmética del desglose y, si no cuadra, deja 0 —
-- y con 0 el recibo del técnico ni siquiera ofrece la decisión.
--
-- Aplicar por SSH en Contabo (producción):
--   cat migrations/159_eutanasia_quien_la_cobra.sql | ssh -i ~/.ssh/orbit_deploy \
--     root@13.140.139.61 'cd /opt/supabase/docker && \
--     docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 --pset pager=off'
--
-- Idempotente: IF NOT EXISTS / CREATE OR REPLACE. Se puede correr dos veces.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 1. Cuánto del precio del servicio ES eutanasia ──────────────────────────
ALTER TABLE public.servicios
  ADD COLUMN IF NOT EXISTS valor_eutanasia numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.servicios.valor_eutanasia
  IS 'Parte de valor_total que corresponde a la eutanasia compasiva (Registro la suma al total). 0 = el total NO la incluye, y entonces nadie puede restarla. Pasa a 0 cuando el doctor la cobró directo: ahí esa plata deja de ser de Camino y sale de valor_total.';

-- ── 2. Quién terminó cobrándola ─────────────────────────────────────────────
ALTER TABLE public.eutanasias
  ADD COLUMN IF NOT EXISTS cobrada_por text,
  ADD COLUMN IF NOT EXISTS cobrada_en  timestamptz,
  ADD COLUMN IF NOT EXISTS descontada_del_servicio numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.eutanasias.descontada_del_servicio
  IS 'Cuánto se le restó de verdad a servicios.valor_total al marcar que la cobró el veterinario. Es lo que hay que devolver si se deshace: NO se puede usar el precio de hoy, porque la tarifa pudo cambiar, ni valor_pagado, que es lo que pagó la familia (al doctor).';

DO $$ BEGIN
  ALTER TABLE public.eutanasias
    ADD CONSTRAINT eutanasias_cobrada_por_chk
    CHECK (cobrada_por IS NULL OR cobrada_por IN ('TECNICO','VETERINARIO'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.eutanasias.cobrada_por
  IS 'TECNICO = la cobró el técnico dentro del recibo del servicio · VETERINARIO = el doctor le cobró directo a la familia (esa plata es de él) · NULL = todavía no se ha decidido, y el recibo del técnico no deja guardar sin decidirlo.';

-- ── 3. Backfill de valor_eutanasia — verificando, no adivinando ─────────────
-- Solo se marca cuando el desglose congelado del servicio + la eutanasia
-- reconstruyen exactamente el bruto registrado (±$1 por redondeos). Es la misma
-- cuenta que hace la reconciliación de Finanzas:
--   bruto = valor_total + comisión (si está descontada)
--   bruto = plan + adicionales + transporte + recargo nocturno − descuento + eutanasia
-- Los que no cuadran (desamparado, servicios viejos sin desglose, KIRA
-- CRISTANCHO) se quedan en 0 a propósito: mejor no ofrecer la resta que
-- ofrecerla mal.
UPDATE public.servicios s
   SET valor_eutanasia = e.valor
  FROM public.eutanasias e
 WHERE e.id = s.eutanasia_id
   AND s.valor_eutanasia = 0
   AND COALESCE(e.valor, 0) > 0
   AND s.valor_plan IS NOT NULL
   AND abs(
         (COALESCE(s.valor_total,0) + CASE WHEN s.comision_descontada THEN COALESCE(s.comision_aliado,0) ELSE 0 END)
         - (COALESCE(s.valor_plan,0) + COALESCE(s.valor_adicionales,0) + COALESCE(s.valor_transporte,0)
            + COALESCE(s.recargo_nocturno,0) - COALESCE(s.descuento_adicional,0) + e.valor)
       ) <= 1;

-- ── 4. La RPC: registrar quién la cobró (y poder deshacerlo) ────────────────
-- Atómica e idempotente. La idempotencia NO es cosmética: sin ella, reabrir el
-- recibo o un doble toque restarían el valor de la eutanasia DOS veces del
-- servicio, y eso deja un precio falso que nadie sabría reconstruir.
--
-- p_cobrada_por:
--   'VETERINARIO' → la plata es del doctor: sale de valor_total, la eutanasia
--                   queda pagada (a él) y el servicio recalcula su estado_pago.
--   'TECNICO'     → la cobra el técnico con el plan: el servicio no se toca,
--                   solo se cierra el estado de pago de la eutanasia.
--   NULL          → deshacer: si la había cobrado el doctor, el valor VUELVE al
--                   servicio (para cuando el técnico se equivoca de botón).
CREATE OR REPLACE FUNCTION public.registrar_cobro_eutanasia(
  p_eutanasia_id uuid,
  p_cobrada_por  text DEFAULT NULL,
  p_actor_id     uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_eut          record;
  v_svc          record;
  v_prev         text;
  v_monto        numeric := 0;
  v_nuevo_total  numeric;
  v_nuevo_estado text;
  v_nota         text;
  v_vet          text;
BEGIN
  IF p_cobrada_por IS NOT NULL AND p_cobrada_por NOT IN ('TECNICO','VETERINARIO') THEN
    RAISE EXCEPTION 'COBRADA_POR_INVALIDA: %', p_cobrada_por;
  END IF;

  SELECT * INTO v_eut FROM public.eutanasias WHERE id = p_eutanasia_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EUTANASIA_NO_EXISTE: %', p_eutanasia_id;
  END IF;

  v_prev := v_eut.cobrada_por;

  -- Ya estaba decidido lo mismo → no se toca nada (esta es la puerta que impide
  -- restar dos veces). Se responde el estado actual para que el front no
  -- distinga entre "lo hice yo" y "ya estaba".
  IF v_prev IS NOT DISTINCT FROM p_cobrada_por THEN
    SELECT COALESCE(valor_total,0) INTO v_nuevo_total
      FROM public.servicios WHERE id = v_eut.servicio_id;
    RETURN jsonb_build_object(
      'eutanasia_id', p_eutanasia_id, 'cobrada_por', v_prev,
      'sin_cambios', true, 'valor_total_servicio', v_nuevo_total);
  END IF;

  SELECT nombre INTO v_vet FROM public.veterinarios WHERE id = v_eut.veterinario_id;

  -- ── Deshacer lo que había: si el doctor la tenía cobrada, devolver la plata
  -- al servicio ANTES de aplicar la decisión nueva. Se devuelve EXACTAMENTE lo
  -- que se restó (`descontada_del_servicio`), no el precio de hoy ni el valor
  -- de la eutanasia: si el backfill no pudo confirmar que estaba dentro del
  -- total, no se restó nada y aquí no se puede regalar plata al servicio.
  IF v_prev = 'VETERINARIO' AND v_eut.servicio_id IS NOT NULL THEN
    v_monto := COALESCE(v_eut.descontada_del_servicio, 0);
    IF v_monto > 0 THEN
      SELECT * INTO v_svc FROM public.servicios WHERE id = v_eut.servicio_id FOR UPDATE;
      v_nuevo_total := COALESCE(v_svc.valor_total,0) + v_monto;
      v_nuevo_estado := CASE
        WHEN COALESCE(v_svc.valor_pagado,0) <= 0 THEN 'PENDIENTE'
        WHEN COALESCE(v_svc.valor_pagado,0) >= v_nuevo_total THEN 'COMPLETO'
        ELSE 'PARCIAL' END;
      UPDATE public.servicios
         SET valor_total     = v_nuevo_total,
             valor_eutanasia = v_monto,
             estado_pago     = v_nuevo_estado
       WHERE id = v_eut.servicio_id;
      INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion, valor_ajuste, registrado_por)
      VALUES (v_eut.servicio_id, 'NOTA',
        'Eutanasia devuelta al servicio: se había registrado que la cobró el veterinario'
        || COALESCE(' (' || v_vet || ')', '') || ', y no fue así. El servicio vuelve a valer '
        || '$ ' || replace(to_char(v_nuevo_total, 'FM999G999G999'), ',', '.')
        || ' y la eutanasia queda otra vez por cobrar.',
        v_monto, p_actor_id);
    END IF;
  END IF;

  -- ── El doctor la cobró: esa plata no es de Camino, sale del servicio ──────
  IF p_cobrada_por = 'VETERINARIO' THEN
    v_monto := 0;
    IF v_eut.servicio_id IS NOT NULL THEN
      SELECT * INTO v_svc FROM public.servicios WHERE id = v_eut.servicio_id FOR UPDATE;
      -- Solo se resta lo que de verdad está DENTRO del total (columna del
      -- backfill). Si es 0, el total nunca la incluyó y no hay nada que restar.
      v_monto := LEAST(COALESCE(v_svc.valor_eutanasia,0), COALESCE(v_svc.valor_total,0));
      IF v_monto > 0 THEN
        v_nuevo_total := COALESCE(v_svc.valor_total,0) - v_monto;
        v_nuevo_estado := CASE
          WHEN COALESCE(v_svc.valor_pagado,0) <= 0 THEN 'PENDIENTE'
          WHEN COALESCE(v_svc.valor_pagado,0) >= v_nuevo_total THEN 'COMPLETO'
          ELSE 'PARCIAL' END;
        UPDATE public.servicios
           SET valor_total     = v_nuevo_total,
               valor_eutanasia = 0,
               estado_pago     = v_nuevo_estado
         WHERE id = v_eut.servicio_id;
        v_nota := 'Eutanasia cobrada por el veterinario'
          || COALESCE(' (' || v_vet || ')', '') || ': el técnico NO la cobró. '
          || '$ ' || replace(to_char(v_monto, 'FM999G999G999'), ',', '.')
          || ' salen del valor del servicio porque esa plata es del doctor, no de Camino. '
          || 'El servicio queda en $ ' || replace(to_char(v_nuevo_total, 'FM999G999G999'), ',', '.')
          || ' y no queda saldo pendiente por ese concepto.';
        INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion, valor_ajuste, registrado_por)
        VALUES (v_eut.servicio_id, 'NOTA', v_nota, -v_monto, p_actor_id);
      END IF;
    END IF;
    UPDATE public.eutanasias
       SET cobrada_por             = 'VETERINARIO',
           cobrada_en              = now(),
           estado_pago             = 'COMPLETO',
           valor_pagado            = COALESCE(valor, 0),   -- lo que pagó la familia (al doctor)
           descontada_del_servicio = v_monto,              -- lo que de verdad salió del servicio
           metodo_pago             = 'COBRADA POR EL VETERINARIO',
           cobro_conjunto          = false
     WHERE id = p_eutanasia_id;

  -- ── La cobra el técnico junto con el plan: el servicio no se toca ─────────
  ELSIF p_cobrada_por = 'TECNICO' THEN
    SELECT * INTO v_svc FROM public.servicios WHERE id = v_eut.servicio_id;
    UPDATE public.eutanasias
       SET cobrada_por             = 'TECNICO',
           cobrada_en              = now(),
           cobro_conjunto          = true,
           descontada_del_servicio = 0,
           estado_pago    = CASE WHEN v_svc.estado_pago = 'COMPLETO' THEN 'COMPLETO'
                                 WHEN COALESCE(v_svc.valor_pagado,0) > 0 THEN 'PARCIAL'
                                 ELSE 'PENDIENTE' END,
           valor_pagado   = CASE WHEN v_svc.estado_pago = 'COMPLETO' THEN COALESCE(valor,0)
                                 ELSE COALESCE(valor_pagado,0) END
     WHERE id = p_eutanasia_id;

  -- ── Deshacer del todo: vuelve a quedar sin decidir ────────────────────────
  ELSE
    UPDATE public.eutanasias
       SET cobrada_por             = NULL,
           cobrada_en              = NULL,
           estado_pago             = 'PENDIENTE',
           valor_pagado            = 0,
           descontada_del_servicio = 0,
           metodo_pago             = NULL,
           cobro_conjunto          = true
     WHERE id = p_eutanasia_id;
  END IF;

  SELECT COALESCE(valor_total,0) INTO v_nuevo_total
    FROM public.servicios WHERE id = v_eut.servicio_id;

  RETURN jsonb_build_object(
    'eutanasia_id',         p_eutanasia_id,
    'servicio_id',          v_eut.servicio_id,
    'cobrada_por',          p_cobrada_por,
    'anterior',             v_prev,
    'monto_movido',         v_monto,
    'valor_total_servicio', v_nuevo_total,
    'sin_cambios',          false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_cobro_eutanasia(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_cobro_eutanasia(uuid, text, uuid) TO authenticated, service_role;

-- ── 5. La vista de la agenda muestra quién la cobró ─────────────────────────
DROP VIEW IF EXISTS public.v_eutanasias_agenda;
CREATE VIEW public.v_eutanasias_agenda
WITH (security_invoker = on) AS
SELECT
  e.id, e.estado, e.estado_pago, e.fecha_solicitada, e.hora_solicitada,
  e.ciudad, e.direccion, e.peso_kg, e.valor, e.valor_pagado,
  e.cobro_conjunto, e.requiere_recoleccion, e.servicio_id,
  e.created_at, e.realizada_at, e.cerrada_at,
  e.cobrada_por, e.cobrada_en,
  c.nombre   AS cliente_nombre,
  c.apellido AS cliente_apellido,
  m.nombre   AS mascota_nombre,
  m.especie_id,
  v.id       AS veterinario_id,
  v.nombre   AS veterinario_nombre,
  v.telefono AS veterinario_telefono,
  r.nombre   AS responsable_nombre,
  s.estado   AS servicio_estado,
  s.plan_id  AS servicio_plan_id
FROM public.eutanasias e
LEFT JOIN public.clientes     c ON c.id_cliente  = e.cliente_id
LEFT JOIN public.mascotas     m ON m.id_mascota  = e.mascota_id
LEFT JOIN public.veterinarios v ON v.id          = e.veterinario_id
LEFT JOIN public.personal     r ON r.id          = e.responsable_id
LEFT JOIN public.servicios    s ON s.id          = e.servicio_id;

REVOKE ALL ON public.v_eutanasias_agenda FROM anon;
GRANT SELECT ON public.v_eutanasias_agenda TO authenticated;

-- ── 6. El recibo del técnico guarda LO QUE ÉL TENÍA QUE COBRAR ──────────────
-- No cambia nada en la DB: deja escrito el significado nuevo de la columna, que
-- es lo que hace que el cuadre deje de cobrarle faltantes falsos. `valor_total`
-- del recibo ya NO es "lo que vale el servicio" sino "lo que a este técnico le
-- tocaba cobrar" — el cuadre resta la diferencia como `valor_posterior_recibo`
-- (migr. 143) y no se la imputa a él.
COMMENT ON COLUMN public.recibos_tecnico.valor_total
  IS 'Lo que a ESTE técnico le tocaba cobrar en este recibo: el valor del servicio menos lo que no cobra aquí (adicionales que paga el propietario, eutanasia que cobró el doctor). El cuadre compara contra esto; la diferencia contra el valor del servicio se persigue en la cartera, no en el cuadre del técnico.';

COMMIT;

-- ── Verificación ────────────────────────────────────────────────────────────
-- SELECT m.nombre, s.valor_total, s.valor_eutanasia, e.valor, e.cobrada_por
--   FROM servicios s JOIN eutanasias e ON e.id = s.eutanasia_id
--   LEFT JOIN mascotas m ON m.id_mascota = s.mascota_id
--  ORDER BY s.fecha_ingreso DESC;
--
-- ROLLBACK manual (solo si hay que revertir; la columna conserva los datos):
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.registrar_cobro_eutanasia(uuid, text, uuid);
-- ALTER TABLE public.eutanasias DROP COLUMN IF EXISTS cobrada_por, DROP COLUMN IF EXISTS cobrada_en;
-- ALTER TABLE public.servicios  DROP COLUMN IF EXISTS valor_eutanasia;
-- COMMIT;
