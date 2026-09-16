// Datos de entrega que deja la familia en un portal público.
//
// Vive aquí y no dentro de un portal porque lo escriben DOS puertas distintas:
// la solicitud de imágenes (`imagenes.js`) y la elección de planta
// (`plantas.js`). Cuando eran dos copias del mismo saneador, cualquier campo
// nuevo entraba por una puerta y se perdía por la otra sin un solo error.
//
// Es prefill/sugerencia de la familia, NO la entrega confirmada: la entrega la
// arma coordinación en ModalPreparaEntrega con estos datos como punto de
// partida.

/**
 * Núcleo obligatorio cuando hay algo físico que entregar. Barrio, localidad,
 * teléfono adicional y horarios siguen siendo opcionales: sin dirección, sin
 * quién recibe y sin un teléfono, el mensajero no puede salir.
 */
export const CAMPOS_ENTREGA_REQ = ['direccion', 'recibe', 'telefono']

/**
 * Sanea lo que manda el navegador: solo campos conocidos, recortados. Devuelve
 * null si la familia no llenó nada (así el COALESCE del UPDATE no pisa con
 * vacío lo que ya había).
 */
export function sanitizarEntrega(e) {
  if (!e || typeof e !== 'object') return null
  const txt = (v, max = 300) => {
    const s = (v == null ? '' : String(v)).trim()
    return s ? s.slice(0, max) : null
  }
  const out = {
    direccion:          txt(e.direccion),
    barrio:             txt(e.barrio, 120),
    localidad:          txt(e.localidad, 120),
    recibe:             txt(e.recibe, 120),
    telefono:           txt(e.telefono, 40),
    telefono_adicional: txt(e.telefono_adicional, 40),
    horarios:           txt(e.horarios, 300),
  }
  return Object.values(out).some(Boolean) ? out : null
}

/** ¿Trae el núcleo completo? Se evalúa SOBRE lo ya saneado, no sobre el crudo. */
export function entregaNucleoOk(entrega) {
  return !!entrega && CAMPOS_ENTREGA_REQ.every(k => !!entrega[k])
}
