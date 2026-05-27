// scripts/generar-iconos.mjs
// Genera icon-192.png e icon-512.png para el PWA desde public/icon.svg
import { readFileSync, writeFileSync } from 'fs'
import { Resvg } from '@resvg/resvg-js'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(__dirname, '..', 'public')

const svg = readFileSync(path.join(publicDir, 'icon.svg'), 'utf-8')

for (const size of [192, 512]) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
  })
  const png = resvg.render().asPng()
  writeFileSync(path.join(publicDir, `icon-${size}.png`), png)
  console.log(`✓ icon-${size}.png generado (${png.length} bytes)`)
}
