/**
 * Bandas de la tarifa POR PESO (perros y especies con `tarifa_peso = ESTANDAR`).
 *
 * La fuente de verdad del cobro es `planes_precios` (peso_min_gr / peso_max_gr):
 * Registro, Kanban, `calcularPrecioPara`, la alerta de Cuarto Frío y el agente
 * de WhatsApp buscan la banda ahí. Esta tabla es su ESPEJO para los lugares que
 * no consultan esos límites (los portales /solicitud y /solicitud-aliado, que
 * solo leen el precio por nombre de rango; el respaldo del plan Ángel; las filas
 * nuevas que crea Configuración › Precios). Si se cambia una, se cambia la otra
 * — la migración 226 lo dice en su encabezado.
 *
 * ── Cobertura de 1 kg (REPORTE ORBIT 2026-11-25, «Recalcular peso») ─────────
 * Cada banda cubre hasta 1 kg por encima de su nombre: «1-10 kg» cubre hasta
 * los 11 kg, «11-20 kg» hasta los 21, «21-35 kg» hasta los 36 y «36-60 kg»
 * hasta los 61 — hasta ese kilo EXACTO (David, 26-nov): 11,0 kg es «1-10 kg»
 * y 11,1 kg ya es «11-20 kg».
 * Antes (regla del 12-jun-2026): 1-10 = 1000–10999 g, 11-20 = 11000–20999 g…
 *
 * PETIT (< 1 kg) y FELINO (tarifa plana desde 1 kg) no se tocan: no son bandas
 * de peso con techo.
 */
export const RANGO_GRAMOS = {
  'PETIT':   { peso_min_gr: 0,     peso_max_gr: 999 },
  'FELINO':  { peso_min_gr: 1000,  peso_max_gr: null },
  '1-10KG':  { peso_min_gr: 1000,  peso_max_gr: 11000 },
  '11-20KG': { peso_min_gr: 11001, peso_max_gr: 21000 },
  '21-35KG': { peso_min_gr: 21001, peso_max_gr: 36000 },
  '36-60KG': { peso_min_gr: 36001, peso_max_gr: 61000 },
}

const BANDAS_POR_PESO = ['1-10KG', '11-20KG', '21-35KG', '36-60KG']

/**
 * Nombre del rango para un peso. `usaFelino` lo decide quien llama (catálogo
 * `especies.tarifa_peso` o, en los portales, el criterio Gato/Conejo).
 * Por encima de la última banda devuelve '36-60KG', como siempre: el cobro por
 * kilo adicional lo resuelve quien cotiza.
 *
 * @param {number|string} pesoKgRaw
 * @param {boolean} usaFelino
 * @returns {string|null}
 */
export function rangoPorPeso(pesoKgRaw, usaFelino = false) {
  const pesoKg = parseFloat(pesoKgRaw) || 0
  if (pesoKg <= 0) return null
  const pesoG = Math.round(pesoKg * 1000)
  if (pesoG <= RANGO_GRAMOS.PETIT.peso_max_gr) return 'PETIT'
  if (usaFelino) return 'FELINO'
  return BANDAS_POR_PESO.find(r => pesoG <= RANGO_GRAMOS[r].peso_max_gr) || '36-60KG'
}

/**
 * Respaldo del plan ÁNGEL cuando no tiene filas en `planes_precios`. Antes
 * vivía copiado con sus propios límites en precios.js, Kanban y Registro.
 */
const PRECIO_ANGEL = {
  'PETIT': 69000, 'FELINO': 79000,
  '1-10KG': 89000, '11-20KG': 119000, '21-35KG': 139000, '36-60KG': 189000,
}
export function precioAngelRespaldo(pesoKg, usaFelino = false) {
  const r = rangoPorPeso(pesoKg, usaFelino)
  return r ? PRECIO_ANGEL[r] : null
}
