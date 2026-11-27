import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BOTONES, BOTONES_ENLACE, respuestaDeBoton, esBotonDeLaOferta, pct, precioConDescuento, ofertaVigente,
  estadosDeCategoria, avanzaPorFamilia, puedePasarCoordinacion,
  enlaceQrPropietario, normalizarSolicitudPreexequial, ReglaError,
} from '../orbit-backend/src/oferta-posterior-reglas.js'

// ── Botones de la plantilla ─────────────────────────────────────────────────

test('los botones caben en el tope de Meta (25) y no traen emojis ni saltos', () => {
  assert.equal(BOTONES.length, 4)
  for (const b of BOTONES) {
    assert.ok(b.length <= 25, `«${b}» mide ${b.length}`)
    assert.ok(/^[\p{L}\p{N} ]+$/u.test(b), `«${b}» trae algo que Meta rechaza`)
  }
})

test('plantilla con enlaces: 2 enlaces + «No deseo», sin tildes ni emojis y en el tope', () => {
  assert.equal(BOTONES_ENLACE.length, 3)
  for (const b of BOTONES_ENLACE) {
    assert.ok(b.length <= 25, `«${b}» mide ${b.length}`)
    assert.ok(/^[A-Za-z0-9 ]+$/.test(b), `«${b}» trae algo que Meta rechaza`)
  }
  // El único que vuelve al webhook es «No deseo…», y debe seguir dando de baja.
  assert.equal(esBotonDeLaOferta(BOTONES_ENLACE[2]), true)
  assert.equal(respuestaDeBoton(BOTONES_ENLACE[2]), 'NO_DESEA')
})

test('cada botón de la plantilla resuelve a su respuesta', () => {
  assert.deepEqual(BOTONES.map(respuestaDeBoton), ['RECORDATORIOS', 'PREEXEQUIALES', 'CEDULAS', 'NO_DESEA'])
})

test('tolera tildes, mayúsculas y emojis; lo ajeno no es de la oferta', () => {
  assert.equal(respuestaDeBoton('🐾 RECORDATORIOS ADICIONALES'), 'RECORDATORIOS')
  assert.equal(respuestaDeBoton('Cédulas para mascotas'), 'CEDULAS')
  assert.equal(respuestaDeBoton('🤍 No deseo recibir información'), 'NO_DESEA')
  assert.equal(respuestaDeBoton('No deseo información de recordatorios adicionales'), 'NO_DESEA')
  assert.equal(respuestaDeBoton('Bueno'), null)     // botón de la encuesta
  assert.equal(respuestaDeBoton('Malo'), null)
  assert.equal(respuestaDeBoton(''), null)
  assert.equal(respuestaDeBoton(null), null)
})

// ── Descuentos ──────────────────────────────────────────────────────────────

test('el porcentaje se acota: ni negativo ni regalar el catálogo', () => {
  assert.equal(pct(30), 30)
  assert.equal(pct('50'), 50)
  assert.equal(pct(-5), 0)
  assert.equal(pct(100), 90)
  assert.equal(pct('abc', 30), 30)
})

test('precio con descuento redondea a la centena y nunca sube', () => {
  assert.equal(precioConDescuento(100000, 30), 70000)
  assert.equal(precioConDescuento(26000, 50), 13000)
  assert.equal(precioConDescuento(37000, 30), 25900)
  assert.equal(precioConDescuento(33333, 30), 23300)
  assert.equal(precioConDescuento(26000, 0), 26000)
  assert.equal(precioConDescuento(0, 50), 0)
  assert.equal(precioConDescuento(null, 50), 0)
  for (const p of [1, 99, 150, 26000, 123456]) {
    assert.ok(precioConDescuento(p, 30) <= p)
  }
})

test('la oferta vence a los días de vigencia desde el envío', () => {
  const ahora = new Date('2026-12-20T15:00:00Z')
  assert.equal(ofertaVigente({ fechaEnvio: '2026-12-01T15:00:00Z', diasVigencia: 30, ahora }), true)
  assert.equal(ofertaVigente({ fechaEnvio: '2026-11-01T15:00:00Z', diasVigencia: 30, ahora }), false)
  assert.equal(ofertaVigente({ fechaEnvio: null, creadaEn: '2026-12-19T15:00:00Z', diasVigencia: 30, ahora }), true)
  assert.equal(ofertaVigente({ fechaEnvio: null, creadaEn: null, diasVigencia: 30, ahora }), false)
})

// ── Estados ─────────────────────────────────────────────────────────────────

