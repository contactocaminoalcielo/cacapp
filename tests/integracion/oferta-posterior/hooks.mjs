// Redirige db.js y los módulos de WhatsApp del backend a dobles de prueba.
const FAKES = {
  '/orbit-backend/src/db.js': new URL('./fake-db.mjs', import.meta.url).href,
  '/orbit-backend/src/whatsapp.js': new URL('./fake-wa.mjs', import.meta.url).href,
  '/orbit-backend/src/whatsapp-cloud.js': new URL('./fake-wa-cloud.mjs', import.meta.url).href,
}
export async function resolve(specifier, context, next) {
  const r = await next(specifier, context)
  for (const [fin, fake] of Object.entries(FAKES)) {
    if (r.url.endsWith(fin)) return { ...r, url: fake }
  }
  return r
}
