globalThis.__sobres = []
export async function enviarSobre(args) {
  globalThis.__sobres.push(args)
  return { status: 200, body: { ok: true, wa_message_id: 'wamid.S' + globalThis.__sobres.length } }
}
