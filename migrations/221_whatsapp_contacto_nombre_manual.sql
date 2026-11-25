-- 221 · Nombre que le pone coordinación a un contacto de WhatsApp
--
-- REPORTE ORBIT (25-nov, urgencia alta): desde la bandeja no se podía iniciar
-- un chat con un número que todavía no tuviera conversación, ni ponerle nombre.
--
-- La conversación en sí NO necesita tabla nueva: el trigger
-- `fn_wa_touch_contacto` crea la fila de `whatsapp_contactos` en cuanto se
-- guarda el primer mensaje, y enviar una plantilla ya lo guarda. Lo que no
-- había era dónde dejar el NOMBRE:
--  · `nombre_perfil` NO sirve: es el nombre de perfil de WhatsApp y el webhook
--    lo pisa cada vez que la persona escribe (whatsapp-cloud-webhook.js).
--  · Por eso una columna aparte, con quién y cuándo, que nada automático toca.
--
-- PRIORIDAD del nombre que se ve en la bandeja (v_whatsapp_conversaciones.nombre):
--   veterinaria registrada  >  cliente registrado  >  nombre_manual  >  perfil de WhatsApp
-- Lo que Orbit ya sabe de ese teléfono manda; el nombre a mano es para quien
-- todavía no está en Orbit (un propietario antes de registrar el servicio).
--
-- La vista se REEMPLAZA (no se borra): mismas columnas en el mismo orden, solo
-- cambia la expresión de `nombre` y se añade `nombre_manual` al final. Nadie
-- más depende de ella (verificado en pg_depend el 25-nov).

BEGIN;

ALTER TABLE public.whatsapp_contactos
  ADD COLUMN IF NOT EXISTS nombre_manual     text,
  ADD COLUMN IF NOT EXISTS nombre_manual_por uuid REFERENCES public.personal(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS nombre_manual_en  timestamptz;

ALTER TABLE public.whatsapp_contactos
  DROP CONSTRAINT IF EXISTS whatsapp_contactos_nombre_manual_chk;
ALTER TABLE public.whatsapp_contactos
  ADD CONSTRAINT whatsapp_contactos_nombre_manual_chk
  CHECK (nombre_manual IS NULL OR char_length(btrim(nombre_manual)) BETWEEN 1 AND 120);

COMMENT ON COLUMN public.whatsapp_contactos.nombre_manual IS
  'Nombre que coordinación le puso al contacto desde la bandeja (migr. 221). El webhook NO lo toca; nombre_perfil sí.';

CREATE OR REPLACE VIEW public.v_whatsapp_conversaciones
WITH (security_invoker = true) AS
 SELECT c.contacto,
    c.phone_number_id,
    c.nombre_perfil,
    c.ultimo_mensaje_en,
    c.ultimo_entrante_en,
    c.ultimo_leido_en,
    a.id_aliado AS aliado_id,
    a.nombre AS aliado_nombre,
    cl.id_cliente AS cliente_id,
    TRIM(BOTH FROM concat_ws(' '::text, cl.nombre, cl.apellido)) AS cliente_nombre,
    COALESCE(
      a.nombre,
      NULLIF(TRIM(BOTH FROM concat_ws(' '::text, cl.nombre, cl.apellido)), ''::text)::character varying,
      NULLIF(btrim(c.nombre_manual), ''::text)::character varying,
      c.nombre_perfil::character varying
    ) AS nombre,
        CASE
            WHEN a.id_aliado IS NOT NULL THEN 'ALIADO'::text
            WHEN cl.id_cliente IS NOT NULL THEN 'CLIENTE'::text
            ELSE 'DESCONOCIDO'::text
        END AS tipo_contacto,
    c.ultimo_entrante_en IS NOT NULL AND c.ultimo_entrante_en > (now() - '24:00:00'::interval) AS ventana_abierta,
    c.ultimo_entrante_en + '24:00:00'::interval AS ventana_hasta,
    ( SELECT m.texto
           FROM whatsapp_mensajes m
          WHERE m.contacto = c.contacto AND m.phone_number_id = c.phone_number_id
          ORDER BY m.ocurrido_en DESC, m.id DESC
         LIMIT 1) AS ultimo_texto,
    ( SELECT m.direccion
           FROM whatsapp_mensajes m
          WHERE m.contacto = c.contacto AND m.phone_number_id = c.phone_number_id
          ORDER BY m.ocurrido_en DESC, m.id DESC
         LIMIT 1) AS ultima_direccion,
    ( SELECT count(*) AS count
           FROM whatsapp_mensajes m
          WHERE m.contacto = c.contacto AND m.phone_number_id = c.phone_number_id AND m.direccion = 'IN'::text AND (c.ultimo_leido_en IS NULL OR m.ocurrido_en > c.ultimo_leido_en)) AS sin_leer,
    c.nombre_manual
   FROM whatsapp_contactos c
     LEFT JOIN LATERAL ( SELECT x.id_aliado,
            x.nombre
           FROM aliados x
          WHERE wa_tel10(x.whatsapp::text) = wa_tel10(c.contacto) OR wa_tel10(x.telefono::text) = wa_tel10(c.contacto)
          ORDER BY x.activo DESC NULLS LAST, x.nombre
         LIMIT 1) a ON true
     LEFT JOIN LATERAL ( SELECT x.id_cliente,
            x.nombre,
            x.apellido
           FROM clientes x
          WHERE wa_tel10(x.whatsapp::text) = wa_tel10(c.contacto) OR wa_tel10(x.telefono::text) = wa_tel10(c.contacto)
          ORDER BY x.id_cliente
         LIMIT 1) cl ON true;

COMMIT;
