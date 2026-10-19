-- ============================================================================
-- 182 — Traspaso de conversaciones entre el agente de veterinarias y el comercial
-- ----------------------------------------------------------------------------
-- Pedido de David (2026-10-19): la MISMA línea de veterinarias la atienden dos
-- agentes. Si la vet escribe para un servicio, el de veterinarias la guía como
-- hoy; si es algo comercial ("me quiero afiliar", comisiones, convenio), la
-- atiende el comercial. Y una vet en pleno proceso comercial que de pronto
-- quiere mandar un servicio NO puede quedarse con el comercial.
--
-- Por eso el traspaso es por TEMA, en las dos direcciones, y lo decide el propio
-- agente (que ya leyó la conversación) con una herramienta:
--   · `pasar_a_comercial`    — veterinarias → comercial
--   · `devolver_a_operacion` — comercial → veterinarias
-- El agente que recibe responde ESE MISMO mensaje. El tiempo es solo una red de
-- seguridad: sin mensajes en `dias_traspaso_comercial`, vuelve sola a operación.
--
-- Además, `reportar_reclamo` (los dos agentes): un reclamo concreto ("no me han
-- pagado la comisión") crea un ticket ALTA y una alerta para revisarlo.
--
-- Aditiva e idempotente. Las herramientas se le dan a los agentes como DATO; el
-- traspaso solo se ofrece si el agente comercial está ENCENDIDO (lo decide el
-- backend), así que aplicar esto con VENTAS apagado no cambia nada en la línea
-- salvo los reclamos.
--   cat migrations/182_agente_traspasos.sql | ssh -i ~/.ssh/orbit_deploy -o BatchMode=yes root@13.140.139.61 \
--     "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -"
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.agente_wa_traspasos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- La conversación es (línea, número): migración 109.
  phone_number_id text NOT NULL,
  contacto        text NOT NULL,
  agente_id       integer NOT NULL REFERENCES public.agente_wa(id) ON DELETE CASCADE,
  desde_agente_id integer REFERENCES public.agente_wa(id) ON DELETE SET NULL,
  motivo          text,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  -- Se corre con cada respuesta del agente comercial; vencido = vuelve a operación.
  hasta           timestamptz NOT NULL,
  cerrado_en      timestamptz,
  cerrado_motivo  text
);
-- Una conversación tiene a lo sumo un traspaso vivo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_traspaso_abierto
  ON public.agente_wa_traspasos (phone_number_id, contacto) WHERE cerrado_en IS NULL;

GRANT SELECT, INSERT, UPDATE ON TABLE public.agente_wa_traspasos TO orbit_backend;
GRANT ALL ON TABLE public.agente_wa_traspasos TO postgres, service_role;
ALTER TABLE public.agente_wa_traspasos ENABLE ROW LEVEL SECURITY;

INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
  ('CRM', 'dias_traspaso_comercial', '7'::jsonb,
   'Días sin mensajes tras los cuales una conversación pasada al agente comercial vuelve sola al de veterinarias')
ON CONFLICT (modulo, clave) DO NOTHING;

-- Herramientas (sin fila no las tiene).
INSERT INTO public.agente_wa_herramientas (agente_id, clave, activa, orden)
SELECT a.id, h.clave, true, h.orden
  FROM public.agente_wa a
  JOIN (VALUES ('VETERINARIAS', 'pasar_a_comercial', 20), ('VETERINARIAS', 'reportar_reclamo', 21),
               ('VENTAS', 'devolver_a_operacion', 7), ('VENTAS', 'reportar_reclamo', 8)) h(agente, clave, orden)
    ON h.agente = a.clave
 WHERE NOT EXISTS (SELECT 1 FROM public.agente_wa_herramientas x WHERE x.agente_id = a.id AND x.clave = h.clave);

-- Al comercial se le explica que ahora también recibe aliadas por tema.
UPDATE public.agente_wa
   SET instrucciones = instrucciones || E'\n\n'
     || 'TAMBIÉN TE PASAN ALIADAS: el agente de veterinarias te entrega conversaciones de clínicas YA '
     || 'aliadas cuando el tema es comercial (comisiones, convenio, planes para la clínica, beneficios). '
     || 'Atiéndelas como aliadas: no les ofrezcas afiliarse. En cuanto pidan una recogida, pregunten por '
     || 'un servicio en curso, una entrega o un certificado, usa `devolver_a_operacion` SIN escribir nada: '
     || 'el otro agente les responde ese mismo mensaje. Haz lo mismo cuando el tema comercial termine.' || E'\n\n'
     || 'RECLAMOS: si la clínica reclama algo concreto que salió mal (no le pagaron una comisión, un pago, '
     || 'una entrega, mala atención) usa `reportar_reclamo`. Después dile que quedó registrado y que el '
     || 'equipo lo revisa y le responde. No prometas fechas ni montos.'
 WHERE clave = 'VENTAS' AND position('devolver_a_operacion' in instrucciones) = 0;

COMMIT;

-- Verificación:
--   select a.clave, h.clave from agente_wa_herramientas h join agente_wa a on a.id = h.agente_id
--    where h.clave in ('pasar_a_comercial','devolver_a_operacion','reportar_reclamo');   -- 4 filas
