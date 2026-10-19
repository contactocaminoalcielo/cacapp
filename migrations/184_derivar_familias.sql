-- ============================================================================
-- 184 — Familias que escriben a la línea de veterinarias
-- ----------------------------------------------------------------------------
-- Pedido de David (2026-10-19): particulares ven el número de veterinarias en un
-- folleto, escriben ahí, dicen "mi mascota está en la veterinaria X" y el agente
-- los trata como una clínica (les manda el enlace de afiliación y, desde la 180,
-- hasta quedaban de prospectos en el CRM). Medido: en 30 días, ~30 conversaciones
-- de la línea no eran aliadas (≈1 de cada 4).
--
-- El número solo NO alcanza para filtrar (hay clínicas guardadas como cliente
-- porque dieron su número de contacto), así que lo decide el agente con la
-- conversación, y `derivar_familia`:
--   · arma un enlace wa.me a la línea de ATENCIÓN AL CLIENTE (319 358 5508, no
--     está en la API: allí se toman los servicios de particulares) con el mensaje
--     ya escrito — qué necesita y qué veterinaria la refirió;
--   · marca la conversación PARTICULAR (no vuelve a pasar por el filtro);
--   · retira del embudo el prospecto que se hubiera creado por error;
--   · anota la veterinaria que la refirió: en la bitácora de la aliada (para la
--     comisión) o, si no es aliada, como prospecto REFERIDO.
--   cat migrations/184_derivar_familias.sql | ssh -i ~/.ssh/orbit_deploy -o BatchMode=yes root@13.140.139.61 \
--     "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -"
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- Etiqueta del sistema: la pone el backend, no el modelo (solo_sistema, global).
INSERT INTO public.whatsapp_etiquetas (clave, nombre, grupo, color, descripcion, orden, solo_sistema, agente_id)
SELECT 'PARTICULAR', 'Familia (derivada a atención al cliente)', 'OTRO', '#0EA5E9',
       'Una familia escribió a la línea de veterinarias y se le pasó el enlace de atención al cliente.', 90, true, NULL
 WHERE NOT EXISTS (SELECT 1 FROM public.whatsapp_etiquetas WHERE clave = 'PARTICULAR' AND agente_id IS NULL);

INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
  ('CRM', 'linea_atencion_cliente', '"573193585508"'::jsonb,
   'WhatsApp de atención al cliente (particulares). A él se deriva a las familias que escriben a la línea de veterinarias.')
ON CONFLICT (modulo, clave) DO NOTHING;

INSERT INTO public.agente_wa_herramientas (agente_id, clave, activa, orden)
SELECT a.id, 'derivar_familia', true, 22
  FROM public.agente_wa a
 WHERE a.clave IN ('VETERINARIAS', 'VENTAS')
   AND NOT EXISTS (SELECT 1 FROM public.agente_wa_herramientas x WHERE x.agente_id = a.id AND x.clave = 'derivar_familia');

UPDATE public.agente_wa
   SET instrucciones = instrucciones || E'\n\n'
     || 'FAMILIAS: si quien escribe resulta ser la familia dueña de la mascota y no una clínica, usa '
     || '`derivar_familia`: esta línea es solo para clínicas.'
 WHERE clave = 'VENTAS' AND position('derivar_familia' in instrucciones) = 0;

COMMIT;

-- Verificación:
--   select clave, solo_sistema from whatsapp_etiquetas where clave = 'PARTICULAR';
--   select a.clave from agente_wa_herramientas h join agente_wa a on a.id = h.agente_id where h.clave = 'derivar_familia';
