-- ============================================================================
-- 08 — Sincronizar la subida anónima a Storage con la ventana del PORTAL
-- Fecha: 2026-07-01  ·  Acompaña a migrations/009_portal_imagenes_ventana.sql
--
-- Problema: `anon_insert_fotos_clientes` (bucket fotos-clientes) solo permitía
-- subir si el servicio estaba en EN_CUARTO_FRIO. Tras ampliar la ventana del
-- portal a EN_PROCESO/EN_PRODUCCION (estados_portal, migración 009), el cliente
-- cuya mascota ya avanzó de etapa veía el formulario pero la subida al bucket la
-- rechazaba el RLS → "No se pudo subir una imagen. Revisa tu conexión…".
--
-- Fix: alinear el WITH CHECK de la política con la misma ventana del portal
-- (EN_CUARTO_FRIO, EN_PROCESO, EN_PRODUCCION). Los 3 estados están hardcodeados
-- a propósito (igual que CONFIG_DEFAULTS_IMAGENES.estados_portal en el código):
-- el rol anon no lee config_operativa dentro del RLS, así que evitamos depender
-- de esa tabla. Si algún día se cambia estados_portal, actualizar también aquí.
--
-- Ejecutar por SSH→psql en Contabo. Reversible (rollback al pie).
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS "anon_insert_fotos_clientes" ON storage.objects;

CREATE POLICY "anon_insert_fotos_clientes" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'fotos-clientes'
    AND (string_to_array(name, '/'))[1] IN (
      SELECT s.id::text FROM public.servicios s
      WHERE s.estado::text IN ('EN_CUARTO_FRIO', 'EN_PROCESO', 'EN_PRODUCCION')
    )
  );

COMMIT;

-- ============================================================================
-- ROLLBACK (volver a la ventana anterior, solo cuarto frío):
--   BEGIN;
--   DROP POLICY IF EXISTS "anon_insert_fotos_clientes" ON storage.objects;
--   CREATE POLICY "anon_insert_fotos_clientes" ON storage.objects
--     FOR INSERT TO anon
--     WITH CHECK (
--       bucket_id = 'fotos-clientes'
--       AND (string_to_array(name, '/'))[1] IN (
--         SELECT s.id::text FROM public.servicios s WHERE s.estado::text = 'EN_CUARTO_FRIO'
--       )
--     );
--   COMMIT;
-- ============================================================================
