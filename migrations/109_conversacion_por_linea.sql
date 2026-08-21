-- 109 — Una conversación es (LÍNEA, NÚMERO), no solo el número.
--
-- 🩸 EL PROBLEMA, Y YA ESTÁ VIVO. Hasta hoy la identidad de una conversación
-- era el número del cliente y nada más: `whatsapp_contactos` tenía una fila por
-- número, con UNA columna de línea que se sobrescribía con la última que
-- escribiera. Comprobado antes de tocar nada:
--
--     contacto 573132666356 · 2 líneas · 25 mensajes  ← en un solo hilo
--
-- Con una línea daba igual. Con dos, cuatro cosas se rompen y ninguna avisa:
--
--   1. LA RESPUESTA SALE POR LA LÍNEA EQUIVOCADA. El envío usa la línea de la
--      conversación, que era "la última que escribió". Es exactamente el bug
--      que ya costó el 6,9 % de los envíos en la época de GHL.
--   2. LA VENTANA DE 24 HORAS SE COMPARTE. Escriben a la línea A y el sistema
--      cree que puede escribir libremente por la B; Meta lo rechaza.
--   3. EL AGENTE LEE EL CONTEXTO DE LA OTRA LÍNEA. Elige su cerebro por
--      `phone_number_id` pero recibía el historial mezclado. Con la empresa
--      hermana, un agente leería conversaciones que no son suyas. Es el peor.
--   4. Etiquetas, seguimientos y campañas, compartidos entre líneas.
--
-- Nada de esto se arregla filtrando la bandeja: el hilo ya está fusionado
-- debajo. Hay que cambiar la clave.
--
-- ✅ NO SE PIERDE NADA AL SEPARAR: cada mensaje SIEMPRE guardó su
-- `phone_number_id`. El hilo mezclado se puede repartir con exactitud.

BEGIN;

-- ── 1. whatsapp_contactos: una fila por (línea, número) ───────────────────

-- La clave ajena de las etiquetas apunta a la clave vieja, así que hay que
-- soltarla antes y volver a atarla al final, ya sobre la clave compuesta.
ALTER TABLE public.whatsapp_conversacion_etiquetas
  DROP CONSTRAINT whatsapp_conversacion_etiquetas_contacto_fkey;

ALTER TABLE public.whatsapp_contactos DROP CONSTRAINT whatsapp_contactos_pkey;

-- Las filas que faltan: cada (línea, número) que aparezca en los mensajes y
-- que todavía no tenga su propia fila. Heredan lo que era del número —nombre
-- de perfil, si el agente está encendido— porque es lo mismo en las dos.
INSERT INTO public.whatsapp_contactos
      (contacto, phone_number_id, nombre_perfil, ultimo_mensaje_en, ultimo_entrante_en,
       ultimo_leido_en, created_at, agente_activo, agente_cambiado_por, agente_cambiado_en)
SELECT m.contacto, m.phone_number_id, c.nombre_perfil,
       max(m.ocurrido_en),
       max(m.ocurrido_en) FILTER (WHERE m.direccion = 'IN'),
       c.ultimo_leido_en, COALESCE(min(c.created_at), now()),
       COALESCE(bool_or(c.agente_activo), true), c.agente_cambiado_por, c.agente_cambiado_en
  FROM public.whatsapp_mensajes m
  LEFT JOIN public.whatsapp_contactos c ON c.contacto = m.contacto
 WHERE m.phone_number_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.whatsapp_contactos c2
      WHERE c2.contacto = m.contacto AND c2.phone_number_id = m.phone_number_id)
 GROUP BY m.contacto, m.phone_number_id, c.nombre_perfil, c.ultimo_leido_en,
          c.agente_cambiado_por, c.agente_cambiado_en;

-- Filas sin línea (las hay: la columna era opcional). Se les pone aquella por
-- la que más se ha hablado con ese número.
UPDATE public.whatsapp_contactos c SET phone_number_id = (
  SELECT m.phone_number_id
    FROM public.whatsapp_mensajes m
   WHERE m.contacto = c.contacto AND m.phone_number_id IS NOT NULL
   GROUP BY m.phone_number_id ORDER BY count(*) DESC LIMIT 1)
