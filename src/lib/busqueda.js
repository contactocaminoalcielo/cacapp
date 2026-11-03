// Búsqueda de texto para filtros y listas: sin tildes, sin mayúsculas, por
// palabras sueltas y en cualquier orden.
//   "maria"      → "María celeste"
//   "vet san"    → "Veterinaria San Francisco"
//   "san vet"    → la misma (el orden no importa)
//   "pe"         → "Perro", "Pérez", "Clínica Pelos y Patas"
// Signos y puntos cuentan como espacio: "dr. lopez" → "Dr López".

export const normalizarTexto = s => String(s ?? '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9ñ]+/g, ' ')
  .trim()

// Puntaje de qué tan bien `texto` responde a `consulta`. 0 = no coincide.
// Gana lo que EMPIEZA por lo escrito, luego lo que tiene una palabra que empieza
// así, y al final lo que solo lo contiene por dentro.
export function puntajeBusqueda(texto, consulta) {
  const q = normalizarTexto(consulta)
  if (!q) return 1
  const t = normalizarTexto(texto)
  const palabras = t.split(' ')
  let puntos = 0
  for (const tok of q.split(' ')) {
    if (!t.includes(tok)) return 0
    puntos += palabras.some(p => p.startsWith(tok)) ? 2 : 1
  }
  if (t.startsWith(q)) puntos += 3
  return puntos
}

export const coincideBusqueda = (texto, consulta) => puntajeBusqueda(texto, consulta) > 0

// Filtra y ordena por relevancia; a igual puntaje respeta el orden original.
export function filtrarPorBusqueda(items, consulta, texto = x => x) {
  if (!normalizarTexto(consulta)) return items
  return items
    .map((it, i) => ({ it, i, p: puntajeBusqueda(texto(it), consulta) }))
    .filter(x => x.p > 0)
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .map(x => x.it)
}
