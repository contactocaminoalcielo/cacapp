// Recupera el PDF de los certificados que YA se enviaron, para que se puedan
// ver y descargar desde la bandeja. Corrida una vez el 2026-09-10: 192
// recuperados de 205. Se deja versionado por si vuelve a hacer falta.
//
// NO adivina: el vínculo está guardado. `reportes_grupales_items` dice a qué
// número y a qué hora se envió cada item, y `reportes_grupales.storage_path`
// es el PDF exacto de ese lote. Solo se toca un mensaje cuando ese camino
// lleva a UN único PDF; si hay cero o varios, se deja como está.
//
// 🪤 Dos trampas que hicieron parecer que no había datos:
//   · `canal_destino` va SIN el 57 y con espacios ("322 8645335") mientras que
//     `whatsapp_mensajes.contacto` va con él → comparar los ÚLTIMOS 10 dígitos.
//     Con el número tal cual casaban 6 de 205.
//   · `'\D'` dentro de un template literal se pierde entre capas de escape y la
//     consulta deja de casar SIN dar error → se usa '[^0-9]', que no lleva barras.
//
// Uso (el script corre DENTRO del contenedor, que es donde vive /app/src/db.js):
//   docker cp recuperar-certificados-bandeja.mjs orbit-backend:/tmp/bf.mjs
//   docker exec orbit-backend node /tmp/bf.mjs --seco   # ensayo, no escribe
//   docker exec orbit-backend node /tmp/bf.mjs          # de verdad
import { pool } from '/app/src/db.js'

const SECO = process.argv.includes('--seco')

const { rows } = await pool.query(`
  WITH cert AS (
    SELECT m.id, right(regexp_replace(m.contacto,'[^0-9]','','g'),10) AS tel, m.ocurrido_en,
           btrim(split_part(m.texto,' · ',2)) AS mascota
      FROM public.whatsapp_mensajes m
      LEFT JOIN public.whatsapp_media md ON md.mensaje_id = m.id
     WHERE m.direccion='OUT' AND m.tipo='template'
       AND m.texto LIKE '%certificado_proceso%' AND md.archivo IS NULL
  )
  SELECT c.id, c.mascota,
         array_agg(DISTINCT r.storage_path) FILTER (WHERE r.storage_path IS NOT NULL) AS pdfs
    FROM cert c
    LEFT JOIN public.reportes_grupales_items i
      ON right(regexp_replace(i.canal_destino,'[^0-9]','','g'),10) = c.tel
     AND i.enviado_en BETWEEN c.ocurrido_en - interval '15 min' AND c.ocurrido_en + interval '15 min'
    LEFT JOIN public.reportes_grupales r ON r.id = i.reporte_id
   GROUP BY c.id, c.mascota
   ORDER BY c.id`)

const unicos = rows.filter(r => (r.pdfs || []).length === 1)
const sinPdf = rows.filter(r => !(r.pdfs || []).length)
const varios = rows.filter(r => (r.pdfs || []).length > 1)
console.log(`mensajes sin archivo: ${rows.length} | con 1 PDF: ${unicos.length} | sin PDF: ${sinPdf.length} | ambiguos: ${varios.length}`)
console.log('PDFs distintos a bajar:', new Set(unicos.map(r => r.pdfs[0])).size)
if (sinPdf.length) console.log('sin PDF (se quedan como están):', sinPdf.map(r => r.id).join(', '))
if (varios.length) console.log('AMBIGUOS (no se tocan):', varios.map(r => r.id).join(', '))

if (SECO) { console.log('\n— ensayo en seco: no se escribió nada —'); process.exit(0) }

const cache = new Map()
let ok = 0, fallo = 0
for (const r of unicos) {
  const url = r.pdfs[0]
  try {
    if (!cache.has(url)) {
      const resp = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (!resp.ok) throw new Error(`descarga ${resp.status}`)
      cache.set(url, {
        buf: Buffer.from(await resp.arrayBuffer()),
        mime: (resp.headers.get('content-type') || 'application/pdf').split(';')[0].trim(),
      })
    }
    const { buf, mime } = cache.get(url)
    if (!buf.length) throw new Error('vacío')
    const nombre = `Certificado ${r.mascota || 'proceso'}.pdf`.replace(/[\/:*?"<>|]/g, '-')
    await pool.query(
      `INSERT INTO public.whatsapp_media (mensaje_id, mime, bytes, archivo, nombre)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (mensaje_id) DO NOTHING`,
      [r.id, mime, buf.length, buf, nombre])
    ok++
  } catch (e) {
    fallo++
    console.log(`  mensaje ${r.id}: ${e.message}`)
  }
}
console.log(`\nrecuperados: ${ok} | fallidos: ${fallo}`)
process.exit(0)
