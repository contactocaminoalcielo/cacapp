-- 092 — Standard y Premium NO llevan certificado de compostaje
--
-- Confirmado por David el 2026-08-12. Se detectó al armar la base de conocimiento
-- del agente: los dos planes son de CREMACIÓN (Standard grupal, Premium
-- individual) y el catálogo les tenía enganchado "Certificado compostaje", que es
-- de la línea de compostaje (Compets y Eco-grupal). Un certificado de compostaje
-- en un servicio de cremación es un documento que contradice lo que se hizo.
--
-- Los dos planes ya llevan "Reporte cremación", que es el comprobante correcto;
-- al quitar esto no se quedan sin documento.
--
-- ALCANCE: solo el catálogo, es decir los servicios NUEVOS. Las filas ya creadas
-- en `servicio_recordatorios` NO se tocan a propósito — 39 Standard ya se
-- ENTREGARON con ese ítem y borrarlos reescribiría lo que de verdad pasó. Los que
-- siguen PENDIENTE (6 Standard, 1 LISTO, 2 Premium al 2026-08-12) se deciden en la
-- operación, uno por uno, no desde una migración.

BEGIN;

DELETE FROM public.plan_recordatorios pr
USING public.planes p, public.recordatorios r
WHERE pr.plan_id = p.id
  AND pr.recordatorio_id = r.id
  AND p.nombre IN ('Standard', 'Premium')
  AND r.nombre = 'Certificado compostaje';

COMMIT;
