// Reglas puras del AVISO AL TÉCNICO al asignarle un servicio (migr. 228) —
// sin base de datos ni Express, para probarlas con `node --test` desde la raíz
// del repo (tests/aviso-tecnico.test.mjs). aviso-tecnico.js las importa.
//
// REPORTE ORBIT 2026-11-26 (Tablero, urgencia crítica/alta): «una vez se asigne
// el servicio al técnico correspondiente, el sistema deberá enviarle
// automáticamente una notificación con toda la información necesaria para la
// ejecución del servicio».
//
// Decisiones de David (2026-11-27), no re-preguntar:
//  · Sale por WhatsApp, automático, por la LÍNEA DE VETERINARIAS (la misma del
//    aviso de hora a la clínica, migr. 154).
//  · Lleva el COBRO, igual que el botón manual «Notificar técnico» del Kanban:
//    los técnicos venían cobrando valores equivocados.
//  · Si el técnico responde, el agente de IA NO le contesta (ver
//    `esNumeroDelPersonal` en agente-wa.js); queda en la bandeja para coordinación.
//
// El texto es el mismo del botón manual (`notificarTecnico` en Kanban.jsx), que
// sigue existiendo como respaldo. Si cambia uno, revisar el otro.

/** Cuerpo EXACTO de la plantilla en Meta (huecos CON NOMBRE, parameter_format NAMED). */
export const CUERPO_PLANTILLA =
  'Hola {{tecnico}}, Camino al Cielo te asignó un servicio de recogida.\n\n' +
  'Mascota: {{mascota}}\n' +
  'Plan: {{plan}}\n' +
  'Propietario: {{propietario}}\n' +
  'Contacto en la recogida: {{contacto}}\n' +
  'Dirección: {{direccion}}\n' +
  'Hora aproximada: {{hora}}\n' +
  'Indicaciones: {{indicaciones}}\n' +
  'Cobro: {{cobro}}\n\n' +
  'Revisa el detalle completo en la app de Orbit. Este mensaje es automático: ' +
  'cualquier novedad, avísale a coordinación.'

/** Huecos de la plantilla, en orden. Cerrado: una clave inventada llegaría vacía. */
export const VARS = ['tecnico', 'mascota', 'plan', 'propietario', 'contacto', 'direccion', 'hora', 'indicaciones', 'cobro']

/** Ejemplos para crear la plantilla en Meta (los pide para aprobarla). */
export const EJEMPLOS = {
  tecnico: 'Sebastián', mascota: 'Luna (Perro)', plan: 'Standard', propietario: 'Ana Pérez',
  contacto: 'Ana Pérez 3001234567', direccion: 'Cra 7 # 45-10, Chapinero, Bogotá', hora: '3:00 p. m.',
  indicaciones: 'Portería, apartamento 402', cobro: '$350.000 · Medio acordado: NEQUI',
}

export const CONFIG_DEFAULTS = {
  // Apagado por defecto: un despliegue no puede ponerse a escribirle solo al
  // personal, y la plantilla puede no estar aprobada todavía.
  activo:    false,
  plantilla: null,
}

function safeJson(s) { try { return JSON.parse(s) } catch { return null } }

/** Normaliza la plantilla de config. `null` → quien llama NO envía. */
export function plantillaAviso(cfg = {}) {
  const raw = cfg.plantilla
  const p = typeof raw === 'string' ? safeJson(raw) : raw
  if (!p || !p.nombre) return null
  return { nombre: p.nombre, idioma: p.idioma || 'es_MX', categoria: p.categoria || 'UTILITY' }
}

export const activo = cfg => cfg.activo === true || cfg.activo === 'true'

/**
 * Meta rechaza un parámetro con saltos de línea, tabulaciones o más de 4
 * espacios seguidos, y también uno VACÍO. Todo valor pasa por aquí.
 */
export function paraMeta(v, porDefecto = '—', max = 300) {
  const s = String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
  if (!s) return porDefecto
  return s.length > max ? `${s.slice(0, max - 1).trim()}…` : s
}

