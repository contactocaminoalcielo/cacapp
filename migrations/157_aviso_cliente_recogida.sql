-- 157_aviso_cliente_recogida.sql
-- Traza del aviso de hora al CLIENTE PARTICULAR, que hoy no deja ninguna.
--
-- Pedido de David (2026-09-16). Lo que ya existía: al iniciar ruta, el técnico
-- pone su hora y el Kanban le levanta al coordinador una tarjeta con un botón
-- `wa.me` "Avisar al cliente por WhatsApp" con el mensaje ya escrito. Eso cubre
-- todo lo que la automatización de veterinarias NO cubre (migración 154), que es
-- justo la regla que David quería: 137 servicios en los últimos 30 días.
--
-- El problema no era el envío, era la CEGUERA. El botón solo llamaba a
-- `descartarAlertaRuta`, que marca la notificación como leída — exactamente lo
-- mismo que hace la ✕ de descartar. En los datos, "le avisé a la familia" y
-- "cerré el aviso sin avisar" eran INDISTINGUIBLES, y a los 2 días
-- (`DIAS_EXPIRA_ALERTA`) el pendiente se marcaba leído solo y desaparecía. Para
-- clínicas hay `aviso_vet_enviado_en` + el `delivered` de Meta + una novedad;
-- para los particulares no había absolutamente nada.
--
-- ⚠️ Esto registra "el coordinador lo mandó", NO "el cliente lo recibió". Un
-- `wa.me` abre WhatsApp y ahí se pierde la pista: no hay acuse de entrega como
-- el de la Cloud API. Es menos que lo de las clínicas, y es a propósito — David
-- decidió (2026-09-16) que los particulares NO pueden salir por ninguna de las
-- dos líneas, porque una plantilla abre ventana de 24 h e invita a la familia a
-- responder en un canal que según el proceso no la atiende. wa.me sale de una
-- persona y la conversación se queda con esa persona.
--
-- Por qué el destino se guarda: el número puede cambiar después en la ficha del
-- cliente, y entonces la traza diría a quién se le avisó de verdad en su momento
-- (mismo criterio que `aviso_vet_destino`; ver bug_numero_congelado_envios).

BEGIN;
SET LOCAL lock_timeout = '5s';

-- `recogidas` tiene un AFTER UPDATE (`trg_gestionar_comision`) que solo actúa
-- cuando `estado` pasa a COMPLETADA. Escribir estas columnas no lo dispara: es
-- el mismo terreno ya verificado para las cuatro columnas de la migración 154.
ALTER TABLE public.recogidas
  ADD COLUMN IF NOT EXISTS aviso_cliente_enviado_en timestamptz,
  ADD COLUMN IF NOT EXISTS aviso_cliente_destino    varchar(20),
  ADD COLUMN IF NOT EXISTS aviso_cliente_por        uuid REFERENCES public.personal(id);

COMMENT ON COLUMN public.recogidas.aviso_cliente_enviado_en
  IS 'Cuándo el coordinador tocó "Avisar al cliente por WhatsApp" (wa.me). Es "se mandó", NO "se recibió": wa.me no da acuse de entrega. NULL + ruta iniciada = la familia no sabe la hora.';
COMMENT ON COLUMN public.recogidas.aviso_cliente_destino
  IS 'Número al que se avisó, congelado. El de la ficha del cliente puede cambiar después.';
COMMENT ON COLUMN public.recogidas.aviso_cliente_por
  IS 'Quién avisó. Distingue el aviso real del descarte: la ✕ no escribe nada aquí.';

COMMIT;
