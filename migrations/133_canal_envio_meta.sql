-- 133 — El canal que se muestra deja de decir Zolutium.
--
-- `REPORTES_GRUPALES.canal_envio` seguía en "WHATSAPP_ZOLUTIUM" después del corte.
-- No enrutaba nada —comprobado: `grupales.js` deriva el canal de
-- `transporteWhatsAppOperativo()` y esta clave no la lee NADIE—, pero es lo que
-- se ve en la pantalla de configuración. Una etiqueta que miente sobre por dónde
-- sale la comunicación con las familias es exactamente el tipo de dato que
-- alguien usa mañana para decidir, y decide mal.
--
-- Se corrige el rótulo, no el comportamiento: el comportamiento ya era META.

BEGIN;

UPDATE public.config_operativa
   SET valor = '"WHATSAPP_META"'::jsonb
 WHERE modulo = 'REPORTES_GRUPALES'
   AND clave  = 'canal_envio'
   AND valor::text <> '"WHATSAPP_META"';

COMMIT;
