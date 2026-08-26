-- 131 — Bloquear una conversación, y cortar sola una pelea entre bots.
--
-- Pedido de David con la línea de familias ya viva: "hay veces que llegan
-- mensajes de otros bots y el agente se queda respondiéndole a otro agente;
-- debería poder pausar y también bloquear si lo deseamos".
--
-- Es un riesgo de dinero, no de estética. Dos agentes conversando entre ellos no
-- se cansan: cada vuelta es una llamada pagada al modelo, y el único freno que
-- había era `max_turnos` = 20 por conversación cada 24 h — o sea, veinte
-- llamadas pagadas ANTES de frenar, y otras veinte al día siguiente.
--
-- Se separan dos cosas que hoy estaban en una sola:
--   · PAUSAR  (`agente_activo=false`) — ya existía: reversible, del día a día,
--     "de esta me encargo yo". Se enciende y se apaga sin ceremonia.
--   · BLOQUEAR (nuevo) — el agente NO vuelve por su cuenta. Ni acusa recibo ni
--     muestra "escribiendo…": para el otro lado, nadie contesta. Es para un bot,
--     un spammer o un número que nunca debe recibir respuesta automática.
--
-- Bloquear NO impide que los mensajes entren ni que una persona conteste a mano:
-- solo calla al agente. Callar a Orbit entero es cosa de la lista blanca de
-- números (`WHATSAPP_ALLOWED_PHONE_IDS`), que es otra capa y otro nivel.

BEGIN;

ALTER TABLE public.whatsapp_contactos
  ADD COLUMN IF NOT EXISTS bloqueado        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bloqueado_motivo text,
  ADD COLUMN IF NOT EXISTS bloqueado_en     timestamptz,
  ADD COLUMN IF NOT EXISTS bloqueado_por    uuid REFERENCES public.personal(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.whatsapp_contactos.bloqueado IS
  'El agente nunca responde aquí, ni acusa recibo. Los mensajes siguen entrando y una persona sí puede contestar.';

-- Índice parcial: los bloqueados son poquísimos y se consultan en cada mensaje.
CREATE INDEX IF NOT EXISTS ix_wa_contactos_bloqueado
  ON public.whatsapp_contactos (phone_number_id, contacto)
  WHERE bloqueado;

-- Etiqueta del corte automático. `solo_sistema` para que el modelo no pueda
-- ponérsela a sí mismo: la pone el servidor cuando detecta la ráfaga, y va a
-- Novedades para que una persona mire qué pasó y decida si bloquear.
INSERT INTO public.whatsapp_etiquetas
  (clave, nombre, grupo, color, descripcion, orden, activo, solo_sistema, agente_id)
VALUES
  ('BUCLE', 'Posible bucle con otro bot', 'NOVEDAD', '#b91c1c',
   'El agente respondió muchas veces en pocos minutos y se pausó solo. Revisa si al otro lado hay un bot.',
   95, true, true, NULL)
ON CONFLICT (agente_id, clave) DO UPDATE SET
  nombre = EXCLUDED.nombre, grupo = EXCLUDED.grupo, color = EXCLUDED.color,
  descripcion = EXCLUDED.descripcion, activo = true, solo_sistema = true;

COMMIT;
