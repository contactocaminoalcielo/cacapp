-- ============================================================================
-- 06 — Storage: políticas RLS del bucket `certificados`
-- Fecha: 2026-06-17
--
-- El bucket `certificados` (público para lectura) NO tenía políticas de escritura
-- en storage.objects, así que el upload del PDF del reporte fallaba con
-- "new row violates row-level security policy". Se agregan políticas para
-- `authenticated` con el mismo patrón que `evidencias`/`fotos-clientes`.
-- Ya ejecutado en producción (Contabo) — este archivo documenta/re-ejecuta.
-- ============================================================================

DROP POLICY IF EXISTS "auth_insert_certificados" ON storage.objects;
DROP POLICY IF EXISTS "auth_select_certificados" ON storage.objects;
DROP POLICY IF EXISTS "auth_update_certificados" ON storage.objects;

CREATE POLICY "auth_insert_certificados" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'certificados');
CREATE POLICY "auth_select_certificados" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'certificados');
CREATE POLICY "auth_update_certificados" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'certificados');

-- ROLLBACK:
--   DROP POLICY IF EXISTS "auth_insert_certificados" ON storage.objects;
--   DROP POLICY IF EXISTS "auth_select_certificados" ON storage.objects;
--   DROP POLICY IF EXISTS "auth_update_certificados" ON storage.objects;
