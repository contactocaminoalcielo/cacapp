-- ─────────────────────────────────────────────────────────────────────────────
-- Bitácora de producción: quién marcó cada cambio de estado de un recordatorio
-- ─────────────────────────────────────────────────────────────────────────────
-- Objetivo (David, 2026-07-07): saber QUIÉN marca cada recordatorio en cada uno
-- de sus estados (PENDIENTE → EN_PROCESO → LISTO …) y a quién quedó asignado
-- (quién lo realiza). Se registra por trigger para capturar TODOS los caminos:
-- el tablero de Producción, la recogida del técnico (ítems recolecta_tecnico que
-- pasan solos a EN_PROCESO) y cualquier código futuro que toque el estado.
--
-- La bitácora se muestra SOLO a ADMIN/COORDINADOR (gate en el frontend, igual que
-- el resto del sistema; la RLS uniforme `auth_full` se mantiene por consistencia).
--
-- Notas de esquema (trampas reales de esta DB):
--   · mascotas.PK = id_mascota  (NO id)  → join servicios.mascota_id = m.id_mascota
--   · personal.PK = id (uuid), personal.auth_user_id = auth.uid()
--   · servicio_recordatorios.id / servicio_id son uuid; recordatorios.id catálogo
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.produccion_recordatorio_log (
  id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  servicio_recordatorio_id  uuid NOT NULL,
  servicio_id               uuid,
  -- Denormalizado a propósito: la bitácora es un histórico inmutable y debe
  -- leerse aunque la fila de origen cambie de nombre, se reasigne o se remueva.
  recordatorio_nombre       text,
  mascota_nombre            text,
  estado_anterior           text,        -- NULL en el alta de la fila
  estado_nuevo              text NOT NULL,
  asignado_a                uuid,        -- personal a quien está asignado (quién lo realiza)
  asignado_nombre           text,
  cambiado_por              uuid,        -- personal.id que hizo el cambio (según auth.uid())
  cambiado_por_nombre       text,
  cambiado_por_auth         uuid,        -- auth.uid() crudo (fallback si no mapea a personal)
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_prod_log_created   ON public.produccion_recordatorio_log (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_prod_log_servicio  ON public.produccion_recordatorio_log (servicio_id);

-- ── Función trigger ──────────────────────────────────────────────────────────
-- SECURITY DEFINER: puede resolver nombres e insertar el log aunque el actor sea
-- un técnico con permisos acotados. search_path fijo por seguridad.
CREATE OR REPLACE FUNCTION public.log_recordatorio_estado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth            uuid := auth.uid();
  v_personal_id     uuid;
  v_personal_nombre text;
  v_rec_nombre      text;
  v_mascota_nombre  text;
  v_asig_nombre     text;
BEGIN
  -- Solo interesa el cambio de estado (o el alta de la fila). Reasignar máquina,
  -- notas o persona sin tocar el estado no genera ruido en la bitácora.
  IF tg_op = 'UPDATE' AND NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;

  SELECT id, NULLIF(TRIM(COALESCE(nombre,'') || ' ' || COALESCE(apellido,'')), '')
    INTO v_personal_id, v_personal_nombre
    FROM public.personal
    WHERE auth_user_id = v_auth
    LIMIT 1;

  SELECT nombre INTO v_rec_nombre
    FROM public.recordatorios
    WHERE id = NEW.recordatorio_id;

  SELECT m.nombre INTO v_mascota_nombre
    FROM public.servicios s
    JOIN public.mascotas m ON m.id_mascota = s.mascota_id
    WHERE s.id = NEW.servicio_id;

  IF NEW.asignado_a IS NOT NULL THEN
    SELECT NULLIF(TRIM(COALESCE(nombre,'') || ' ' || COALESCE(apellido,'')), '')
      INTO v_asig_nombre
      FROM public.personal
      WHERE id = NEW.asignado_a;
  END IF;

  INSERT INTO public.produccion_recordatorio_log (
    servicio_recordatorio_id, servicio_id, recordatorio_nombre, mascota_nombre,
    estado_anterior, estado_nuevo, asignado_a, asignado_nombre,
    cambiado_por, cambiado_por_nombre, cambiado_por_auth
  ) VALUES (
    NEW.id, NEW.servicio_id, v_rec_nombre, v_mascota_nombre,
    CASE WHEN tg_op = 'UPDATE' THEN OLD.estado ELSE NULL END, NEW.estado,
    NEW.asignado_a, v_asig_nombre,
    v_personal_id, v_personal_nombre, v_auth
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_recordatorio_estado ON public.servicio_recordatorios;
CREATE TRIGGER trg_log_recordatorio_estado
  AFTER INSERT OR UPDATE OF estado ON public.servicio_recordatorios
  FOR EACH ROW EXECUTE FUNCTION public.log_recordatorio_estado();

-- ── RLS + GRANTs (patrón de tablas creadas con SQL raw) ──────────────────────
ALTER TABLE public.produccion_recordatorio_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_full" ON public.produccion_recordatorio_log;
CREATE POLICY "auth_full" ON public.produccion_recordatorio_log
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Lectura desde el cliente (la escritura la hace el trigger como definer).
GRANT SELECT ON public.produccion_recordatorio_log TO authenticated;
