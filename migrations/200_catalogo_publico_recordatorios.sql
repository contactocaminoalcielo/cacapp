-- ════════════════════════════════════════════════════════════════════════════
-- 200 — Catálogo público de recordatorios: compra SIN servicio funerario desde un
--       enlace único (/#/catalogo) — reporte de operación del 22-oct-2026
-- ════════════════════════════════════════════════════════════════════════════
-- El cliente que no hizo el servicio con nosotros ve el catálogo, escoge, sube
-- las fotos que pide cada producto, deja sus datos y la entrega, y la compra cae
-- en el módulo Compras de recordatorios (migr. 168) y en su sección del Tablero
-- de Producción (migr. 170) como «Compra de recordatorio – Cliente sin servicio
-- funerario».
--
-- Decisiones de David (22-oct):
--   · Cada producto tiene «Mostrar en catálogo público» y un precio público
--     opcional; vacío = el precio de siempre (precio_base). Así el catálogo no
--     cambia lo que cobra el Registro, donde varios son precio de adicional.
--   · Envío: UN valor fijo (config_operativa CATALOGO_PUBLICO.valor_envio), solo
--     si el pedido trae algo físico.
--   · Pago: el cliente sube el comprobante o escoge «pagar después». Lo que sube
--     NO es un pago: queda en `pago_cliente` y coordinación lo registra como pago
--     de verdad (el trigger de la 168 suma TODO lo que haya en pagos).
--   · Producción la ve de inmediato.
--
-- Fotos sin sesión: el enlace pide un BORRADOR al backend y solo puede subir a
-- fotos-clientes/compra-web/<borrador>/…, mientras el borrador esté vivo
-- (3 horas) y sin usar, con tope de archivos. Misma idea que
-- portal_puede_subir_foto (migr. 187) para el portal de fotos.
--
-- ⚠️ ORDEN: esta migración → backend → frontend (git push).

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ─── Catálogo ───────────────────────────────────────────────────────────────
ALTER TABLE public.recordatorios
  ADD COLUMN IF NOT EXISTS venta_publica  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS precio_publico numeric CHECK (precio_publico IS NULL OR precio_publico >= 0);

-- ─── Compra: de dónde vino, envío, entrega y lo que declaró el cliente ─────
ALTER TABLE public.compras_recordatorios
  ADD COLUMN IF NOT EXISTS origen       text    NOT NULL DEFAULT 'INTERNO',
  ADD COLUMN IF NOT EXISTS valor_envio  numeric NOT NULL DEFAULT 0 CHECK (valor_envio >= 0),
  ADD COLUMN IF NOT EXISTS entrega      jsonb,
  ADD COLUMN IF NOT EXISTS pago_cliente jsonb;

ALTER TABLE public.compras_recordatorios DROP CONSTRAINT IF EXISTS compras_rec_origen_check;
ALTER TABLE public.compras_recordatorios
  ADD CONSTRAINT compras_rec_origen_check CHECK (origen IN ('INTERNO', 'CATALOGO_WEB'));

-- ─── Borradores del enlace (solo el backend los toca) ───────────────────────
CREATE TABLE IF NOT EXISTS public.compra_web_borradores (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  expira_en  timestamptz NOT NULL DEFAULT now() + interval '3 hours',
  usado_en   timestamptz,
  ip         inet
);
ALTER TABLE public.compra_web_borradores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.compra_web_borradores FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.compra_web_borradores TO orbit_backend;
CREATE INDEX IF NOT EXISTS idx_compra_web_borradores_expira ON public.compra_web_borradores (expira_en);

-- ¿Puede el enlace subir a esta carpeta? Borrador vivo, sin usar, y menos de
-- 120 archivos (un Photobook pide 29 fotos; tope holgado pero finito).
CREATE OR REPLACE FUNCTION public.portal_compra_web_abierta(p_borrador text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.compra_web_borradores b
     WHERE b.id::text = p_borrador
       AND b.usado_en IS NULL
       AND b.expira_en > now())
  AND (SELECT count(*) FROM storage.objects o
        WHERE o.bucket_id = 'fotos-clientes'
          AND o.name LIKE 'compra-web/' || p_borrador || '/%') < 120
$$;
REVOKE ALL ON FUNCTION public.portal_compra_web_abierta(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_compra_web_abierta(text) TO anon, authenticated, service_role;

-- Las dos políticas de anon en fotos-clientes (187 y 190) + la carpeta del catálogo.
DROP POLICY IF EXISTS "anon_insert_fotos_clientes" ON storage.objects;
CREATE POLICY "anon_insert_fotos_clientes" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'fotos-clientes'
    AND (
      public.portal_puede_subir_foto((string_to_array(name, '/'))[1])
      OR ((string_to_array(name, '/'))[1] = 'compra-web'
          AND public.portal_compra_web_abierta((string_to_array(name, '/'))[2]))
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
    )
  );

-- ─── Autorización de datos: origen nuevo ────────────────────────────────────
ALTER TABLE public.autorizaciones_datos DROP CONSTRAINT IF EXISTS autorizaciones_datos_origen_check;
ALTER TABLE public.autorizaciones_datos ADD CONSTRAINT autorizaciones_datos_origen_check
  CHECK (origen = ANY (ARRAY['SOLICITUD_CLIENTE','SOLICITUD_ALIADO','AFILIACION_ALIADO','PORTAL_FOTOS',
    'PORTAL_PLANTA','PORTAL_VISITA','REGISTRO_INTERNO','REVOCACION','COMPRA_RECORDATORIOS',
    'CATALOGO_RECORDATORIOS']));

-- ─── Configuración del catálogo ─────────────────────────────────────────────
INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
  ('CATALOGO_PUBLICO', 'activo',      'true'::jsonb, 'El enlace /#/catalogo recibe pedidos'),
  ('CATALOGO_PUBLICO', 'valor_envio', '0'::jsonb,    'Valor fijo del envío cuando el pedido trae algo físico'),
  ('CATALOGO_PUBLICO', 'datos_pago',  '""'::jsonb,   'Cómo pagar (Nequi, cuenta…): se le muestra al cliente al final')
ON CONFLICT (modulo, clave) DO NOTHING;

COMMIT;

-- VERIFICAR:
--   SELECT count(*) FILTER (WHERE venta_publica) FROM public.recordatorios;          -- 0 hasta que se prendan
--   SELECT clave, valor FROM public.config_operativa WHERE modulo = 'CATALOGO_PUBLICO';
--   SELECT policyname FROM pg_policies WHERE schemaname='storage' AND policyname LIKE 'anon_%fotos_clientes';
--
-- ROLLBACK:
--   políticas: volver a las de la 187 (INSERT) y 190 (SELECT), sin la rama compra-web
--   DROP FUNCTION public.portal_compra_web_abierta(text); DROP TABLE public.compra_web_borradores;
--   ALTER TABLE public.compras_recordatorios DROP CONSTRAINT compras_rec_origen_check,
--     DROP COLUMN origen, DROP COLUMN valor_envio, DROP COLUMN entrega, DROP COLUMN pago_cliente;
--   ALTER TABLE public.recordatorios DROP COLUMN venta_publica, DROP COLUMN precio_publico;
--   autorizaciones_datos_origen_check sin 'CATALOGO_RECORDATORIOS'
--   DELETE FROM public.config_operativa WHERE modulo = 'CATALOGO_PUBLICO';
