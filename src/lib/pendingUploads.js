// Stash de archivos pendientes de subir en IndexedDB.
// Por qué: en Android, el sistema puede matar la pestaña PWA mientras el
// técnico está en la cámara/galería o durante la compresión de la foto.
// localStorage no puede guardar archivos; IndexedDB sí guarda el Blob y
// sobrevive al reinicio de la página, permitiendo reanudar la subida.
// Todas las funciones son best-effort: si IDB falla, el flujo normal sigue.

const DB_NAME = 'orbit_pendientes'
const STORE   = 'archivos'
const TTL_MS  = 24 * 60 * 60 * 1000 // 24 h

function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    let terminado = false
    const fallo = () => {
      terminado = true; clearTimeout(timer)
      reject(new Error('No se pudo abrir el respaldo local'))
    }
    const timer = setTimeout(fallo, 5000)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => {
      clearTimeout(timer)
      if (terminado) { req.result.close(); return }
      resolve(req.result)
    }
    req.onerror = fallo
    req.onblocked = fallo
  })
}

function enTx(idb, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE, mode)
    const timer = setTimeout(() => {
      try { tx.abort() } catch (_) {}
      reject(new Error('El respaldo local tardó demasiado'))
    }, 5000)
    tx.oncomplete = () => { clearTimeout(timer); resolve(out?.result) }
    tx.onerror = tx.onabort = () => { clearTimeout(timer); reject(tx.error || new Error('Respaldo local interrumpido')) }
    let out
    try { out = fn(tx.objectStore(STORE)) }
    catch (e) { clearTimeout(timer); reject(e) }
  }).finally(() => idb.close())
}

/** Guarda el archivo ANTES de procesarlo (clave ej: `recibo_<servicioId>_<idx>`) */
export async function stashPut(key, file) {
  try {
    const idb = await abrirDB()
    await enTx(idb, 'readwrite', s => s.put({ blob: file, type: file.type, name: file.name || '', ts: Date.now() }, key))
  } catch (_) {}
}

export async function stashDelete(key) {
  try {
    const idb = await abrirDB()
    await enTx(idb, 'readwrite', s => s.delete(key))
  } catch (_) {}
}

/** Entradas cuyo key empieza por `prefix`. Limpia las vencidas (>24 h). */
export async function stashGetByPrefix(prefix) {
  try {
    const idb = await abrirDB()
    const keys = await enTx(idb, 'readonly', s => s.getAllKeys())
    const propios = (keys || []).filter(k => typeof k === 'string' && k.startsWith(prefix))
    const out = []
    for (const k of propios) {
      const idb2 = await abrirDB()
      const v = await enTx(idb2, 'readonly', s => s.get(k))
      if (!v) continue
      if (Date.now() - (v.ts || 0) > TTL_MS) { await stashDelete(k); continue }
      out.push({ key: k, ...v })
    }
    return out
  } catch (_) {
    return []
  }
}
