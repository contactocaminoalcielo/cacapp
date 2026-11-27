import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CUERPO_PLANTILLA, VARS, EJEMPLOS, plantillaAviso, activo, paraMeta, textoCobro,
  horaAproximada, indicacionesSinHora, valoresAviso, mensajeCompleto, comisionInconsistente,
} from '../orbit-backend/src/aviso-tecnico-reglas.js'

// Meta rechaza en una variable: saltos de línea, tabulaciones, más de 4 espacios seguidos y vacío.
const valeParaMeta = s => typeof s === 'string' && s.trim() !== '' && !/[\n\t]| {5,}/.test(s)

test('la plantilla usa exactamente los huecos de VARS y hay ejemplo para cada uno', () => {
  const huecos = [...CUERPO_PLANTILLA.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1])
  assert.deepEqual(huecos, VARS)
  VARS.forEach(v => assert.ok(valeParaMeta(EJEMPLOS[v]), v))
})

test('config: sin plantilla no se envía; activo acepta true y "true"', () => {
  assert.equal(plantillaAviso({}), null)
  assert.deepEqual(plantillaAviso({ plantilla: '{"nombre":"asignacion_tecnico"}' }),
    { nombre: 'asignacion_tecnico', idioma: 'es_MX', categoria: 'UTILITY' })
  assert.equal(activo({ activo: 'true' }), true)
  assert.equal(activo({ activo: false }), false)
})

test('cobro simple con medio acordado', () => {
  assert.equal(textoCobro({ valor_total: 350000, valor_pagado: 0, metodo_pago: 'nequi' }),
    'Cobrar $350.000 · Medio acordado: NEQUI · verifica el monto en la app antes de guardar el recibo')
})

test('ya pagado: NO debe cobrar y no menciona el medio', () => {
  const t = textoCobro({ valor_total: 350000, valor_pagado: 350000, metodo_pago: 'NEQUI' })
  assert.equal(t, 'Ya abonado $350.000 · NO debe cobrar: el servicio ya está pagado')
})

test('abono parcial: dice lo abonado y el saldo', () => {
  assert.match(textoCobro({ valor_total: 350000, valor_pagado: 100000 }), /^Ya abonado \$100\.000 · Cobrar \$250\.000/)
})

test('comisión descontada: al cliente el bruto, a la vet el neto', () => {
  const svc = { valor_total: 300000, valor_plan: 350000, comision_aliado: 50000, comision_descontada: true, valor_pagado: 0 }
  assert.equal(comisionInconsistente(svc), false)
  assert.match(textoCobro(svc), /^Al cliente \$350\.000 · a la veterinaria \$300\.000 \(ya con su descuento\)/)
})

test('par roto (caso BRUNO): valor_total ya es el bruto → una sola cifra, sin inflar', () => {
  const svc = { valor_total: 350000, valor_plan: 350000, comision_aliado: 50000, comision_descontada: true, valor_pagado: 0 }
  assert.equal(comisionInconsistente(svc), true)
  assert.match(textoCobro(svc), /^Cobrar \$350\.000/)
})

test('sin valor: pide confirmar con coordinación', () => {
  assert.match(textoCobro({ valor_total: 0 }), /confirma con coordinación/)
})

test('hora: se saca de las notas; las indicaciones quedan sin ella', () => {
  const notas = 'Hora aprox. recogida: 3:00 pm. Portería, apto 402'
  assert.equal(horaAproximada(null, notas), '3:00 pm')
  assert.equal(indicacionesSinHora(notas), 'Portería, apto 402')
  assert.equal(horaAproximada('', null), '')
})

test('paraMeta: quita saltos y espacios, nunca vacío, recorta lo largo', () => {
  assert.equal(paraMeta('a\n\nb\t  c'), 'a b c')
  assert.equal(paraMeta('   '), '—')
  assert.equal(paraMeta('x'.repeat(500)).length, 300)
})

test('valores completos: todos válidos para Meta; el contacto cae al propietario', () => {
  const v = valoresAviso({
    tecnico_nombre: 'Sebastián Gómez', mascota: 'LUNA', especie: 'Perro', plan: 'Standard',
    cliente_nombre: 'ANA', cliente_apellido: 'PÉREZ', cliente_whatsapp: '3001234567',
    direccion_recogida: 'Cra 7 # 45-10', barrio_recogida: 'Chapinero', ciudad_recogida: 'Bogotá',
    recogida_notas: 'Hora aprox. recogida: 3:00 pm. Portería\napto 402',
    valor_total: 350000, valor_pagado: 0, metodo_pago: 'EFECTIVO',
  })
  VARS.forEach(k => assert.ok(valeParaMeta(v[k]), `${k}: ${JSON.stringify(v[k])}`))
  assert.equal(v.tecnico, 'Sebastián')
  assert.equal(v.mascota, 'Luna (Perro)')
  assert.equal(v.propietario, 'Ana Pérez')
  assert.equal(v.contacto, 'ANA PÉREZ 3001234567')
  assert.equal(v.direccion, 'Cra 7 # 45-10, Chapinero, Bogotá')
  assert.equal(v.hora, '3:00 pm')
  assert.equal(v.indicaciones, 'Portería apto 402')
  const msg = mensajeCompleto(v)
  assert.doesNotMatch(msg, /\{\{/)
  assert.match(msg, /Cobro: Cobrar \$350\.000 · Medio acordado: EFECTIVO/)
})

test('valores vacíos: nada llega vacío a Meta', () => {
  const v = valoresAviso({})
  VARS.forEach(k => assert.ok(valeParaMeta(v[k]), k))
  assert.equal(v.contacto, 'por confirmar')
  assert.equal(v.indicaciones, 'ninguna')
})

test('con contacto de recogida (clínica), manda ese y no el del propietario', () => {
  const v = valoresAviso({ contacto_nombre: 'Clínica Vet Norte', contacto_telefono: '6011234567', cliente_nombre: 'Ana', cliente_whatsapp: '3001234567' })
  assert.equal(v.contacto, 'Clínica Vet Norte 6011234567')
})
