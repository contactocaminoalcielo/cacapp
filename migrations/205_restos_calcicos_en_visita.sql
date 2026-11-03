-- ============================================================================
-- 205 — Restos cálcicos: de primer contacto a la VISITA a la planta, con foto
-- Fecha: 2026-11-03 · Reporte Orbit (mejora de automatización, media-alta)
--
-- Coordinación pidió:
--   · Sacar la pregunta de los restos del primer contacto (portal de fotos).
--     En su lugar se ofrece una SEGUNDA PLANTA: no requiere nada nuevo en la DB,
--     usa `planta_adicionales` de la 149 sobre la fila RESERVADA de la 176.
--   · Preguntarla en el portal de visita (aviso de mitad de compostaje, 159):
--     «¿Deseas recibir los restos cálcicos…?» Sí / No.
--   · Si dice que sí, la foto para personalizar el cenizario es OBLIGATORIA
--     (David 2026-11-03: sin foto no queda solicitud) e identificada como
--     FOTO – CENIZARIO RESTOS CÁLCICOS, aparte de memorial/memopet/recordatorios.
--   · Alerta para Tenjo y seguimiento en Producción–Diseño, APARTE de las líneas
--     de recordatorio (David: no debe mover el estado del servicio).
--
-- Todo va en la MISMA fila de `planta_elecciones`, como ya iban los restos.
--
-- ⚠️ ORDEN: esta migración → backend → frontend (git push).
-- Ejecutar por SSH→psql en Contabo. Reversible: bloque de ROLLBACK al pie.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ─── Respuesta, foto y avance del cenizario ─────────────────────────────────
ALTER TABLE public.planta_elecciones
  ADD COLUMN IF NOT EXISTS restos_respuesta           text CHECK (restos_respuesta IN ('SI','NO')),
  ADD COLUMN IF NOT EXISTS restos_respuesta_en        timestamptz,
  ADD COLUMN IF NOT EXISTS restos_foto_url            text,
  ADD COLUMN IF NOT EXISTS restos_foto_en             timestamptz,
  ADD COLUMN IF NOT EXISTS restos_cenizario_listo_en  timestamptz,
  ADD COLUMN IF NOT EXISTS restos_cenizario_listo_por uuid REFERENCES public.personal(id);

COMMENT ON COLUMN public.planta_elecciones.restos_respuesta IS
  'SI/NO de la familia a los restos cálcicos (portal de visita). NULL = no ha respondido. Un NO no se vuelve a preguntar.';
COMMENT ON COLUMN public.planta_elecciones.restos_foto_url IS
  'FOTO – CENIZARIO RESTOS CÁLCICOS: la que se usa para personalizar el cenizario de los restos. No es foto de recordatorio.';
COMMENT ON COLUMN public.planta_elecciones.restos_cenizario_listo_en IS
  'Diseño marcó el cenizario de los restos como listo (tablero Producción). No toca el estado del servicio.';

-- Los que ya compraron en el primer contacto (176) cuentan como SÍ: el portal
-- de visita solo les pide la foto que les falta.
UPDATE public.planta_elecciones
   SET restos_respuesta = 'SI', restos_respuesta_en = COALESCE(restos_calcicos_en, now())
 WHERE restos_calcicos = true AND restos_respuesta IS NULL;

-- ─── Subida de la foto desde el portal de visita ────────────────────────────
-- Carpeta fotos-clientes/restos-calcicos/<código del aviso>/…, mientras el
-- enlace de visita siga vivo (mascota en el cubículo, servicio sin entregar)
-- y con tope de archivos. Misma idea que portal_compra_web_abierta (200).
-- No se usa portal_puede_subir_foto: a mitad de compostaje un Compets con sus
-- recordatorios ya hechos puede estar LISTO, y esa función lo rechaza.
CREATE OR REPLACE FUNCTION public.portal_restos_abierto(p_codigo text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.avisos_mitad_compostaje a
      JOIN public.servicios s ON s.id = a.servicio_id
      LEFT JOIN public.lotes_tenjo_items i ON i.id = a.lote_item_id
     WHERE a.codigo = p_codigo
       AND s.estado::text NOT IN ('CANCELADO', 'ENTREGADO')
       AND i.cubiculo_liberado_en IS NULL)
  AND (SELECT count(*) FROM storage.objects o
        WHERE o.bucket_id = 'fotos-clientes'
          AND o.name LIKE 'restos-calcicos/' || p_codigo || '/%') < 10
$$;
REVOKE ALL ON FUNCTION public.portal_restos_abierto(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_restos_abierto(text) TO anon, authenticated, service_role;

-- Las dos políticas de anon en fotos-clientes, tal como las dejó la 200, + la
-- carpeta de los restos.
DROP POLICY IF EXISTS "anon_insert_fotos_clientes" ON storage.objects;
CREATE POLICY "anon_insert_fotos_clientes" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'fotos-clientes'
    AND (
      public.portal_puede_subir_foto((string_to_array(name, '/'))[1])
      OR ((string_to_array(name, '/'))[1] = 'compra-web'
          AND public.portal_compra_web_abierta((string_to_array(name, '/'))[2]))
      OR ((string_to_array(name, '/'))[1] = 'restos-calcicos'
          AND public.portal_restos_abierto((string_to_array(name, '/'))[2]))
    )
  );

DROP POLICY IF EXISTS "anon_select_fotos_clientes" ON storage.objects;
CREATE POLICY "anon_select_fotos_clientes" ON storage.objects
  FOR SELECT TO anon
  USING (
    bucket_id = 'fotos-clientes'
    AND created_at > now() - interval '15 minutes'
    AND (
      public.portal_puede_subir_foto((string_to_array(name, '/'))[1])
      OR ((string_to_array(name, '/'))[1] = 'compra-web'
          AND public.portal_compra_web_abierta((string_to_array(name, '/'))[2]))
      OR ((string_to_array(name, '/'))[1] = 'restos-calcicos'
          AND public.portal_restos_abierto((string_to_array(name, '/'))[2]))
    )
  );

COMMIT;
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICAR:
--   SELECT count(*) FILTER (WHERE restos_respuesta = 'SI') AS si,
--          count(*) FILTER (WHERE restos_calcicos) AS comprados
--     FROM public.planta_elecciones;                       -- deben coincidir
--   SELECT polname FROM pg_policy WHERE polname LIKE 'anon_%_fotos_clientes';
--   -- Y que siga funcionando: portal /#/fotos/CODIGO y /#/catalogo (subir foto).
--
-- ROLLBACK:
--   BEGIN;
--     (recrear las dos políticas con la definición de la 200, sin la rama de restos)
--     DROP FUNCTION IF EXISTS public.portal_restos_abierto(text);
--     ALTER TABLE public.planta_elecciones
--       DROP COLUMN IF EXISTS restos_respuesta, DROP COLUMN IF EXISTS restos_respuesta_en,
--       DROP COLUMN IF EXISTS restos_foto_url, DROP COLUMN IF EXISTS restos_foto_en,
--       DROP COLUMN IF EXISTS restos_cenizario_listo_en, DROP COLUMN IF EXISTS restos_cenizario_listo_por;
--   COMMIT;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================
