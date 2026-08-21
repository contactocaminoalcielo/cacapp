// Prueba del oído SIN llamada: se le da PCM sintético y se comprueba que el
// turno se cierra. Los tres casos son los tres que dejaban al agente mudo.
import { Oido } from '../src/llamadas.js'
import { esRuido } from '../src/voz-conversacion.js'

const TROZO = 1920                                   // 20 ms a 48 kHz, 16 bits
const pcm = (amplitud) => {
  const b = Buffer.alloc(TROZO)
  for (let i = 0; i < TROZO; i += 2) b.writeInt16LE(Math.round(Math.sin(i) * amplitud * 32767), i)
  return b
}
const VOZ = pcm(0.2), RUIDO_BAJO = pcm(0.001), RUIDO_ALTO = pcm(0.05)

function caso(nombre, guion, esperado, espera = 1600) {
  return new Promise(ok => {
    let cerrado = null
    const oido = new Oido({ alTerminarDeHablar: (_p, corte) => { cerrado = corte } })
    Promise.resolve(guion(oido))
    setTimeout(() => {
      oido.parar()
      const bien = cerrado?.motivo === esperado
      console.log(`${bien ? '✓' : '✗'} ${nombre}: ${cerrado ? `cerró por "${cerrado.motivo}" con ${cerrado.ms} ms` : 'NO CERRÓ'} (se esperaba "${esperado}")`)
      ok(bien)
    }, espera)
  })
}

const alimentarDurante = (oido, trozo, ms) => {
  for (let i = 0; i < ms / 20; i++) oido.alimentar(trozo)
}

/**
 * Lo mismo pero a RITMO REAL: un trozo cada 20 ms de reloj de verdad.
 *
 * Hace falta para el corte por silencio: mide con `Date.now()`, así que mil
 * trozos metidos en el mismo milisegundo son, para él, cero tiempo callado.
 */
const alimentarEnVivo = async (oido, trozo, ms) => {
  for (let i = 0; i < ms / 20; i++) {
    oido.alimentar(trozo)
    await new Promise(r => setTimeout(r, 20))
  }
}

const r = []
// 1. Ruido de fondo por encima del umbral, sin parar: antes NO cerraba nunca.
r.push(await caso('ruido continuo sobre el umbral', o => alimentarDurante(o, RUIDO_ALTO, 20_000), 'tope'))
// 2. Habla y luego calla, con audio siguiendo: el camino de siempre.
r.push(await caso('habla y calla', async o => {
  alimentarDurante(o, VOZ, 1200)
  await alimentarEnVivo(o, RUIDO_BAJO, 1400)
}, 'silencio', 2500))
// 3. Habla y el audio DEJA DE LLEGAR (colgó, o DTX): antes se quedaba colgado.
r.push(await caso('habla y se corta el audio', o => alimentarDurante(o, VOZ, 1200), 'reloj'))

// ── Interrumpir al agente mientras habla (barge-in) ───────────────────────
//
// Lo delicado no es oír, es distinguir: mientras el agente habla, por la línea
// entra sobre todo SU PROPIO ECO. Un listón fijo lo toma por una persona y el
// agente se interrumpe a sí mismo en bucle.
const ECO = pcm(0.02)          // el agente oyéndose a sí mismo
const PERSONA = pcm(0.25)      // alguien hablando encima, claramente más alto

async function casoInterrupcion(nombre, guion, esperado) {
  let interrumpio = false
  const oido = new Oido({
    alTerminarDeHablar: () => {},
    alInterrumpir: () => { interrumpio = true },
  })
  oido.sordo = true            // el agente está hablando
  await guion(oido)
  oido.parar()
  const bien = interrumpio === esperado
  console.log(`${bien ? '✓' : '✗'} ${nombre}: ${interrumpio ? 'interrumpió' : 'no interrumpió'}`
    + ` (se esperaba que ${esperado ? 'sí' : 'no'})`)
  return bien
}

r.push(await casoInterrupcion('el eco del propio agente NO le interrumpe', async o => {
  await alimentarEnVivo(o, ECO, 1500)
}, false))

r.push(await casoInterrupcion('una voz clara y sostenida SÍ le interrumpe', async o => {
  alimentarDurante(o, ECO, 1000)                 // primero mide su eco
  await alimentarEnVivo(o, PERSONA, 700)
}, true))

r.push(await casoInterrupcion('un golpe corto NO le interrumpe', async o => {
  alimentarDurante(o, ECO, 1000)
  await alimentarEnVivo(o, PERSONA, 200)
  await alimentarEnVivo(o, ECO, 400)
}, false))

const casosRuido = [
  ['Gracias. Gracias. Gracias. Gracias.', 20000, true],
  ['Gracias.', 800, false],
  ['Gracias.', 9000, true],
  ['Quisiera información sobre los planes.', 3000, false],
  ['Subtítulos realizados por la comunidad de Amara.org', 12000, true],
  ['No.', 700, false],
  ['', 5000, true],
]
for (const [texto, ms, esp] of casosRuido) {
  const got = esRuido(texto, ms)
  r.push(got === esp)
  console.log(`${got === esp ? '✓' : '✗'} esRuido("${texto}", ${ms}ms) = ${got}`)
}

console.log(r.every(Boolean) ? '\nTODO BIEN' : '\nHAY FALLOS')
process.exit(r.every(Boolean) ? 0 : 1)
