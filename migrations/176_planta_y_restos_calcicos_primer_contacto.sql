-- ============================================================================
-- 176 — Especie de la planta y restos cálcicos desde el PRIMER CONTACTO
-- Fecha: 2026-10-15 · Reporte Orbit (mejora, urgencia media-alta)
--
-- Hasta hoy la familia de Compets elegía la especie meses después, cuando se
-- cumplía el compostaje (migración 149). Coordinación pide tenerla desde el
-- portal de fotos ("solicitud de imágenes e información"), junto con la opción
-- de comprar los RESTOS CÁLCICOS de la mascota como adicional, para:
--   · no pasar por alto la entrega de los restos cuando se compraron,
--   · saber con meses de anticipación cuántas plantas de cada especie (y
--     materas) hay que comprar,
--   · dejar la solicitud de la familia completa desde el inicio.
--
-- Cómo encaja con lo que ya existe (una sola fila por servicio, la misma):
--   · El portal de fotos crea la fila de `planta_elecciones` en el estado
--     nuevo RESERVADA, con la especie ya puesta y SIN `fecha_cumplida` (todavía
--     no se sabe: la mascota ni ha entrado al cubículo).
--   · El job diario, al cumplirse el compostaje, la pasa a PENDIENTE y le pone
--     la fecha: el aviso de WhatsApp sigue saliendo, porque ese portal es el que
--     confirma la dirección de entrega de la planta (Compets sin recordatorios
--     no la pide antes) y vende la segunda planta. La especie ya no se pregunta.
--   · Los restos cálcicos van en la MISMA fila: salen del cubículo con la
--     planta y se entregan con ella.
--
-- El precio de los restos es configuración (`PLANTAS/restos_calcicos_precio`),
-- no código: NULL = no se ofrecen. Se fija en Configuración → Plantas. Regla
-- de oro de siempre: el navegador nunca manda el precio.
--
-- Ejecutar por SSH→psql en Contabo. Reversible: bloque de ROLLBACK al pie.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ─── Estado nuevo: RESERVADA ────────────────────────────────────────────────
-- El CHECK de la 149 se declaró en línea, sin nombre propio. Postgres lo llama
-- `planta_elecciones_estado_check`, pero se busca por su definición: si el
-- nombre fuera otro, un DROP IF EXISTS no haría nada y el CHECK viejo seguiría
-- rechazando RESERVADA en silencio.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.planta_elecciones'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%estado%ELEGIDA%'
  LOOP
    EXECUTE format('ALTER TABLE public.planta_elecciones DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE public.planta_elecciones ADD CONSTRAINT planta_elecciones_estado_check
  CHECK (estado IN ('RESERVADA','PENDIENTE','ENVIADO','ELEGIDA','ERROR','CANCELADA'));

-- Una RESERVADA todavía no tiene compostaje cumplido. Las demás siguen
-- obligadas a tenerla: sin ella la ventana del enlace no se puede contar.
ALTER TABLE public.planta_elecciones ALTER COLUMN fecha_cumplida DROP NOT NULL;
ALTER TABLE public.planta_elecciones DROP CONSTRAINT IF EXISTS planta_elecciones_fecha_cumplida_chk;
ALTER TABLE public.planta_elecciones ADD CONSTRAINT planta_elecciones_fecha_cumplida_chk
  CHECK (estado = 'RESERVADA' OR fecha_cumplida IS NOT NULL);

COMMENT ON COLUMN public.planta_elecciones.estado IS
  'RESERVADA = la familia eligió en el portal de fotos y el compostaje no se ha cumplido; el job la pasa a PENDIENTE al cumplirse.';

-- ─── Restos cálcicos ────────────────────────────────────────────────────────
ALTER TABLE public.planta_elecciones
  ADD COLUMN IF NOT EXISTS restos_calcicos       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS restos_calcicos_valor numeric CHECK (restos_calcicos_valor IS NULL OR restos_calcicos_valor >= 0),
  ADD COLUMN IF NOT EXISTS restos_calcicos_en    timestamptz;

COMMENT ON COLUMN public.planta_elecciones.restos_calcicos IS
  'La familia compró los restos cálcicos de su mascota. Se separan al sacar la mascota del cubículo y se entregan con la planta.';
COMMENT ON COLUMN public.planta_elecciones.restos_calcicos_valor IS
  'Snapshot de lo cobrado (sale de config PLANTAS/restos_calcicos_precio, nunca del navegador).';

-- ─── Precio (configuración) ─────────────────────────────────────────────────
INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
  -- $150.000 (David, 2026-10-15).
  ('PLANTAS', 'restos_calcicos_precio', '150000'::jsonb,
   'Precio de los restos cálcicos como adicional en el portal de fotos de Compets. NULL = no se ofrecen.')
ON CONFLICT (modulo, clave) DO NOTHING;

-- ─── Vista del tablero: + restos y estado del servicio ──────────────────────
-- Las columnas nuevas van AL FINAL: CREATE OR REPLACE VIEW no deja reordenar.
-- `servicio_estado` deja contar lo que falta por comprar (lo no entregado).
CREATE OR REPLACE VIEW public.v_plantas_pendientes AS
SELECT pe.id                AS eleccion_id,
       pe.servicio_id,
       pe.estado,
       pe.codigo,
       pe.enlace,
       pe.fecha_cumplida,
       pe.fecha_envio,
       pe.fecha_eleccion,
       pe.planta_nombre,
       pe.error,
       m.nombre             AS mascota,
       TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario,
       c.whatsapp,
       cu.codigo            AS cubiculo,
       COALESCE(ad.extras, 0)      AS extras_comprados,
       COALESCE(ad.valor_extras, 0) AS valor_extras,
       pe.restos_calcicos,
       pe.restos_calcicos_valor,
       s.estado             AS servicio_estado
FROM public.planta_elecciones pe
JOIN public.servicios s        ON s.id = pe.servicio_id
JOIN public.mascotas m         ON m.id_mascota = s.mascota_id
LEFT JOIN public.clientes c    ON c.id_cliente = m.cliente_id
LEFT JOIN public.lotes_tenjo_items i ON i.id = pe.lote_item_id
LEFT JOIN public.cubiculos cu  ON cu.id = i.cubiculo_id
LEFT JOIN LATERAL (
  SELECT count(*) AS extras, sum(total) AS valor_extras
  FROM public.planta_adicionales pa WHERE pa.eleccion_id = pe.id
) ad ON true
WHERE s.estado <> 'CANCELADO';

ALTER VIEW public.v_plantas_pendientes SET (security_invoker = true);
GRANT SELECT ON public.v_plantas_pendientes TO authenticated, service_role, orbit_backend;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICAR:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.planta_elecciones'::regclass AND contype = 'c';
--   SELECT * FROM public.config_operativa WHERE modulo='PLANTAS' AND clave='restos_calcicos_precio';
--   SELECT restos_calcicos, servicio_estado FROM public.v_plantas_pendientes LIMIT 1;
--
-- ROLLBACK (solo si no hay filas RESERVADA ni restos vendidos):
--   BEGIN;
--     -- (recrear v_plantas_pendientes con la definición de la 149)
--     ALTER TABLE public.planta_elecciones DROP CONSTRAINT IF EXISTS planta_elecciones_fecha_cumplida_chk;
--     ALTER TABLE public.planta_elecciones ALTER COLUMN fecha_cumplida SET NOT NULL;
--     ALTER TABLE public.planta_elecciones DROP CONSTRAINT IF EXISTS planta_elecciones_estado_check;
--     ALTER TABLE public.planta_elecciones ADD CONSTRAINT planta_elecciones_estado_check
--       CHECK (estado IN ('PENDIENTE','ENVIADO','ELEGIDA','ERROR','CANCELADA'));
--     ALTER TABLE public.planta_elecciones DROP COLUMN IF EXISTS restos_calcicos,
--       DROP COLUMN IF EXISTS restos_calcicos_valor, DROP COLUMN IF EXISTS restos_calcicos_en;
--     DELETE FROM public.config_operativa WHERE modulo='PLANTAS' AND clave='restos_calcicos_precio';
--   COMMIT;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================
