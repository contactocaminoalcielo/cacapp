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
  '967346343135405': '+573159891247',   // Camino al Cielo — la única válida para clientes
  '1313164878540238': '+573180967711',  // veterinarias
  '934074529797267': '+573181057685',   // HoyFarma (otra empresa)
  '894547387070615': '+573189864595',
}

// Override por entorno solo para poder corregir sin redesplegar si Meta reasigna el id.
export const LINEA_WA_ID = process.env.WA_FROM_NUMBER_ID || '967346343135405'

export const LINEA_WA_NUMERO = LINEAS[LINEA_WA_ID] || '+573159891247'

/** Número legible de una línea a partir de su phone_number_id (para auditar envíos). */
export function numeroDeLinea(phoneNumberId) {
  return LINEAS[phoneNumberId] || null
}