WHERE c.phone_number_id IS NULL;

-- Un contacto sin una sola línea no se puede atender: no hay por dónde
-- responderle. Se borra la fila, no el historial (que vive en los mensajes).
DELETE FROM public.whatsapp_contactos WHERE phone_number_id IS NULL;

-- 🩸 LOS RELOJES SE RECALCULAN POR LÍNEA. Los de ahora son la mezcla de las dos
-- —el último entrante de A contaminando la ventana de 24 h de B— que es justo
-- lo que se está deshaciendo. Recalcularlos es parte del arreglo, no un extra.
UPDATE public.whatsapp_contactos c
   SET ultimo_mensaje_en  = s.ultimo,
       ultimo_entrante_en = s.entrante
  FROM (SELECT contacto, phone_number_id,
               max(ocurrido_en)                                  AS ultimo,
               max(ocurrido_en) FILTER (WHERE direccion = 'IN')  AS entrante
          FROM public.whatsapp_mensajes
         WHERE phone_number_id IS NOT NULL
         GROUP BY 1, 2) s
 WHERE s.contacto = c.contacto AND s.phone_number_id = c.phone_number_id;

ALTER TABLE public.whatsapp_contactos ALTER COLUMN phone_number_id SET NOT NULL;
ALTER TABLE public.whatsapp_contactos ADD PRIMARY KEY (phone_number_id, contacto);

-- El listado de la bandeja ordena por actividad; sin esto haría un recorrido
-- completo en cuanto haya volumen.
CREATE INDEX IF NOT EXISTS ix_wa_contactos_actividad
  ON public.whatsapp_contactos (phone_number_id, ultimo_mensaje_en DESC);

-- ── 2. Etiquetas: también por línea ───────────────────────────────────────
-- La misma clínica puede estar en "Comercial" en una línea y en "Novedades" en
-- otra. Compartir la etiqueta hace que las listas de trabajo se contradigan.

ALTER TABLE public.whatsapp_conversacion_etiquetas
  ADD COLUMN IF NOT EXISTS phone_number_id text;

UPDATE public.whatsapp_conversacion_etiquetas e SET phone_number_id = (
  SELECT m.phone_number_id
    FROM public.whatsapp_mensajes m
   WHERE m.contacto = e.contacto AND m.phone_number_id IS NOT NULL
   GROUP BY m.phone_number_id ORDER BY count(*) DESC LIMIT 1)
WHERE e.phone_number_id IS NULL;

DELETE FROM public.whatsapp_conversacion_etiquetas WHERE phone_number_id IS NULL;

ALTER TABLE public.whatsapp_conversacion_etiquetas
  ALTER COLUMN phone_number_id SET NOT NULL;
ALTER TABLE public.whatsapp_conversacion_etiquetas
  DROP CONSTRAINT whatsapp_conversacion_etiquetas_pkey;
-- Una etiqueta cuya conversación ya no existe no tiene a qué agarrarse. No
-- debería quedar ninguna, pero la clave ajena lo rechazaría y el fallo saldría
-- como un error de migración en vez de como lo que es: una fila huérfana.
DELETE FROM public.whatsapp_conversacion_etiquetas e
 WHERE NOT EXISTS (
   SELECT 1 FROM public.whatsapp_contactos c
    WHERE c.contacto = e.contacto AND c.phone_number_id = e.phone_number_id);

ALTER TABLE public.whatsapp_conversacion_etiquetas
  ADD PRIMARY KEY (phone_number_id, contacto, etiqueta_id);

ALTER TABLE public.whatsapp_conversacion_etiquetas
  ADD CONSTRAINT whatsapp_conversacion_etiquetas_conversacion_fkey
  FOREIGN KEY (phone_number_id, contacto)
  REFERENCES public.whatsapp_contactos (phone_number_id, contacto) ON DELETE CASCADE;

-- ── 3. Seguimientos del agente ────────────────────────────────────────────
-- ⚠️ `agente_id` NO basta: un agente puede tener VARIAS líneas asignadas
-- (`agente_wa.phone_number_ids` es un arreglo). Sin la línea, un seguimiento
-- podría dispararse por la equivocada.