test('pre-exequiales tiene los nueve estados del reporte más el cierre', () => {
  assert.deepEqual(estadosDeCategoria('PREEXEQUIALES'), [
    'INTERESADO', 'FORMULARIO_INICIADO', 'FORMULARIO_COMPLETO', 'PENDIENTE_PAGO',
    'PAGO_REPORTADO', 'PAGO_VALIDADO', 'PENDIENTE_CONTRATO', 'CONTRATO_GENERADO',
    'AFILIACION_ACTIVA', 'CERRADA_SIN_VENTA',
  ])
  assert.deepEqual(estadosDeCategoria('CEDULAS'),
    ['INTERESADO', 'FORMULARIO_INICIADO', 'COMPRA_REGISTRADA', 'CERRADA_SIN_VENTA'])
})

test('la familia solo avanza: reabrir el formulario no devuelve una solicitud completa', () => {
  assert.equal(avanzaPorFamilia('PREEXEQUIALES', 'INTERESADO', 'FORMULARIO_INICIADO'), true)
  assert.equal(avanzaPorFamilia('PREEXEQUIALES', 'FORMULARIO_COMPLETO', 'FORMULARIO_INICIADO'), false)
  assert.equal(avanzaPorFamilia('PREEXEQUIALES', 'PENDIENTE_PAGO', 'PAGO_REPORTADO'), true)
  assert.equal(avanzaPorFamilia('RECORDATORIOS', 'INTERESADO', 'COMPRA_REGISTRADA'), true)
  assert.equal(avanzaPorFamilia('RECORDATORIOS', 'COMPRA_REGISTRADA', 'FORMULARIO_INICIADO'), false)
})

test('la familia NUNCA valida su propio pago ni activa su contrato', () => {
  for (const e of ['PAGO_VALIDADO', 'PENDIENTE_CONTRATO', 'CONTRATO_GENERADO', 'AFILIACION_ACTIVA']) {
    assert.equal(avanzaPorFamilia('PREEXEQUIALES', 'PAGO_REPORTADO', e), false, e)
  }
})

test('una venta cerrada se reabre si la familia HACE algo, no por volver a mirar', () => {
  assert.equal(avanzaPorFamilia('CEDULAS', 'CERRADA_SIN_VENTA', 'FORMULARIO_INICIADO'), true)
  assert.equal(avanzaPorFamilia('PREEXEQUIALES', 'CERRADA_SIN_VENTA', 'FORMULARIO_COMPLETO'), true)
  // Abrir la página solo marca INTERESADO: eso NO borra el cierre de coordinación.
  assert.equal(avanzaPorFamilia('CEDULAS', 'CERRADA_SIN_VENTA', 'INTERESADO'), false)
  assert.equal(avanzaPorFamilia('PREEXEQUIALES', 'CERRADA_SIN_VENTA', 'INTERESADO'), false)
})

test('el webhook solo se queda con los cuatro textos EXACTOS de la plantilla', () => {
  for (const b of BOTONES) assert.equal(esBotonDeLaOferta(b), true, b)
  assert.equal(esBotonDeLaOferta('  recordatorios adicionales '), true)
  assert.equal(esBotonDeLaOferta('Cédulas para mascotas'), true)       // con tilde, por si Meta la devuelve
  // Parecidos de OTRA plantilla o de un menú del agente: no son de la oferta.
  assert.equal(esBotonDeLaOferta('No deseo recibir llamadas'), false)
  assert.equal(esBotonDeLaOferta('Cédula de mascota'), false)
  assert.equal(esBotonDeLaOferta('Plan preexequial Oro'), false)
  assert.equal(esBotonDeLaOferta('Bueno'), false)
  assert.equal(esBotonDeLaOferta(''), false)
  assert.equal(esBotonDeLaOferta(null), false)
})

test('coordinación no genera contrato ni activa la afiliación sin pago validado', () => {
  for (const e of ['PENDIENTE_CONTRATO', 'CONTRATO_GENERADO', 'AFILIACION_ACTIVA']) {
    assert.equal(puedePasarCoordinacion('PREEXEQUIALES', 'PAGO_REPORTADO', e).ok, false, e)
    assert.equal(puedePasarCoordinacion('PREEXEQUIALES', 'PAGO_VALIDADO', e, { pagoValidado: true }).ok, true, e)
  }
  assert.equal(puedePasarCoordinacion('PREEXEQUIALES', 'INTERESADO', 'CERRADA_SIN_VENTA').ok, true)
  assert.equal(puedePasarCoordinacion('CEDULAS', 'INTERESADO', 'PAGO_VALIDADO').ok, false)
  assert.equal(puedePasarCoordinacion('CEDULAS', 'INTERESADO', 'INTERESADO').ok, false)
})

