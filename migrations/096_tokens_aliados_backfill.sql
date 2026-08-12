-- 096 — Enlace de acceso para TODOS los aliados, generado de una vez
--
-- Regla que fijó David (2026-08-12): **el agente consulta, no cambia nada en
-- Orbit. Lo único que crea es la solicitud.**
--
-- Había una excepción escondida: para entregarle a la veterinaria su enlace
-- personal, `enlacePersonalAliado()` hacía un get-or-create — si el aliado no
-- tenía `token_acceso`, el agente se lo generaba. Era necesario porque **solo 11
-- de 198 aliados tenían enlace**: sin eso el flujo fallaba para el 94 %.
--
-- Generándolos todos aquí, esa necesidad desaparece y el camino del agente
-- queda de solo lectura. Los aliados NUEVOS ya reciben el suyo al aprobarlos
-- (`aprobarAliado`), así que esto es un rezago histórico, no un agujero.
--
-- El token es la credencial del portal del aliado: con él se registran servicios
-- a su nombre y su comisión. Por eso lleva 4 bytes aleatorios y no se deduce del
-- nombre. Este backfill NO toca estado, actividad ni ningún otro campo.

BEGIN;

UPDATE public.aliados
   SET token_acceso =
         COALESCE(
           NULLIF(
             LEFT(
               REGEXP_REPLACE(
                 REGEXP_REPLACE(
                   TRANSLATE(LOWER(COALESCE(nombre, '')), 'áéíóúüñ', 'aeiouun'),
                   '[^a-z0-9]+', '-', 'g'),
                 '(^-+|-+$)', '', 'g'),
               24),
             ''),
           'aliado')
         || '-' || ENCODE(GEN_RANDOM_BYTES(4), 'hex')
 WHERE token_acceso IS NULL;

COMMIT;