ALTER TABLE public.agente_wa_seguimientos
  ADD COLUMN IF NOT EXISTS phone_number_id text;

UPDATE public.agente_wa_seguimientos s SET phone_number_id = (
  SELECT m.phone_number_id
    FROM public.whatsapp_mensajes m
   WHERE m.contacto = s.contacto AND m.phone_number_id IS NOT NULL
   GROUP BY m.phone_number_id ORDER BY count(*) DESC LIMIT 1)
WHERE s.phone_number_id IS NULL;

-- ── 4. Campañas: por qué línea sale cada una ──────────────────────────────
-- Hoy no se guarda, así que un masivo sale por la línea que decida el código en
-- ese momento. Con dos líneas eso es una lotería con la marca de la empresa.
-- Nula a propósito: las campañas viejas ya salieron y no se les puede inventar
-- una línea; las nuevas la fijan al crearse.

ALTER TABLE public.whatsapp_campanas
  ADD COLUMN IF NOT EXISTS phone_number_id text;

-- ── 5. El trigger que crea la conversación ────────────────────────────────
--
-- 🩸 SIN ESTO NADA FUNCIONA. La fila de la conversación no la escribe el
-- backend: la crea este trigger en cada mensaje, y hacía `ON CONFLICT
-- (contacto)`. Con la clave nueva, ese ON CONFLICT ya no casa con ningún
-- índice y el INSERT del PRIMER mensaje que entre falla — o sea, la línea se
-- queda muda sin que nadie toque nada.
--
-- Y ya no hay `COALESCE(EXCLUDED.phone_number_id, ...)`: la línea es parte de
-- la identidad, así que no puede cambiar en un UPDATE. Si llega otra línea, es
-- otra conversación.
CREATE OR REPLACE FUNCTION public.fn_wa_touch_contacto() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Un mensaje sin línea no puede abrir conversación: no habría por dónde
  -- responderle. Se guarda el mensaje igual y se sigue.
  IF NEW.phone_number_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.whatsapp_contactos AS c
    (contacto, phone_number_id, ultimo_mensaje_en, ultimo_entrante_en)
  VALUES (
    NEW.contacto,
    NEW.phone_number_id,
    NEW.ocurrido_en,
    CASE WHEN NEW.direccion = 'IN' THEN NEW.ocurrido_en END
  )
  ON CONFLICT (phone_number_id, contacto) DO UPDATE SET
    -- GREATEST ignora NULL, así que un mensaje viejo insertado tarde
    -- (reproceso, backfill) no puede retroceder el reloj de la conversación.
    ultimo_mensaje_en  = GREATEST(c.ultimo_mensaje_en,  EXCLUDED.ultimo_mensaje_en),
    ultimo_entrante_en = GREATEST(c.ultimo_entrante_en, EXCLUDED.ultimo_entrante_en);
  RETURN NEW;
END;
$$;

-- ── 6. La vista de la bandeja, ahora por línea ────────────────────────────
-- Mismas columnas y mismo orden (CREATE OR REPLACE lo exige, y así se conservan
-- los permisos). Lo que cambia son los subconsultas: antes miraban TODOS los
-- mensajes del número, ahora solo los de esta línea.

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
    COALESCE(a.nombre, NULLIF(TRIM(BOTH FROM concat_ws(' '::text, cl.nombre, cl.apellido)), ''::text)::character varying, c.nombre_perfil::character varying) AS nombre,
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
          WHERE m.contacto = c.contacto AND m.phone_number_id = c.phone_number_id
            AND m.direccion = 'IN'::text
            AND (c.ultimo_leido_en IS NULL OR m.ocurrido_en > c.ultimo_leido_en)) AS sin_leer
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

-- El backend entra como `orbit_backend`, no como `postgres`.
GRANT SELECT ON public.v_whatsapp_conversaciones TO orbit_backend;

-- Los mensajes se leen y se cuentan por (línea, número) en cada pantalla.
CREATE INDEX IF NOT EXISTS ix_wa_mensajes_linea_contacto
  ON public.whatsapp_mensajes (phone_number_id, contacto, ocurrido_en DESC);

COMMIT;
