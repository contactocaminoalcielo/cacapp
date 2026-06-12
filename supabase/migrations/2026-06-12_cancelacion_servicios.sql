-- Cancelación formal de servicios — trazabilidad mínima
-- El estado CANCELADO ya existe; estas columnas guardan quién/cuándo/por qué.
-- Aplicar por SSH en Contabo:
--   cd /opt/supabase/docker && docker compose exec db psql -U postgres -d postgres --pset pager=off -f - < este_archivo
-- (o pegar el ALTER TABLE en un -c "...")

ALTER TABLE public.servicios
  ADD COLUMN IF NOT EXISTS cancelado_en            timestamptz,
  ADD COLUMN IF NOT EXISTS cancelado_por           uuid REFERENCES public.personal(id),
  ADD COLUMN IF NOT EXISTS motivo_cancelacion      text,
  ADD COLUMN IF NOT EXISTS observacion_cancelacion text,
  ADD COLUMN IF NOT EXISTS etapa_cancelacion       text;

-- Verificación (opcional): el check de estado debe aceptar CANCELADO.
-- Ya hay servicios CANCELADO históricos en la DB, así que debe pasar:
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'public.servicios'::regclass AND contype = 'c';
