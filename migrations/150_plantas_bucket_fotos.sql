-- ============================================================================
-- 150 — Bucket público para las fotos del catálogo de plantas
--
-- Hasta ahora Configuración → Plantas solo aceptaba PEGAR una URL, así que la
-- foto tenía que estar alojada en otra parte. Con este bucket se sube desde la
-- misma pantalla, igual que la foto de un anuncio de Ofertas (migración 078).
--
-- Público a propósito: el portal de la planta lo abre una familia SIN sesión y
-- tiene que ver la imagen. Aquí no va nada de clientes — solo fotos del
-- catálogo de Camino al Cielo (helecho, pescadito, materas).
--
-- Ejecutar por SSH→psql en Contabo (ver memory/ops_aplicar_migraciones_vps.md).
-- Reversible: bloque de ROLLBACK al pie.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('plantas', 'plantas', true, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = 5242880,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "plantas_select_publico" ON storage.objects;
DROP POLICY IF EXISTS "plantas_insert_auth"    ON storage.objects;
DROP POLICY IF EXISTS "plantas_update_auth"    ON storage.objects;
DROP POLICY IF EXISTS "plantas_delete_auth"    ON storage.objects;

-- Leer: cualquiera (el portal es anónimo). Escribir: solo personal con sesión.
CREATE POLICY "plantas_select_publico" ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'plantas');
CREATE POLICY "plantas_insert_auth" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'plantas');
CREATE POLICY "plantas_update_auth" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'plantas');
CREATE POLICY "plantas_delete_auth" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'plantas');

COMMIT;

-- ============================================================================
-- ROLLBACK
--   BEGIN;
--     DROP POLICY IF EXISTS "plantas_select_publico" ON storage.objects;
--     DROP POLICY IF EXISTS "plantas_insert_auth"    ON storage.objects;
--     DROP POLICY IF EXISTS "plantas_update_auth"    ON storage.objects;
--     DROP POLICY IF EXISTS "plantas_delete_auth"    ON storage.objects;
--     DELETE FROM storage.buckets WHERE id = 'plantas';   -- solo si está vacío
--   COMMIT;
-- ============================================================================
