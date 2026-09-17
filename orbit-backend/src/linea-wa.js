// Línea de WhatsApp desde la que sale TODA la comunicación automática con clientes
// (solicitudes de imágenes, seguimientos, certificados/reportes grupales, digitales).
//
// ⚠️ Zolutium/GHL NO respeta `fromNumber` para números importados de Meta: rutea por la
// línea del ÚLTIMO ENTRANTE del contacto (campo interno `lastInboundWhatsappMap` de la
// conversación). Medido el 2026-08-06: 143 de 2065 envíos (6,9 %) salieron por líneas
// ajenas — 60 de ellos por la línea de HoyFarma, que es otra empresa.
//
// El campo que SÍ fija la línea es `whatsapp.fromNumberId`, y lleva el
// **phone_number_id de Meta**, no el número en E.164. Verificado end-to-end contra un
// contacto amarrado a la línea de veterinarias y con sesión de 24 h viva en ella: el
// mensaje salió igualmente por la 315.
// 🩸 El id de veterinarias estaba mal: decía `1093403420518278`, que no existe en
// ninguna parte. El real es `1313164878540238`, comprobado contra la Graph API el
// 26-ago-2026. Aquí solo se usa para poner el número legible en la auditoría, así
// que no rompía envíos — pero un phone_number_id inventado en un mapa de
// constantes es justo lo que alguien copia luego a una decisión de enrutado, y
// por rutear a la línea equivocada ya se nos fue el 6,9 % de los envíos una vez.
const LINEAS = {
  '1317926468072324': '+573159891247',  // familias — mudada a la WABA "diseño" el 28-ago-2026
  '1313164878540238': '+573180967711',  // veterinarias
  '894547387070615': '+573189864595',
}

// Override por entorno solo para poder corregir sin redesplegar si Meta reasigna el id.
export const LINEA_WA_ID = process.env.WA_FROM_NUMBER_ID || '1317926468072324'

export const LINEA_WA_NUMERO = LINEAS[LINEA_WA_ID] || '+573159891247'

/** Número legible de una línea a partir de su phone_number_id (para auditar envíos). */
export function numeroDeLinea(phoneNumberId) {
  return LINEAS[phoneNumberId] || null
}

// ─── A quién le escribimos decide POR DÓNDE ──────────────────────────────────
// Una clínica y una familia no son el mismo público y no comparten número: la
// clínica habla con la línea de veterinarias (+57 318 096 7711) y la familia con
// la de Camino (+57 315 989 1247). Escribirle a la clínica por la de familias es
// mandarle un documento desde un número con el que nunca ha hablado, y si
// responde cae en una bandeja que no es la suya.
//
// La correspondencia público → agente es lo único que se fija aquí; la LÍNEA
// sale del dato (`agente_wa.phone_number_ids`), nunca de una constante: si
// mañana se le cambia el número a un agente desde Agentes IA, esto lo sigue sin
// desplegar. Mismo criterio que `lineaVeterinarias()` en recogidas-aviso.js.
const AGENTE_DE_PUBLICO = {
  CLIENTE:     'FAMILIAS',
  VETERINARIA: 'VETERINARIAS',
}

export const PUBLICOS_WA = Object.keys(AGENTE_DE_PUBLICO)

/**
 * La línea por la que se le habla a un público.
 *
 * 🩸 LANZA si no la encuentra, y es a propósito: el fallo que se vino a cerrar
 * es justamente el envío que sale calladito por la línea equivocada. Caer a
 * `LINEA_WA_ID` dejaría el recibo de la veterinaria saliendo otra vez por la de
 * familias sin un solo error en el log.
 *
 * @param {import('pg').Pool} pool  conexión (se pasa para no acoplar este
 *                                  módulo de constantes a db.js)
 * @param {'CLIENTE'|'VETERINARIA'} publico
 * @returns {Promise<string>} phone_number_id de Meta
 */
export async function lineaDePublico(pool, publico) {
  const clave = AGENTE_DE_PUBLICO[String(publico || '').toUpperCase()]
  if (!clave) throw new Error(`Público de WhatsApp desconocido: ${publico}`)

  const { rows: [a] } = await pool.query(
    `SELECT nombre, phone_number_ids
       FROM public.agente_wa WHERE clave = $1 LIMIT 1`,
    [clave]
  )
  if (!a) {
    throw new Error(`No existe el agente ${clave}: sin él no se sabe por qué línea escribirle a este destinatario.`)
  }
  const linea = (a.phone_number_ids || [])[0]
  if (!linea) {
    throw new Error(`El agente "${a.nombre}" no tiene ninguna línea asignada (Agentes IA → Ajustes).`)
  }
  return linea
}
