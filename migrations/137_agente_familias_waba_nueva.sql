-- 137 — `agente_wa.waba_id` de FAMILIAS, que la 136 se dejó.
--
-- La 136 movió el `phone_number_id` en las siete tablas donde vive, pero
-- `agente_wa.waba_id` es OTRA cosa: no es la línea, es la CUENTA en la que el
-- agente busca, crea y envía plantillas (migración 115, `contexto()` en
-- whatsapp-plantillas.js). Se quedó apuntando a la WABA vieja.
--
-- Efecto: el módulo de plantillas de FAMILIAS leía el catálogo de la cuenta que
-- ya no es suya. Mudo — el catálogo viejo existe y responde, así que no da
-- error; simplemente enseña y gestiona plantillas que su línea no puede enviar.
--
-- Y se fija el de VETERINARIAS, que estaba NULL y caía al `WHATSAPP_WABA_ID`
-- del `.env`. Hoy ese valor acierta, pero es la misma trampa que ya documenta
-- el código: un acierto por casualidad que deja de serlo al añadir un agente.

BEGIN;

UPDATE public.agente_wa SET waba_id = '1048633974692786' WHERE clave = 'FAMILIAS';
UPDATE public.agente_wa SET waba_id = '596644673438490'  WHERE clave = 'VETERINARIAS' AND waba_id IS NULL;

SELECT id, clave, waba_id, phone_number_ids, activo FROM public.agente_wa ORDER BY id;

COMMIT;