test('«Compra registrada» sin compra con productos no se puede marcar a mano (REPORTE ORBIT 27-nov)', () => {
  for (const cat of ['RECORDATORIOS', 'CEDULAS']) {
    assert.equal(puedePasarCoordinacion(cat, 'INTERESADO', 'COMPRA_REGISTRADA').ok, false, cat)
    assert.equal(puedePasarCoordinacion(cat, 'FORMULARIO_INICIADO', 'COMPRA_REGISTRADA', { tieneCompra: true }).ok, true, cat)
  }
  // Cerrarla sin venta sigue permitido aunque no haya compra.
  assert.equal(puedePasarCoordinacion('RECORDATORIOS', 'INTERESADO', 'CERRADA_SIN_VENTA').ok, true)
})

// ── QR de la cédula ─────────────────────────────────────────────────────────

test('el QR abre WhatsApp con el dueño y un mensaje ya escrito', () => {
  const u = enlaceQrPropietario('+57 300 123 4567', 'Luna')
  assert.ok(u.startsWith('https://wa.me/573001234567?text='))
  assert.ok(decodeURIComponent(u).includes('encontré a Luna'))
  assert.ok(enlaceQrPropietario('3001234567').startsWith('https://wa.me/573001234567?text='))
})

test('sin un celular válido no hay QR (un QR a un número roto es peor que no tenerlo)', () => {
  assert.equal(enlaceQrPropietario('6012345678'), null)   // fijo
  assert.equal(enlaceQrPropietario('12345'), null)
  assert.equal(enlaceQrPropietario(''), null)
  assert.equal(enlaceQrPropietario(null), null)
})

// ── Solicitud pre-exequial ──────────────────────────────────────────────────

const OPC = { niveles: ['BRONCE', 'PLATA'], tipos: ['ANUAL'], especies: [{ id: 1 }, { id: 2 }] }
const BUENA = {
  plan: { nivel: 'plata', tipo: 'anual' },
  propietario: { nombre: ' Ana ', apellido: 'Ruiz', documento: '1.020.333', whatsapp: '300 123 4567',
                 email: 'ana@correo.com', direccion: 'Calle 1 # 2-3' },
  mascotas: [{ nombre: 'Toby', especie_id: '1', sexo: 'Macho', peso_kg: '12,5', edad: '3 años', raza: 'Criollo' }],
}

test('una solicitud completa queda limpia y sin precio (lo pone el backend)', () => {
  const s = normalizarSolicitudPreexequial(BUENA, OPC)
  assert.deepEqual(s.plan, { nivel: 'PLATA', tipo: 'ANUAL' })
  assert.equal(s.propietario.nombre, 'Ana')
  assert.equal(s.propietario.documento, '1020333')
  assert.equal(s.propietario.whatsapp, '3001234567')
  assert.equal(s.mascotas[0].peso_kg, 12.5)
  assert.equal(s.mascotas[0].especie_id, 1)
  assert.equal('valor' in s.plan, false)
})

test('rechaza un plan que no se ofrece, y lo que le falte a propietario o mascota', () => {
  const con = cambio => normalizarSolicitudPreexequial({ ...BUENA, ...cambio }, OPC)
  assert.throws(() => con({ plan: { nivel: 'DIAMANTE', tipo: 'ANUAL' } }), ReglaError)
  assert.throws(() => con({ plan: { nivel: 'PLATA', tipo: 'VITALICIO' } }), ReglaError)
  assert.throws(() => con({ propietario: { ...BUENA.propietario, documento: '' } }), /documento/)
  assert.throws(() => con({ propietario: { ...BUENA.propietario, whatsapp: '123' } }), /contacto/)
  assert.throws(() => con({ propietario: { ...BUENA.propietario, email: 'no-es-correo' } }), /correo/)
  assert.throws(() => con({ mascotas: [] }), /al menos una/)
  assert.throws(() => con({ mascotas: [{ ...BUENA.mascotas[0], especie_id: 99 }] }), /especie/)
  assert.throws(() => con({ mascotas: [{ ...BUENA.mascotas[0], peso_kg: 0 }] }), /peso/)
  assert.throws(() => con({ mascotas: [{ ...BUENA.mascotas[0], edad: '', fecha_nacimiento: '' }] }), /nacimiento/)
  assert.throws(() => con({ mascotas: Array(11).fill(BUENA.mascotas[0]) }), /Máximo/)
})
