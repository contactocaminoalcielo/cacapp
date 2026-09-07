import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

async function asistente({ filas, errorIA = false, errorSQL = false }) {
  let liberaciones = 0
  const cliente = {
    query: async () => { if (errorSQL) throw new Error('SQL'); return { rows: filas } },
    release: () => { liberaciones++ },
  }
  const dependencias = {
    './db.js': { pool: { connect: async () => cliente } },
    './ia.js': { llamarClaude: async () => {
      assert.equal(liberaciones, 1, 'La conexión debe estar libre ANTES de esperar a IA')
      if (errorIA) throw new Error('IA')
      return 'Respuesta simulada'
    } },
    './reglas-grupales.js': { cargarConfigGrupales: async () => ({ sla_dias_habiles: 3 }) },
  }
  const modulo = new vm.SourceTextModule(await readFile(new URL('../orbit-backend/src/grupales-ia.js', import.meta.url), 'utf8'))
  await modulo.link(specifier => {
    const valores = dependencias[specifier]
    return new vm.SyntheticModule(Object.keys(valores), function () {
      for (const [k, v] of Object.entries(valores)) this.setExport(k, v)
    })
  })
  await modulo.evaluate()
  return { modulo: modulo.namespace, liberaciones: () => liberaciones }
}

test('redacción libera la conexión antes de IA y solo una vez', async () => {
  const a = await asistente({ filas: [{ mascota_nombre: 'Prueba', propietario_nombre: 'Prueba', numero_lote: 1, tipo_proceso: 'CREMACION_GRUPAL' }] })
  const r = await a.modulo.redactarMensaje({ itemId: 'solo-prueba' })
  assert.equal(r.mensaje, 'Respuesta simulada')
  assert.equal(a.liberaciones(), 1)
})

test('un fallo de IA no libera dos veces la conexión', async () => {
  const a = await asistente({ filas: [{ numero_lote: 1 }], errorIA: true })
  await assert.rejects(a.modulo.resumenPendientes(), /IA/)
  assert.equal(a.liberaciones(), 1)
})

test('un fallo SQL o una salida sin resultados también libera', async () => {
  const a = await asistente({ filas: [], errorSQL: true })
  await assert.rejects(a.modulo.resumenPendientes(), /SQL/)
  assert.equal(a.liberaciones(), 1)
  const b = await asistente({ filas: [] })
  assert.equal((await b.modulo.redactarMensaje({ itemId: 'prueba' })).mensaje, '')
  assert.equal(b.liberaciones(), 1)
})
