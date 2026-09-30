-- Unificar las dos fichas de Central Vet (David, 30-sep-2026: "es la misma clínica").
--
-- QUEDA  79949ac5-f733-4baa-a9ff-d4a5739a2714  «Clínica veterinaria Centralvet»
--        La creó la vet en el portal y coordinación la validó el 27-sep. Tiene NIT,
--        contacto, el WhatsApp 3137034305 (el agente la reconoce por ese número) y
--        las 3 solicitudes que la vet mandó con SU enlace.
-- SE VA  57b5bff8-ca7f-4e4d-9b3a-8500a62f37af  «CLINICA VETERINARIA CENTRAL VET»
--        Creada a mano el 27-jul, sin WhatsApp, NIT ni solicitudes. Solo tiene
--        5 servicios y sus 5 recogidas, que pasan a la que queda.
--
-- Juntas cumplen la regla VIP (3 en ago, 4 en sep): la que queda sale VIP.
--
-- ENSAYO (revierte todo al final):
--   cat scripts/unificar_central_vet.sql | ssh … "docker exec -i supabase-db psql -U postgres -d postgres -f -"
-- APLICAR:
--   … psql -U postgres -d postgres -v aplicar=1 -f -"
--
-- Las 7 FKs hacia `aliados` son NO ACTION: si quedara alguna referencia sin mover,
-- el DELETE falla y con ON_ERROR_STOP no se aplica nada.

\set ON_ERROR_STOP on
\pset pager off

BEGIN;
SET LOCAL lock_timeout = '5s';

\echo '== Triggers de las tablas que se tocan (¿alguno lee el aliado?) =='
SELECT c.relname AS tabla, t.tgname AS trigger, p.proname AS funcion,
       pg_get_functiondef(p.oid) ILIKE '%aliado%' AS menciona_aliado
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_proc  p ON p.oid = t.tgfoid
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relname IN ('servicios', 'recogidas', 'aliados')
   AND NOT t.tgisinternal
 ORDER BY 1, 2;

DO $$
DECLARE n int;
BEGIN
  IF (SELECT count(*) FROM public.aliados
       WHERE id_aliado IN ('79949ac5-f733-4baa-a9ff-d4a5739a2714', '57b5bff8-ca7f-4e4d-9b3a-8500a62f37af')) <> 2 THEN
    RAISE EXCEPTION 'No están las dos fichas: ¿ya se unificaron?';
  END IF;

  UPDATE public.servicios SET aliado_origen_id = '79949ac5-f733-4baa-a9ff-d4a5739a2714'
   WHERE aliado_origen_id = '57b5bff8-ca7f-4e4d-9b3a-8500a62f37af';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 5 THEN RAISE EXCEPTION 'servicios: se esperaban 5 y fueron %', n; END IF;
  RAISE NOTICE 'servicios movidos: %', n;

  UPDATE public.recogidas SET aliado_id = '79949ac5-f733-4baa-a9ff-d4a5739a2714'
   WHERE aliado_id = '57b5bff8-ca7f-4e4d-9b3a-8500a62f37af';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 5 THEN RAISE EXCEPTION 'recogidas: se esperaban 5 y fueron %', n; END IF;
  RAISE NOTICE 'recogidas movidas: %', n;
END $$;

UPDATE public.aliados SET vip = true
 WHERE id_aliado = '79949ac5-f733-4baa-a9ff-d4a5739a2714'
RETURNING nombre, vip;

DELETE FROM public.aliados
 WHERE id_aliado = '57b5bff8-ca7f-4e4d-9b3a-8500a62f37af'
RETURNING nombre AS borrada;

\echo '== Todo lo que escribió esta transacción, triggers incluidos =='
SELECT relname AS tabla, n_tup_ins AS insertadas, n_tup_upd AS actualizadas, n_tup_del AS borradas
  FROM pg_stat_xact_user_tables
 WHERE n_tup_ins + n_tup_upd + n_tup_del > 0
 ORDER BY 1;

\echo '== La que queda: servicios por mes (esperado ago 3 · sep 4) =='
SELECT to_char(s.fecha_ingreso, 'YYYY-MM') AS mes, count(*)
  FROM public.servicios s JOIN public.planes p ON p.id = s.plan_id
 WHERE s.aliado_origen_id = '79949ac5-f733-4baa-a9ff-d4a5739a2714'
   AND s.estado <> 'CANCELADO' AND p.codigo <> 'DESAMPARADO'
   AND s.fecha_ingreso >= '2026-08-01'
 GROUP BY 1 ORDER BY 1;

\if :{?aplicar}
COMMIT;
\echo '>>> APLICADO'
\else
ROLLBACK;
\echo '>>> ENSAYO: revertido'
\endif

\echo '== Después: ¿sigue existiendo la ficha que se iba? (ensayo = 1, aplicado = 0) =='
SELECT count(*) AS ficha_vieja FROM public.aliados WHERE id_aliado = '57b5bff8-ca7f-4e4d-9b3a-8500a62f37af';
