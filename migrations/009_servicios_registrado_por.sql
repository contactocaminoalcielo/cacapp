-- 009 — Quién registró cada servicio (ventas por usuario/rol)
-- Agrega servicios.registrado_por (FK → personal.id). Se llena al crear el
-- servicio desde Registro.jsx y desde la conversión de solicitudes en Kanban.jsx.
-- Servicios históricos quedan en NULL (no hay forma de saber quién los creó).
--
-- Aplicar en producción (VPS Contabo):
--   psql -U postgres -d <basedatos> -f 009_servicios_registrado_por.sql
--
-- Nota: es ALTER sobre una tabla existente → hereda los GRANTs/RLS de
-- `servicios`, no requiere GRANTs nuevos.

ALTER TABLE public.servicios
  ADD COLUMN IF NOT EXISTS registrado_por uuid REFERENCES public.personal(id);

CREATE INDEX IF NOT EXISTS servicios_registrado_por_idx
  ON public.servicios (registrado_por);

COMMENT ON COLUMN public.servicios.registrado_por
  IS 'Usuario (personal.id) que registró el servicio. NULL en servicios históricos previos a esta columna.';
