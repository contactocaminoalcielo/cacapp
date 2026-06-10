-- ============================================================
-- 03 — HARDENING DE VISTAS
-- Fecha: 2026-06-10 | Servidor: Supabase self-hosted Contabo
-- ============================================================
-- Problema: las 8 vistas de public eran owner=postgres SIN
-- security_invoker => ejecutaban con privilegios del dueño y
-- bypaseaban el RLS de las tablas base. Además anon y
-- authenticated tenían GRANT ALL sobre ellas.
-- Verificado: curl anónimo a /rest/v1/v_kanban devolvía datos
-- reales de clientes (nombre, WhatsApp, mascota, plan).
--
-- Fix:
--   1. security_invoker = on  => la vista respeta el RLS del
--      usuario que consulta (authenticated pasa por auth_full).
--   2. REVOKE ALL a anon y authenticated; GRANT SELECT solo a
--      authenticated. anon queda sin acceso (ninguna página
--      pública usa vistas).
--
-- REGLA PARA VISTAS NUEVAS: aplicar este mismo patrón al crear
-- cualquier vista con SQL raw (igual que la regla de GRANTs de
-- tablas en 02_hardening.sql).
-- ============================================================

DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'v_kanban', 'v_alertas', 'v_operacion_hoy', 'v_carga_personal',
    'v_stock_bajo', 'v_compostaje_activo', 'v_tiempo_promesa', 'v_precios_por_peso'
  ]
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = on)', v);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', v);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', v);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v);
  END LOOP;
END $$;

-- ============================================================
-- ROLLBACK (solo si una página autenticada deja de cargar):
--
-- DO $$
-- DECLARE v text;
-- BEGIN
--   FOREACH v IN ARRAY ARRAY['v_kanban','v_alertas','v_operacion_hoy',
--     'v_carga_personal','v_stock_bajo','v_compostaje_activo',
--     'v_tiempo_promesa','v_precios_por_peso']
--   LOOP
--     EXECUTE format('ALTER VIEW public.%I RESET (security_invoker)', v);
--     EXECUTE format('GRANT ALL ON public.%I TO authenticated', v);
--   END LOOP;
-- END $$;
--
-- (NO devolver GRANTs a anon bajo ninguna circunstancia.)
-- ============================================================
