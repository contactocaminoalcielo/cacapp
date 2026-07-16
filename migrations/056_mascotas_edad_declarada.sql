-- 056_mascotas_edad_declarada.sql — Edad de la mascota para el contrato.
--
-- El contrato pre-exequial real la imprime en la tabla de mascotas
-- ("RAZA: | EDAD AÑOS: | PESO: | NOMBRE: | ESPECIE:" → "BORDER COLLIE | 17 AÑOS
-- | 10 KG | LARA | CANINO"), pero no se guardaba en ninguna parte.
--
-- No se usa `mascotas.fecha_nacimiento` (que ya existe, vacía) porque el cliente
-- NO da la fecha: da los años ("17 AÑOS"). Derivar una fecha de nacimiento a
-- partir de eso inventaría una precisión que nadie tiene.
--
-- Se guarda lo que sí se sabe —los años— junto con la fecha en que se declararon.
-- Así la edad no se pudre: a cualquier fecha posterior es
-- `edad_anios + años transcurridos desde edad_declarada_en`, y el contrato de una
-- renovación imprime la edad correcta sin volver a preguntar.

BEGIN;

ALTER TABLE public.mascotas
  ADD COLUMN IF NOT EXISTS edad_anios       smallint CHECK (edad_anios >= 0 AND edad_anios <= 40),
  ADD COLUMN IF NOT EXISTS edad_declarada_en date;

COMMENT ON COLUMN public.mascotas.edad_anios IS
  'Edad en años tal como la declaró el dueño (el contrato pre-exequial la pide así, no por fecha de nacimiento). Leer SIEMPRE junto a edad_declarada_en: la edad vigente = edad_anios + años transcurridos desde esa fecha.';
COMMENT ON COLUMN public.mascotas.edad_declarada_en IS
  'Fecha en que se declaró edad_anios. Sin esta fecha la edad no se puede envejecer y queda congelada/errada.';

-- Coherencia: o van las dos o ninguna
ALTER TABLE public.mascotas
  DROP CONSTRAINT IF EXISTS chk_mascotas_edad_declarada;
ALTER TABLE public.mascotas
  ADD CONSTRAINT chk_mascotas_edad_declarada
  CHECK ((edad_anios IS NULL) = (edad_declarada_en IS NULL));

COMMIT;
