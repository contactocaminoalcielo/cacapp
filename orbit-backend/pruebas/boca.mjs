// Prueba de la BOCA: que la llamada sea UNA sola pista de audio.
//
// 🩸 Esto es lo que hacía que la muletilla no se oyera: cada cosa que decía el
// agente estrenaba SSRC, numeración y reloj, y el receptor tiraba el principio
// mientras resincronizaba. Lo que se comprueba aquí es justo eso: que entre dos
// cosas dichas con una pausa en medio no cambie la fuente, la numeración siga
// donde iba, y el reloj haya avanzado LA PAUSA.
//
// Necesita ffmpeg y werift, así que corre dentro del contenedor:
//   docker cp orbit-backend/pruebas/boca.mjs orbit-backend:/app/ && docker exec orbit-backend node /app/boca.mjs
import { Boca } from './src/llamadas.js'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'

/** Un pitido de N ms, sin gastar créditos de ElevenLabs. */
const pitido = (ms, salida) => new Promise((ok, mal) => execFile('ffmpeg',
  ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
   '-i', `sine=frequency=440:duration=${ms / 1000}`, '-ar', '48000', '-ac', '1', salida],
  e => e ? mal(e) : ok()))

const pista = { paquetes: [], writeRtp(p) { this.paquetes.push(p) } }

await pitido(400, '/tmp/p1.wav')
await pitido(400, '/tmp/p2.wav')
const a1 = await readFile('/tmp/p1.wav')
const a2 = await readFile('/tmp/p2.wav')

const boca = new Boca(pista, 111)
await boca.decir(a1)
const corte = pista.paquetes.length
await new Promise(r => setTimeout(r, 1000))        // la pausa que antes rompía el reloj
await boca.decir(a2)

const p = pista.paquetes
const cab = i => p[i].header
const fallos = []
const mira = (bien, texto) => { console.log(`${bien ? '✓' : '✗'} ${texto}`); if (!bien) fallos.push(texto) }

mira(p.length > 30, `salieron ${p.length} paquetes (${corte} + ${p.length - corte})`)
mira(new Set(p.map(x => x.header.ssrc)).size === 1, 'una sola fuente (SSRC) en toda la llamada')

let seguidos = true
for (let i = 1; i < p.length; i++) {
  if (cab(i).sequenceNumber !== ((cab(i - 1).sequenceNumber + 1) & 0xffff)) seguidos = false
}
mira(seguidos, 'la numeración no salta en ningún punto, tampoco en la pausa')

// 1 s de pausa a 48 kHz son 48.000 muestras. Se permite holgura por el redondeo
// a tramas de 20 ms y por lo que tarde ffmpeg.
const salto = (cab(corte).timestamp - cab(corte - 1).timestamp) >>> 0
mira(salto > 40_000 && salto < 75_000,
  `el reloj avanzó la pausa: ${salto} muestras (~${Math.round(salto / 48)} ms)`)
mira(cab(corte).marker === true, 'la segunda locución va marcada como arranque tras silencio')

// Y que callar corte de verdad, EN MITAD de la frase — que es lo que pasa
// cuando alguien interrumpe al agente. Se espera a que empiece a sonar de
// verdad (ffmpeg tarda lo suyo) para no probar un corte que ocurre antes de
// que hubiera nada que cortar.
await pitido(3000, '/tmp/p3.wav')
const boca2 = new Boca({ paquetes: [], writeRtp(x) { this.paquetes.push(x) } }, 111)
const largo = boca2.decir(await readFile('/tmp/p3.wav'))
while (boca2.pista.paquetes.length < 10) await new Promise(r => setTimeout(r, 20))
const alCortar = boca2.pista.paquetes.length
boca2.callar()
await largo
const total = boca2.pista.paquetes.length
mira(total >= 10 && total < 150,
  `callar() corta a media frase: ${total} paquetes de los ~150 de 3 s (cortado en el ${alCortar})`)
mira(boca2.hablando === false, 'y la boca queda callada')

console.log(fallos.length ? `\nHAY FALLOS (${fallos.length})` : '\nTODO BIEN')
process.exit(fallos.length ? 1 : 0)
