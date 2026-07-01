-- ============================================================================
-- 009 — Ventana de aceptación del PORTAL de imágenes (desacople del job)
-- Fecha: 2026-07-01
--
-- Problema: el portal mostraba "¡Ya recibimos todo!" a clientes que solo abrían
-- el enlace SIN haber enviado nada. Causa: `datosPortal` colapsaba dos cosas en
-- un solo `ya_recibido` → true también cuando el servicio ya no estaba EXACTAMENTE
-- en EN_CUARTO_FRIO (p.ej. el técnico lo procesó antes de que el cliente subiera
-- las fotos). La lista `estados_elegibles` (solo EN_CUARTO_FRIO) gobernaba a la vez
-- la selección del job y la aceptación del portal.
--
-- Decisión David (2026-07-01): dejar que el cliente pueda enviar igual aunque la
-- mascota ya haya avanzado de etapa. Se DESACOPLAN las dos ventanas:
--   - estados_elegibles → el JOB proactivo sigue pidiendo solo en EN_CUARTO_FRIO.
--   - estados_portal     → el PORTAL acepta cargas hasta producción.
-- Fuera de esa ventana (aún antes del cuarto frío, o ya LISTO/EN_ENTREGA/ENTREGADO)
-- el portal muestra un mensaje honesto (escríbenos por WhatsApp), no "ya recibimos".
--
-- NOTA: el backend ya trae este valor como default en código, así que sin esta
-- fila el comportamiento es el mismo. Este seed lo hace visible/ajustable en
-- config_operativa. Aditivo y reversible.
-- ============================================================================

INSERT INTO public.config_operativa (modulo, clave, valor, descripcion) VALUES
 ('SOLICITUDES_IMAGENES','estados_portal','["EN_CUARTO_FRIO","EN_PROCESO","EN_PRODUCCION"]',
  'Estados del servicio en los que el PORTAL público acepta cargas del cliente (más amplio que estados_elegibles, que solo controla la selección del job proactivo)')
ON CONFLICT (modulo, clave) DO NOTHING;

-- ============================================================================
-- ROLLBACK:
--   DELETE FROM public.config_operativa
--   WHERE modulo = 'SOLICITUDES_IMAGENES' AND clave = 'estados_portal';
-- ============================================================================
