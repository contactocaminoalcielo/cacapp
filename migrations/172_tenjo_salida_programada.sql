-- ============================================================================
-- 172 — Aplazar la salida del cubículo: el operario decide la fecha
-- ----------------------------------------------------------------------------
-- Reporte del operario de Tenjo (23-sep): en el recorte de salidas hay mascotas
-- que NO deben salir aunque su compostaje ya se cumplió — a Dallas le falta
-- tiempo, y la familia de Matías tiene otra mascota en proceso y quiere que
-- las dos salgan juntas para hacerles la hidrólisis por separado. Hoy no hay
-- forma de sacarlas de la lista: quedan en el PDF que se envía a quienes avisan
-- a los clientes, y el aviso saldría mal.
--
-- Decisión de David: el operario decide LIBREMENTE la fecha de salida. La
-- mascota aplazada sale de «Por sacar» (y de su PDF) hasta que llegue su fecha.
--
-- ⚠️ Esto NO toca `cubiculo_salida` (la salida REAL, migr. 155) ni el trigger
-- del plazo de entrega: es solo la fecha PLANEADA. El plazo de los
-- recordatorios sigue arrancando con la salida real.
--
-- Aditiva e idempotente. Aplicar en VPS (Contabo):
--   cat migrations/172_tenjo_salida_programada.sql | \
--     ssh -i ~/.ssh/orbit_deploy -o BatchMode=yes root@13.140.139.61 \
--     "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -"
-- 🔑 Primero la migración, después el push (como con la 155): el frontend
--    nuevo selecciona estas columnas y sin ellas la pestaña Salidas falla.
-- Los GRANT de `lotes_tenjo_items` son de tabla entera: las columnas nuevas
-- quedan cubiertas solas.
-- ============================================================================
BEGIN;

ALTER TABLE public.lotes_tenjo_items
  ADD COLUMN IF NOT EXISTS salida_programada        date,
  ADD COLUMN IF NOT EXISTS salida_programada_motivo text,
  ADD COLUMN IF NOT EXISTS salida_programada_por    uuid REFERENCES public.personal(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS salida_programada_en     timestamptz;

COMMENT ON COLUMN public.lotes_tenjo_items.salida_programada IS
  'Fecha PLANEADA de salida del cubículo, decidida por el operario (migr. 172). Con fecha futura, la mascota no aparece en «Por sacar» ni en su PDF aunque el compostaje se haya cumplido. NO es la salida real: esa es cubiculo_salida.';
COMMENT ON COLUMN public.lotes_tenjo_items.salida_programada_motivo IS
  'Por qué se aplazó o programó: le falta tiempo, la familia pide una última visita, espera a otra mascota, etc. Va en la lista de aplazadas para que el siguiente turno sepa la razón.';

COMMIT;
