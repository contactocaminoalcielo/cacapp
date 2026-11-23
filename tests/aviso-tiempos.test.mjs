import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CUERPO_PLANTILLA, reglas, plantillaAviso, plazo, notaMemopet, textoTiempos, mensajeCompleto,
} from '../orbit-backend/src/aviso-tiempos-reglas.js'

const R = reglas()
const base = { diasPlan: 8, fotosRecibidas: false, anticipados: null, enlaceEnviado: false, diasMemopet: null }

// Meta rechaza en una variable: saltos de línea, tabulaciones y más de 4 espacios seguidos.
const valeParaMeta = s => !/[\n\t]| {5,}/.test(s)

test('eco-grupal: certificado a 3 días y recordatorios a 8 a 10 desde las fotos', () => {
  const t = textoTiempos({ ...base, plan: 'ECO_GRUPAL', tipoProceso: 'COMPOSTAJE_GRUPAL' }, R)
  assert.match(t, /certificado estará listo en 3 días hábiles a partir de la recogida/)
  assert.match(t, /Pronto te enviaremos/)
  assert.match(t, /de 8 a 10 días hábiles después de recibir las fotos/)
  assert.doesNotMatch(t, /compostaje toma/)   // el eco-grupal NO es compostaje individual
  assert.ok(valeParaMeta(t))
})

test('básico con Memopet: menciona sus 15 días; sin Memopet no', () => {
  const con = textoTiempos({ ...base, plan: 'BASICO', tipoProceso: 'CREMACION_GRUPAL', diasMemopet: 15 }, R)
  assert.match(con, /de 8 a 10 días hábiles \(el Memopet, 15 días hábiles\)/)
  const sin = textoTiempos({ ...base, plan: 'BASICO', tipoProceso: 'CREMACION_GRUPAL' }, R)
  assert.doesNotMatch(sin, /Memopet/)
})

test('el Memopet solo se nombra si tarda más que el tope del plazo', () => {
  assert.equal(notaMemopet(8, 10), '')
  assert.equal(notaMemopet(8, 11), ' (el Memopet, 11 días hábiles)')
  assert.equal(notaMemopet(8, null), '')
  // Aviso de plazo: «es de {{2}} días hábiles» → la nota va sin la unidad.
  assert.equal('8 a 10' + notaMemopet(8, 15, false), '8 a 10 (el Memopet, 15)')
})

test('Desamparado, Ángel y básico sin recordatorios: solo el certificado', () => {
  for (const plan of ['DESAMPARADO', 'ANGEL', 'BASICO_SIN_REC']) {
    const t = textoTiempos({ ...base, plan, tipoProceso: 'CREMACION_GRUPAL' }, R)
    assert.match(t, /^📄 El certificado estará listo en 3 días hábiles a partir de la recogida\.$/, plan)
  }
})

test('Premium y Exclusivo: sin certificado (es por solicitud), con recordatorios', () => {
  for (const plan of ['PREMIUM', 'EXCLUSIVO_VIDEOLLAMADA', 'EXCLUSIVO_PRESENCIAL']) {
    const t = textoTiempos({ ...base, plan, tipoProceso: 'CREMACION_INDIVIDUAL' }, R)
    assert.doesNotMatch(t, /certificado/, plan)
    assert.match(t, /de 8 a 10 días hábiles/, plan)
  }
})

test('Compets evidencia: 2 a 3 meses, recordatorios antes si los pide, sin certificado', () => {
  const t = textoTiempos({ ...base, plan: 'COMPETS_EVIDENCIA', tipoProceso: 'COMPOSTAJE_INDIVIDUAL' }, R)
  assert.match(t, /compostaje toma de 2 a 3 meses/)
  assert.match(t, /si deseas recibirlos antes de que termine el compostaje, estarán listos de 8 a 10/)
  assert.match(t, /junto con la planta/)
  assert.doesNotMatch(t, /certificado/)
})

test('Compets sin recordatorios: solo el compostaje y la planta', () => {
  const t = textoTiempos({ ...base, plan: 'COMPETS_SIN_REC', tipoProceso: 'COMPOSTAJE_INDIVIDUAL' }, R)
  assert.equal(t, '🌱 El proceso de compostaje toma de 2 a 3 meses; al finalizar te entregaremos la planta.')
})

test('si ya mandó las fotos no se le pide el enlace', () => {
  const t = textoTiempos({ ...base, plan: 'STANDARD', tipoProceso: 'CREMACION_GRUPAL', fotosRecibidas: true }, R)
  assert.match(t, /Ya recibimos tus fotos; los recordatorios estarán listos de 8 a 10 días hábiles desde que las recibimos/)
  assert.doesNotMatch(t, /enlace/)
  // Compostaje que los recibe al final: no se le promete fecha.
  const c = textoTiempos({ ...base, plan: 'COMPETS_PRESENCIAL', tipoProceso: 'COMPOSTAJE_INDIVIDUAL', fotosRecibidas: true }, R)
  assert.match(c, /junto con la planta\.$/)
  assert.doesNotMatch(c, /8 a 10/)
})

test('si el enlace ya salió, dice «ya te enviamos»', () => {
  const t = textoTiempos({ ...base, plan: 'BASICO', tipoProceso: 'CREMACION_GRUPAL', enlaceEnviado: true }, R)
  assert.match(t, /Ya te enviamos por este medio el enlace/)
})

test('plan fuera de las listas (exclusivo sin recordatorios) no tiene nada que contar', () => {
  const r = reglas({ planes_sin_recordatorios: [...R.sinRecordatorios, 'EXCLUSIVO_VIDEOLLAMADA_SIN_REC'] })
  assert.equal(textoTiempos({ ...base, plan: 'EXCLUSIVO_VIDEOLLAMADA_SIN_REC', tipoProceso: 'CREMACION_INDIVIDUAL' }, r), '')
  assert.ok(!R.planes.includes('EXCLUSIVO_VIDEOLLAMADA_SIN_REC'))
})

test('el texto más largo cabe en el tope de Meta (1024 con la plantilla)', () => {
  const t = textoTiempos({ ...base, plan: 'COMPETS_EVIDENCIA', tipoProceso: 'COMPOSTAJE_INDIVIDUAL', enlaceEnviado: true, diasMemopet: 15 }, R)
  const m = mensajeCompleto('Runa Antonio Del Carmen', t)
  assert.ok(m.length < 1024, `mide ${m.length}`)
  assert.ok(valeParaMeta(t))
})

test('la plantilla tiene exactamente {{1}} y {{2}} y no empieza ni termina en variable', () => {
  assert.deepEqual(CUERPO_PLANTILLA.match(/\{\{\d\}\}/g), ['{{1}}', '{{2}}'])
  assert.ok(!/^\{\{|\}\}$/.test(CUERPO_PLANTILLA.trim()))
})

test('config: listas como texto JSON, topes acotados y plantilla vacía = no enviar', () => {
  const r = reglas({ planes: '["BASICO"]', max_envios_por_corrida: 9999, dias_certificado: '"5"', activo: 'true' })
  assert.deepEqual(r.planes, ['BASICO'])
  assert.equal(r.tope, 100)
  assert.equal(r.diasCertificado, 5)
  assert.equal(r.activo, true)
  assert.equal(plantillaAviso({ plantilla: null }), null)
  assert.deepEqual(plantillaAviso({ plantilla: '{"nombre":"x"}' }), { nombre: 'x', idioma: 'es_MX', categoria: 'UTILITY' })
  assert.equal(plazo(20), '20 a 22')
})
