-- ============================================================================
-- 190 — Seguridad: anon ya no LISTA los archivos de Storage
-- ----------------------------------------------------------------------------
-- Auditoría integral 2026-10 · DATA-002 (docs/auditoria/12-datos.md).
--
-- Con la clave pública cualquiera listaba las 7.670 fotos que las familias
-- subieron (bucket fotos-clientes) y todo lo de ofertas y plantas. Los buckets
-- siguen PÚBLICOS: las páginas y WhatsApp abren cada archivo por su URL directa
-- (/object/public/…), que no pasa por estas políticas. Lo que se cierra es el
-- LISTADO: ninguna página pública llama a `.list()` (verificado en src/).
--
-- fotos-clientes: el portal sube con INSERT … RETURNING, y Postgres exige que la
-- fila devuelta también cumpla la política de SELECT. Por eso anon conserva
-- SELECT, pero solo sobre lo subido en los últimos 15 minutos a la carpeta de un
-- servicio que hoy acepta fotos (la misma regla del INSERT, migr. 187).
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS "anon_select_fotos_clientes" ON storage.objects;
CREATE POLICY "anon_select_fotos_clientes" ON storage.objects
  FOR SELECT TO anon
  USING (
    bucket_id = 'fotos-clientes'
    AND created_at > now() - interval '15 minutes'
    AND public.portal_puede_subir_foto((string_to_array(name, '/'))[1])
  );

DROP POLICY IF EXISTS "ofertas_select_publico" ON storage.objects;
CREATE POLICY "ofertas_select_publico" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'ofertas');

DROP POLICY IF EXISTS "plantas_select_publico" ON storage.objects;
CREATE POLICY "plantas_select_publico" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'plantas');

COMMIT;

-- ============================================================================
-- Verificación (clave anon):
--   POST /storage/v1/object/list/fotos-clientes {"prefix":""} → [] o casi nada
--   GET  /storage/v1/object/public/fotos-clientes/<ruta conocida> → 200
--   /#/fotos/CODIGO de un servicio EN_CUARTO_FRIO: subir una foto → OK
-- ROLLBACK:
--   CREATE POLICY anon_select_fotos_clientes … TO anon USING (bucket_id = 'fotos-clientes');
--   ofertas/plantas: … FOR SELECT TO anon, authenticated USING (bucket_id = '<bucket>');
-- ============================================================================
