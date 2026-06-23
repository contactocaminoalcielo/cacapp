-- ============================================================================
-- 008 — Flujo asistido de solicitud de imágenes al cliente
-- Fecha: 2026-06-19
--
-- Frase rectora: "ORBIT prepara los contactos; una persona valida y autoriza el
-- envío. El cliente solo aporta información e imágenes. Ningún contacto debe
-- duplicarse, ninguna carga incompleta debe pasar a Producción y ninguna
-- solicitud de adicional debe convertirse en compra sin validación humana."
--
-- Decisiones aprobadas por David (2026-06-19):
--   - Fecha base: servicios.fecha_ingreso ("día siguiente" = fecha_ingreso < hoy);
--     recuperación de vencidos no se limita a "ayer".
--   - Planes excluidos: ANGEL, DESAMPARADO (por planes.codigo), salvo adicional
--     confirmado que requiere imagen → solo_adicional = true.
--   - Canal: Zolutium/GHL con plantilla HSM. Plantilla aún NO existe → el flujo
--     queda en POR_VALIDAR; el envío real se activa con usar_plantilla=true.
--   - Línea por defecto: +573159891247.
--
-- NOTA DESPLIEGUE: migración MANUAL por SSH→psql en Contabo (Supabase Cloud está
-- muerto). Aditiva y reversible. `solicitudes_imagenes` ya existía (era per-ítem
-- y casi sin datos): se evoluciona a "una solicitud por servicio (contacto)".
-- orbit_backend (BYPASSRLS) ya tiene DML por ALTER DEFAULT PRIVILEGES (migr. 004).
-- ============================================================================

-- ─── 0. Generador de código seguro, único e impredecible ────────────────────
-- Usa el CSPRNG de gen_random_uuid() (no random()), hex en mayúsculas (12 chars).
-- Reintenta si choca con un codigo_fotos ya existente en servicios.
CREATE OR REPLACE FUNCTION public.fn_gen_codigo_fotos()
RETURNS text LANGUAGE plpgsql AS $func$
DECLARE cod text;
BEGIN
  LOOP
    cod := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.servicios WHERE codigo_fotos = cod);
  END LOOP;
  RETURN cod;
END;
$func$;

-- ─── 1. Columnas de evidencia/operación en solicitudes_imagenes ─────────────
ALTER TABLE public.solicitudes_imagenes
  ADD COLUMN IF NOT EXISTS codigo           text,
  ADD COLUMN IF NOT EXISTS enlace           text,
  ADD COLUMN IF NOT EXISTS whatsapp_destino text,
  ADD COLUMN IF NOT EXISTS linea_wa         text,
  ADD COLUMN IF NOT EXISTS fecha_programada date,
  ADD COLUMN IF NOT EXISTS fecha_envio      timestamptz,
  ADD COLUMN IF NOT EXISTS message_id       text,
  ADD COLUMN IF NOT EXISTS contact_id       text,
  ADD COLUMN IF NOT EXISTS intentos         int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultimo_error     text,
  ADD COLUMN IF NOT EXISTS autorizado_por   uuid REFERENCES public.personal(id),
  ADD COLUMN IF NOT EXISTS solo_adicional   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at       timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz DEFAULT now();

DROP TRIGGER IF EXISTS trg_solicitudes_imagenes_updated ON public.solicitudes_imagenes;
CREATE TRIGGER trg_solicitudes_imagenes_updated
  BEFORE UPDATE ON public.solicitudes_imagenes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 2. Estados nuevos (migrando los heredados) ─────────────────────────────
-- Heredados: PENDIENTE/ENVIADA/RECIBIDA/SIN_RESPUESTA → nuevos.
ALTER TABLE public.solicitudes_imagenes DROP CONSTRAINT IF EXISTS solicitudes_imagenes_estado_check;

UPDATE public.solicitudes_imagenes SET estado = CASE estado
  WHEN 'PENDIENTE'     THEN 'POR_VALIDAR'
  WHEN 'ENVIADA'       THEN 'ENVIADO'
  WHEN 'SIN_RESPUESTA' THEN 'ENVIADO'
  WHEN 'RECIBIDA'      THEN 'RECIBIDO'
  ELSE estado
END
WHERE estado IN ('PENDIENTE','ENVIADA','SIN_RESPUESTA','RECIBIDA');

ALTER TABLE public.solicitudes_imagenes
  ALTER COLUMN estado SET DEFAULT 'POR_VALIDAR';

