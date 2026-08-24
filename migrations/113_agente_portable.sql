-- 113 — Perfil portable y memoria configurable del agente.
--
-- Estos campos describen al agente sin depender de WhatsApp ni de las tablas de
-- negocio de Orbit. Forman parte de la definición que se puede exportar e
-- instalar en otro sistema. No contienen credenciales, datos de clientes ni
-- identificadores del canal.

BEGIN;

ALTER TABLE public.agente_wa
  ADD COLUMN IF NOT EXISTS categoria text NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN IF NOT EXISTS objetivo text,
  ADD COLUMN IF NOT EXISTS idioma text NOT NULL DEFAULT 'es',
  ADD COLUMN IF NOT EXISTS memoria_mensajes integer NOT NULL DEFAULT 20;

ALTER TABLE public.agente_wa
  DROP CONSTRAINT IF EXISTS agente_wa_categoria_chk;
ALTER TABLE public.agente_wa
  ADD CONSTRAINT agente_wa_categoria_chk CHECK (
    categoria IN ('GENERAL','VENTAS','SOPORTE','GESTION','COBRANZAS','ADMINISTRATIVO','OPERATIVO')
  );

ALTER TABLE public.agente_wa
  DROP CONSTRAINT IF EXISTS agente_wa_idioma_chk;
ALTER TABLE public.agente_wa
  ADD CONSTRAINT agente_wa_idioma_chk CHECK (idioma ~ '^[a-z]{2}(-[A-Z]{2})?$');

ALTER TABLE public.agente_wa
  DROP CONSTRAINT IF EXISTS agente_wa_memoria_mensajes_chk;
ALTER TABLE public.agente_wa
  ADD CONSTRAINT agente_wa_memoria_mensajes_chk CHECK (memoria_mensajes BETWEEN 2 AND 100);

UPDATE public.agente_wa
   SET categoria = 'VENTAS',
       objetivo = COALESCE(
         objetivo,
         'Atender a veterinarias aliadas, resolver preguntas comerciales y facilitar solicitudes de servicio.'
       ),
       idioma = 'es'
 WHERE clave = 'VETERINARIAS';

COMMIT;
