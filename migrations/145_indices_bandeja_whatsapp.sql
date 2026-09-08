-- Ejecutar con autocommit: CREATE INDEX CONCURRENTLY no admite BEGIN/COMMIT.
-- Solo añade caminos de lectura. No cambia vistas, mensajes, RLS ni estados.
-- Conserva los índices previos, usados por otras consultas.
SET lock_timeout = '5s';
SET statement_timeout = '120s';

-- El último mensaje se ordena por fecha E id; el índice anterior solo por fecha.
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_wa_mensajes_ultimo_linea
  ON public.whatsapp_mensajes
  (phone_number_id, contacto, ocurrido_en DESC, id DESC);

-- Contar no leídos sin recorrer también mensajes salientes ni otra línea.
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_wa_mensajes_entrantes_linea
  ON public.whatsapp_mensajes (phone_number_id, contacto, ocurrido_en)
  WHERE direccion = 'IN';

RESET lock_timeout;
RESET statement_timeout;

-- Comprobar indisvalid/indisready después de ejecutar. Si una creación se
-- interrumpe, eliminar SOLO el índice inválido con DROP INDEX CONCURRENTLY
-- antes de reintentar; IF NOT EXISTS no repara índices inválidos.