ALTER TABLE public.solicitudes_imagenes
  ADD CONSTRAINT solicitudes_imagenes_estado_check
  CHECK (estado IN ('POR_VALIDAR','ENVIADO','RECIBIDO','ERROR','CANCELADO'));

-- ─── 3. Una sola solicitud ACTIVA por servicio (anti-duplicado) ─────────────
-- Antes de crear el índice, colapsar duplicados activos heredados (datos stale):
-- conservar la fila más reciente por servicio y cancelar las demás.
WITH activos AS (
  SELECT id, servicio_id,
         row_number() OVER (PARTITION BY servicio_id
                            ORDER BY COALESCE(created_at, fecha_solicitud, now()) DESC, id DESC) AS rn
  FROM public.solicitudes_imagenes
  WHERE estado IN ('POR_VALIDAR','ENVIADO','ERROR') AND servicio_id IS NOT NULL
)
UPDATE public.solicitudes_imagenes s
SET estado = 'CANCELADO'
FROM activos a
WHERE s.id = a.id AND a.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_solicitud_imagenes_servicio_activa
  ON public.solicitudes_imagenes (servicio_id)
  WHERE estado IN ('POR_VALIDAR','ENVIADO','ERROR');

CREATE INDEX IF NOT EXISTS idx_solicitud_imagenes_estado
  ON public.solicitudes_imagenes (estado);

-- ─── 4. GRANTs + RLS (compatibilidad transitoria con PostgREST) ─────────────
GRANT ALL ON TABLE public.solicitudes_imagenes TO postgres, anon, authenticated, service_role;
ALTER TABLE public.solicitudes_imagenes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_full" ON public.solicitudes_imagenes;
CREATE POLICY "auth_full" ON public.solicitudes_imagenes FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- anon NO accede a esta tabla (la bandeja es interna). El portal escribe vía backend.

-- ─── 5. Seeds de configuración (no pisa valores ya editados) ────────────────
INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
 ('SOLICITUDES_IMAGENES','fecha_base','"fecha_ingreso"','Columna ancla: el servicio entra al flujo el día siguiente a fecha_ingreso'),
 ('SOLICITUDES_IMAGENES','planes_excluidos','["ANGEL","DESAMPARADO"]','Códigos de plan que NO solicitan imágenes (salvo adicional que requiera imagen)'),
 ('SOLICITUDES_IMAGENES','estados_elegibles','["EN_CUARTO_FRIO"]','Estados del servicio en los que el portal acepta cargas y se puede solicitar'),
 ('SOLICITUDES_IMAGENES','linea_default','"+573159891247"','Línea WhatsApp Zolutium por defecto para los envíos'),
 ('SOLICITUDES_IMAGENES','recuperar_vencidos','true','Recuperar contactos elegibles no procesados de días anteriores'),
 ('SOLICITUDES_IMAGENES','max_mb','8','Tamaño máximo por imagen (MB) aceptado en el portal'),
 ('SOLICITUDES_IMAGENES','mimes_permitidos','["image/jpeg","image/png","image/webp","image/heic","image/heif"]','Tipos MIME de imagen autorizados'),
 ('SOLICITUDES_IMAGENES','usar_plantilla','false','Enviar como plantilla HSM aprobada (true cuando Meta apruebe la plantilla)'),
 ('SOLICITUDES_IMAGENES','plantilla_nombre','"solicitud_imagenes_cliente"','Nombre exacto de la plantilla aprobada en Zolutium/GHL'),
 ('SOLICITUDES_IMAGENES','plantilla_idioma','"es_MX"','Código de idioma de la plantilla')
ON CONFLICT (modulo, clave) DO NOTHING;

-- ============================================================================
-- ROLLBACK:
--   DELETE FROM public.config_operativa WHERE modulo = 'SOLICITUDES_IMAGENES';
--   DROP INDEX IF EXISTS public.uq_solicitud_imagenes_servicio_activa;
--   DROP INDEX IF EXISTS public.idx_solicitud_imagenes_estado;
--   ALTER TABLE public.solicitudes_imagenes DROP CONSTRAINT IF EXISTS solicitudes_imagenes_estado_check;
--   -- (las columnas añadidas pueden conservarse; si se desea revertir:)
--   -- ALTER TABLE public.solicitudes_imagenes DROP COLUMN IF EXISTS codigo, ... ;
--   DROP TRIGGER IF EXISTS trg_solicitudes_imagenes_updated ON public.solicitudes_imagenes;
--   DROP FUNCTION IF EXISTS public.fn_gen_codigo_fotos();
-- ============================================================================
