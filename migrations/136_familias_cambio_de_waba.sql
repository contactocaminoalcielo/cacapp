-- 136 — La línea de FAMILIAS cambia de WABA y con ella su phone_number_id.
--
-- Al mudar un número entre cuentas de WhatsApp, Meta le asigna un
-- `phone_number_id` NUEVO (a la línea de vets le pasó: 1093403420518278 →
-- 1313164878540238). Y desde la migración 109 ese id NO es un dato suelto: es
-- media clave primaria de `whatsapp_contactos` y de las etiquetas, porque una
-- conversación es el par (línea, número).
--
-- O sea: si el id cambia y esto no corre, las 6.124 conversaciones de familias
-- quedan huérfanas —la bandeja las sigue mostrando, pero el primer mensaje que
-- entre crea una conversación NUEVA y vacía sobre la misma persona— y el agente
-- responde sin historial.
--
-- ⚠️ ANTES DE CORRER: pon el id nuevo abajo. Sin eso el script se planta solo.
-- ⚠️ Correr DESPUÉS de que la mudanza en Meta esté hecha y confirmada.
-- ⚠️ Esto solo arregla la DB. Faltan el `.env` del backend y el frontend.

\set viejo '967346343135405'
\set nuevo 'PONER_EL_ID_NUEVO'

-- ── Freno de mano ─────────────────────────────────────────────────────────
-- Va ANTES del BEGIN y con `\gset`, no con un bloque DO: psql no interpola
-- variables dentro de `$$ ... $$`, así que allí el freno sería decorativo.

SELECT (:'nuevo' ~ '^[0-9]{10,20}$' AND :'nuevo' <> :'viejo') AS listo \gset
\if :listo
\else
\echo '⛔ Falta poner el phone_number_id nuevo en \set nuevo (o es igual al viejo). No se aplicó nada.'
\quit
\endif

BEGIN;

\echo '── ANTES ──'
SELECT 'contactos' AS tabla, count(*) FROM public.whatsapp_contactos WHERE phone_number_id = :'viejo'
UNION ALL SELECT 'mensajes',     count(*) FROM public.whatsapp_mensajes   WHERE phone_number_id = :'viejo'
UNION ALL SELECT 'etiquetas',    count(*) FROM public.whatsapp_conversacion_etiquetas WHERE phone_number_id = :'viejo'
UNION ALL SELECT 'eventos',      count(*) FROM public.whatsapp_webhook_events WHERE phone_number_id = :'viejo'
UNION ALL SELECT 'seguimientos', count(*) FROM public.agente_wa_seguimientos WHERE phone_number_id = :'viejo'
UNION ALL SELECT 'campanas',     count(*) FROM public.whatsapp_campanas WHERE phone_number_id = :'viejo'
UNION ALL SELECT 'sombra',       count(*) FROM public.agente_wa_sombra WHERE phone_number_id = :'viejo';

-- ── 1. La FK compuesta estorba ────────────────────────────────────────────
-- `whatsapp_conversacion_etiquetas` apunta a (phone_number_id, contacto) de
-- `whatsapp_contactos` con ON DELETE CASCADE — pero NO con ON UPDATE CASCADE.
-- Cambiar la clave del padre con la FK puesta revienta. Se quita, se mueven las
-- dos, y se vuelve a poner igual que estaba.

ALTER TABLE public.whatsapp_conversacion_etiquetas
  DROP CONSTRAINT whatsapp_conversacion_etiquetas_conversacion_fkey;

-- ── 2. Mover el id en todo lo que lo guarda ───────────────────────────────

UPDATE public.whatsapp_contactos              SET phone_number_id = :'nuevo' WHERE phone_number_id = :'viejo';
UPDATE public.whatsapp_conversacion_etiquetas SET phone_number_id = :'nuevo' WHERE phone_number_id = :'viejo';
UPDATE public.whatsapp_mensajes               SET phone_number_id = :'nuevo' WHERE phone_number_id = :'viejo';
UPDATE public.agente_wa_seguimientos          SET phone_number_id = :'nuevo' WHERE phone_number_id = :'viejo';
UPDATE public.whatsapp_campanas               SET phone_number_id = :'nuevo' WHERE phone_number_id = :'viejo';
UPDATE public.agente_wa_sombra                SET phone_number_id = :'nuevo' WHERE phone_number_id = :'viejo';

UPDATE public.whatsapp_importaciones
   SET phone_number_id_destino = :'nuevo'
 WHERE phone_number_id_destino = :'viejo';

-- Los eventos crudos (`whatsapp_webhook_events`) se dejan como llegaron: son la
-- bitácora de lo que Meta mandó y reescribirla sería falsearla. La detección de
-- acuses huérfanos cruza por `wa_message_id`, no por la línea, así que no sufre.

-- ── 3. El agente: `phone_number_ids` es un arreglo ────────────────────────

UPDATE public.agente_wa
   SET phone_number_ids = array_replace(phone_number_ids, :'viejo', :'nuevo')
 WHERE :'viejo' = ANY(phone_number_ids);

-- ── 4. Devolver la FK tal cual estaba ─────────────────────────────────────

ALTER TABLE public.whatsapp_conversacion_etiquetas
  ADD CONSTRAINT whatsapp_conversacion_etiquetas_conversacion_fkey
  FOREIGN KEY (phone_number_id, contacto)
  REFERENCES public.whatsapp_contactos (phone_number_id, contacto) ON DELETE CASCADE;

-- ── 5. Verificación ───────────────────────────────────────────────────────

\echo '── DESPUES · id viejo (todo debe ser 0) ──'
SELECT 'contactos' AS tabla, count(*) FROM public.whatsapp_contactos WHERE phone_number_id = :'viejo'
UNION ALL SELECT 'mensajes',     count(*) FROM public.whatsapp_mensajes   WHERE phone_number_id = :'viejo'
UNION ALL SELECT 'etiquetas',    count(*) FROM public.whatsapp_conversacion_etiquetas WHERE phone_number_id = :'viejo'
UNION ALL SELECT 'seguimientos', count(*) FROM public.agente_wa_seguimientos WHERE phone_number_id = :'viejo'
UNION ALL SELECT 'campanas',     count(*) FROM public.whatsapp_campanas WHERE phone_number_id = :'viejo'
UNION ALL SELECT 'sombra',       count(*) FROM public.agente_wa_sombra WHERE phone_number_id = :'viejo';

\echo '── DESPUES · id nuevo (debe cuadrar con el ANTES) ──'
SELECT 'contactos' AS tabla, count(*) FROM public.whatsapp_contactos WHERE phone_number_id = :'nuevo'
UNION ALL SELECT 'mensajes',     count(*) FROM public.whatsapp_mensajes   WHERE phone_number_id = :'nuevo'
UNION ALL SELECT 'etiquetas',    count(*) FROM public.whatsapp_conversacion_etiquetas WHERE phone_number_id = :'nuevo'
UNION ALL SELECT 'seguimientos', count(*) FROM public.agente_wa_seguimientos WHERE phone_number_id = :'nuevo'
UNION ALL SELECT 'campanas',     count(*) FROM public.whatsapp_campanas WHERE phone_number_id = :'nuevo'
UNION ALL SELECT 'sombra',       count(*) FROM public.agente_wa_sombra WHERE phone_number_id = :'nuevo';

\echo '── El agente (phone_number_ids debe traer el nuevo) ──'
SELECT id, clave, phone_number_ids, activo FROM public.agente_wa ORDER BY id;

COMMIT;
