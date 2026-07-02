// Render headless de un memorial con Remotion.
// Lo invoca el orbit-backend como proceso hijo:
//   node memorial/render.mjs '<json>'
// json = { name, date, photo, frase, outPath }
// photo puede ser una URL http(s) pública (bucket fotos-clientes) o un data URL.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { selectComposition, renderMedia, ensureBrowser } from '@remotion/renderer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  const payload = JSON.parse(process.argv[2] || '{}')
  const { name, date, photo, frase, outPath } = payload
  const compositionId = payload.compositionId === 'MemorialVertical' ? 'MemorialVertical' : 'Memorial'
  if (!name || !photo || !outPath) throw new Error('Faltan campos (name, photo, outPath)')

  await ensureBrowser()

  const serveUrl = await bundle({
    entryPoint: path.join(__dirname, 'src', 'index.ts'),
    // Los assets (fuentes/audio/logo) viven en memorial/public, no en el cwd.
    publicDir: path.join(__dirname, 'public'),
  })

  const inputProps = {
    name,
    date: date || '',
    photo,
    frase: frase || 'Siempre en nuestro corazón',
  }

  const composition = await selectComposition({ serveUrl, id: compositionId, inputProps })

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    crf: 18,
    outputLocation: outPath,
    inputProps,
    // Headless sin GPU (VPS): swiftshader es el backend seguro.
    chromiumOptions: { gl: 'swiftshader' },
    concurrency: parseInt(process.env.MEMORIAL_CONCURRENCY || '2') || 2,
  })

  process.stdout.write(JSON.stringify({ ok: true, outPath }))
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
  process.exit(1)
})
