-- ════════════════════════════════════════════════════════════════════════════
-- 199 — Mascotas del proyecto de la Alcaldía (Animal City) — decisión de David, 22-oct-2026
-- ════════════════════════════════════════════════════════════════════════════
-- «Cuando la veterinaria esté registrando el servicio en su enlace, o el
-- coordinador o administrador registre un servicio de Animal City, debe
-- preguntar si esta mascota pertenece al proyecto de la Alcaldía, sí o no.
-- Si es SÍ, la mascota queda con la etiqueta y su certificado de cremación
-- grupal sale únicamente con el nombre de esa mascota.»
--
-- Decisiones (David, 22-oct):
--   · el certificado de la mascota de la Alcaldía es la misma tabla de siempre
--     pero con UNA sola fila (la suya), y el peso total del texto es el de ella;
--   · las mascotas de la Alcaldía NO salen en el certificado del lote que
--     reciben las demás familias.
--
-- Va como bandera en `aliados` y no amarrado al id de Animal City: si otra
-- veterinaria entra a un convenio igual, se enciende y ya.
--
-- Columnas:
--   aliados.convenio_alcaldia            → la vet pregunta (hoy solo Animal City)
--   solicitudes_servicio.es_alcaldia     → lo que respondió la vet en su enlace
--                                          (NULL = no se le preguntó)
--   servicios.es_alcaldia                → la etiqueta de la mascota
--   reportes_grupales_items.es_alcaldia  → copia que hace el backend al sincronizar
--   reportes_grupales_items.storage_path → el PDF propio de esa mascota; el
--                                          backend se NIEGA a mandarle el del lote
--
-- 🪤 aliados tiene permiso de lectura por COLUMNAS (migr. 194): la nueva va al
--    GRANT y a ALIADOS_COLUMNAS (src/lib/aliados.js), o la consulta da 42501.
-- 🪤 servicios.es_alcaldia es NOT NULL DEFAULT false: el frontend manda siempre
--    un booleano, nunca null (un NULL explícito no cae al DEFAULT).
--
-- ⚠️ ORDEN DE DESPLIEGUE: esta migración → backend → frontend (git push).
--    El frontend nuevo lee aliados.convenio_alcaldia: sin la columna, Registro
--    y Configuración fallan al cargar las veterinarias.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.aliados
  ADD COLUMN IF NOT EXISTS convenio_alcaldia boolean NOT NULL DEFAULT false;

ALTER TABLE public.solicitudes_servicio
  ADD COLUMN IF NOT EXISTS es_alcaldia boolean;

ALTER TABLE public.servicios
  ADD COLUMN IF NOT EXISTS es_alcaldia boolean NOT NULL DEFAULT false;

ALTER TABLE public.reportes_grupales_items
  ADD COLUMN IF NOT EXISTS es_alcaldia  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS storage_path text;

-- Lectura de la nueva columna de aliados (el resto del GRANT de la 194 sigue igual).
GRANT SELECT (convenio_alcaldia) ON public.aliados TO authenticated;

-- Animal City es hoy la única con convenio.
UPDATE public.aliados
   SET convenio_alcaldia = true
 WHERE nombre ILIKE '%animal%city%';

COMMIT;

-- VERIFICAR (debe salir Animal City y solo ella):
--   SELECT id_aliado, nombre, activo, convenio_alcaldia FROM public.aliados WHERE convenio_alcaldia;
--
-- ROLLBACK:
--   ALTER TABLE public.reportes_grupales_items DROP COLUMN storage_path, DROP COLUMN es_alcaldia;
--   ALTER TABLE public.servicios DROP COLUMN es_alcaldia;
--   ALTER TABLE public.solicitudes_servicio DROP COLUMN es_alcaldia;
--   ALTER TABLE public.aliados DROP COLUMN convenio_alcaldia;