/** $350.000 — mismo aspecto que el resto de mensajes del backend. */
export const pesos = n => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`

const RE_HORA = /Hora aprox\. recogida:\s*([^.]+)/i

/** La hora que escribió coordinación al registrar («Hora aprox. recogida: X»). */
export function horaAproximada(...textos) {
  for (const t of textos) {
    const m = String(t || '').match(RE_HORA)
    if (m?.[1]?.trim()) return m[1].trim()
  }
  return ''
}

/** Las indicaciones sin la hora, que ya va en su propio renglón. */
export function indicacionesSinHora(t) {
  return String(t || '').replace(/Hora aprox\. recogida:[^.]*\.?\s*/i, '').replace(/^[.\s]+|[.\s]+$/g, '').trim()
}

/**
 * COPIA de `comisionInconsistente` (src/lib/precios.js). El backend corre en
 * su propio contenedor y no puede importar el frontend: si cambia allá, cambia
 * aquí. ¿`valor_total` y `comision_descontada` se contradicen? Con el par roto,
 * reconstruir el bruto le SUMARÍA la comisión al cliente (caso BRUNO 07-08-2026).
 */
export function comisionInconsistente(svc) {
  if (!svc || svc.comision_descontada !== true) return false
  const comision = Number(svc.comision_aliado) || 0
  if (!(comision > 0)) return false
  const plan = Number(svc.valor_plan)
  if (!(plan > 0)) return false
  const descuento = Number(svc.descuento_adicional) || 0
  const extras = (Number(svc.valor_adicionales) || 0) + (Number(svc.valor_transporte) || 0)
               + (Number(svc.recargo_nocturno)  || 0)
               - (Math.abs(descuento - comision) < 0.5 ? 0 : descuento)
  const total = (Number(svc.valor_total) || 0) - (Number(svc.valor_eutanasia) || 0)
  return total >= plan + extras - 0.5
}

/**
 * Cuánto debe cobrar, en UNA línea (la plantilla no admite saltos). Misma
 * cuenta que `notificarTecnico` del Kanban: el saldo se DERIVA de
 * valor_total − valor_pagado, nunca de `estado_pago` (marca que se queda vieja).
 * Con la comisión ya descontada, la vet paga el neto y el cliente el bruto.
 */
export function textoCobro(svc = {}) {
  const total    = Number(svc.valor_total) || 0
  const pagado   = Number(svc.valor_pagado) || 0
  const comision = Number(svc.comision_aliado) || 0
  if (!(total > 0)) return 'Sin valor registrado en Orbit: confirma con coordinación antes de cobrar.'

  const bruto = (svc.comision_descontada === true && comision > 0 && !comisionInconsistente(svc))
    ? total + comision : total
  const vet = Math.max(0, Math.round(total - pagado))
  const cli = Math.max(0, Math.round(bruto - pagado))

  const partes = []
  if (pagado > 0) partes.push(`Ya abonado ${pesos(pagado)}`)
  if (vet <= 0 && cli <= 0) {
    partes.push('NO debe cobrar: el servicio ya está pagado')
  } else if (cli !== vet) {
    partes.push(`Al cliente ${pesos(cli)}`)
    partes.push(`a la veterinaria ${pesos(vet)} (ya con su descuento)`)
  } else {
    partes.push(`Cobrar ${pesos(vet)}`)
  }
  const medio = String(svc.metodo_pago || '').trim().toUpperCase()
  if (cli > 0 && medio && medio !== 'PENDIENTE') partes.push(`Medio acordado: ${medio}`)
  if (cli > 0) partes.push('verifica el monto en la app antes de guardar el recibo')
  return partes.join(' · ')
}

/** Un número sirve si tiene al menos 10 dígitos (mismo criterio que el aviso a la vet). */
export function validoWa(v) {
  const s = String(v || '').trim()
  return s.replace(/\D/g, '').length >= 10 ? s : null
}

const nombrePropio = s => String(s || '').trim().toLowerCase()
  .replace(/(^|[\s-])(\p{L})/gu, (_, sep, l) => sep + l.toUpperCase())

/**
 * Los valores de cada hueco a partir de la fila que arma aviso-tecnico.js.
 * Todos pasan por `paraMeta`: ninguno puede llegar vacío ni con saltos.
 */
export function valoresAviso(d = {}) {
  const propietario = [d.cliente_nombre, d.cliente_apellido].filter(Boolean).join(' ')
  const telCliente  = d.cliente_whatsapp || d.cliente_telefono || ''
  const contacto = d.contacto_nombre || d.contacto_telefono
    ? [d.contacto_nombre, d.contacto_telefono].filter(Boolean).join(' ')
    : [propietario, telCliente].filter(Boolean).join(' ')
  const direccion = [d.direccion_recogida, d.barrio_recogida, d.ciudad_recogida]
    .map(x => String(x || '').trim()).filter(Boolean).join(', ')
  const mascota = d.mascota
    ? `${nombrePropio(d.mascota)}${d.especie ? ` (${d.especie})` : ''}` : ''

  return {
    tecnico:      paraMeta(String(d.tecnico_nombre || '').trim().split(/\s+/)[0], 'compañero'),
    mascota:      paraMeta(mascota, 'por confirmar'),
    plan:         paraMeta(d.plan, 'por confirmar'),
    propietario:  paraMeta(nombrePropio(propietario), 'por confirmar'),
    contacto:     paraMeta(contacto, 'por confirmar'),
    direccion:    paraMeta(direccion, 'por confirmar'),
    hora:         paraMeta(horaAproximada(d.recogida_notas, d.indicaciones_recogida, d.notas), 'por confirmar con coordinación'),
    indicaciones: paraMeta(indicacionesSinHora(d.recogida_notas || d.indicaciones_recogida), 'ninguna'),
    cobro:        paraMeta(textoCobro(d), '—', 400),
  }
}

/** El mensaje como quedaría en el WhatsApp (para la bitácora y las pruebas). */
export function mensajeCompleto(valores) {
  return CUERPO_PLANTILLA.replace(/\{\{(\w+)\}\}/g, (_, k) => valores[k] ?? '')
}
