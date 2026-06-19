-- ============================================================================
-- 07 — Hardening del portal público de fotos (/fotos/CODIGO)
-- Fecha: 2026-06-19  ·  Acompaña a migrations/008_solicitudes_imagenes_flujo.sql
--
-- Problema (auditoría del flujo de imágenes): el navegador anónimo podía
--   - UPDATE servicios            (gateado solo por estado=EN_CUARTO_FRIO)
--   - UPDATE/INSERT servicio_recordatorios (idem)
-- → un cliente podía cambiar estados arbitrarios del servicio asociado, eliminar
--   o agregar recordatorios. Con el flujo nuevo TODA escritura del portal pasa
--   por el backend propio (endpoint /portal/imagenes/:codigo, valida el código y
--   limita los cambios a SU servicio). Por eso aquí REVOCAMOS la escritura anónima.
--
-- Las CARGAS a Storage siguen desde el navegador (bucket fotos-clientes con su
-- policy anónima gateada). Las lecturas del portal pasan a backend → se puede
-- revocar también el SELECT anónimo (bloque opcional, ver al final).
--
-- Ejecutar por SSH→psql en Contabo. Reversible (rollback al pie).
-- ============================================================================

-- ─── 1. Quitar escritura anónima directa a servicios ────────────────────────
DROP POLICY IF EXISTS "anon_update_servicios_fotos" ON public.servicios;

-- ─── 2. Quitar escritura anónima directa a servicio_recordatorios ───────────
DROP POLICY IF EXISTS "anon_update_sr" ON public.servicio_recordatorios;
DROP POLICY IF EXISTS "anon_insert_sr" ON public.servicio_recordatorios;

-- NOTA: si en producción los nombres difieren, listarlos con:
--   SELECT polname, tablename FROM pg_policies
--   WHERE tablename IN ('servicios','servicio_recordatorios') AND polname LIKE 'anon%';
-- y dropear los que otorguen UPDATE/INSERT a anon.

-- ─── 3. Límites de MIME y tamaño en el bucket fotos-clientes (RR-3) ──────────
-- Refuerzo a nivel de Storage (además de la validación del navegador y backend).
UPDATE storage.buckets
SET file_size_limit   = 8388608,  -- 8 MB
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']
WHERE id = 'fotos-clientes';

-- ─── 4. (OPCIONAL, recomendado tras verificar el portal en prod) ────────────
-- El portal ya no lee estas tablas como anon (usa el backend). Una vez confirmado
-- en producción que /fotos carga vía /portal/imagenes/:codigo, revocar la lectura
-- anónima elimina la exposición de datos personales del cliente (RR-1):
--
--   DROP POLICY IF EXISTS "anon_select_servicios_fotos" ON public.servicios;
--   DROP POLICY IF EXISTS "anon_select_sr"              ON public.servicio_recordatorios;
--   DROP POLICY IF EXISTS "anon_select_mascotas_fotos"  ON public.mascotas;
--   (verificar nombres reales con la query de pg_policies de arriba)

-- ============================================================================
-- ROLLBACK (re-crear las policies anónimas de escritura — solo si hace falta):
--   CREATE POLICY "anon_update_servicios_fotos" ON public.servicios
--     FOR UPDATE TO anon USING (estado = 'EN_CUARTO_FRIO') WITH CHECK (estado = 'EN_CUARTO_FRIO');
--   CREATE POLICY "anon_update_sr" ON public.servicio_recordatorios FOR UPDATE TO anon
--     USING (EXISTS (SELECT 1 FROM public.servicios s WHERE s.id = servicio_id AND s.estado='EN_CUARTO_FRIO'))
--     WITH CHECK (EXISTS (SELECT 1 FROM public.servicios s WHERE s.id = servicio_id AND s.estado='EN_CUARTO_FRIO'));
--   CREATE POLICY "anon_insert_sr" ON public.servicio_recordatorios FOR INSERT TO anon
--     WITH CHECK (EXISTS (SELECT 1 FROM public.servicios s WHERE s.id = servicio_id AND s.estado='EN_CUARTO_FRIO'));
--   UPDATE storage.buckets SET file_size_limit=NULL, allowed_mime_types=NULL WHERE id='fotos-clientes';
-- ============================================================================
