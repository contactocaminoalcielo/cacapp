-- 107 — La voz es del AGENTE, no del código
--
-- Empieza el canal de voz. La voz elegida (Eric, tras oír cinco y compararlas)
-- va en la fila del agente por la misma razón que las instrucciones y la base
-- de conocimiento: **este esqueleto va a servir para otra empresa**, y una
-- empresa hermana necesita su propia voz sin que nadie despliegue nada.
--
-- `agente_wa` ya se elige por número de teléfono, así que con esto una segunda
-- empresa es una fila más: su número, sus instrucciones, su voz.
--
-- ⚠️ El modelo importa tanto como la voz: `eleven_flash_v2_5` es el de BAJA
-- LATENCIA. El de máxima calidad suena algo mejor y llega tarde — y en una
-- llamada, medio segundo pesa más que un matiz de entonación.

BEGIN;

ALTER TABLE public.agente_wa
  ADD COLUMN IF NOT EXISTS voz_id text,
  ADD COLUMN IF NOT EXISTS voz_modelo text NOT NULL DEFAULT 'eleven_flash_v2_5',
  -- Apagado por defecto: que exista la voz no significa que este agente hable.
  -- Se enciende cuando el canal esté probado, no cuando el campo exista.
  ADD COLUMN IF NOT EXISTS voz_activa boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.agente_wa.voz_id IS
  'Voz de ElevenLabs con la que habla este agente. NULL = no tiene voz configurada.';
COMMENT ON COLUMN public.agente_wa.voz_modelo IS
  'Modelo de sintesis. flash = baja latencia, que es lo que exige una llamada.';

-- Eric — elegida el 2026-08-20 comparando cinco voces con la misma frase.
UPDATE public.agente_wa
   SET voz_id = 'cjVigY5qzO86Huf0OWal'
 WHERE clave = 'VETERINARIAS' AND voz_id IS NULL;

COMMIT;
