// Catálogo de mensajes interactivos de WhatsApp (migración 100).
//
// Botones, menú de lista y botón de enlace. Se editan aquí y el AGENTE los usa
// por su clave: la descripción de cada uno es lo que él lee para decidir cuándo
// mandarlo. Por eso escribirla bien importa tanto como el mensaje.
//
// Las tablas no están expuestas por PostgREST: todo pasa por orbit-backend.
import { orbitApi } from '@/lib/orbitApi'

export const TIPOS = {
  BOTONES: {
    label: 'Botones',
    ayuda: 'Hasta 3 botones de respuesta. La veterinaria toca uno y su texto vuelve como respuesta.',
    cuando: 'Para preguntas con dos o tres respuestas posibles: dónde se recoge, sí o no.',
  },
  LISTA: {
    label: 'Menú',
    ayuda: 'Un menú desplegable con hasta 10 opciones en total, agrupables en secciones.',
    cuando: 'Cuando hay muchas opciones y escribirlas sería un muro de texto: los planes, por ejemplo.',
  },
  CTA_URL: {
    label: 'Botón de enlace',
    ayuda: 'Un botón que abre una dirección web. No devuelve respuesta.',
    cuando: 'Para mandar el enlace de registro sin pegar la dirección, que se copia mal.',
  },
}

/** Topes de WhatsApp. Pasarse hace que Meta rechace el mensaje ENTERO al enviarlo. */
export const TOPES = {
  encabezado: 60, cuerpo: 1024, pie: 60,
  boton: 20, titulo: 24, desc: 72, tituloBtn: 20,
  botones: 3, filas: 10,
}

/**
 * Variables que resuelve el servidor al enviar.
 * `{{enlace_registro}}` NO se puede sustituir a mano: el enlace personal es la
 * credencial de cada clínica y se deriva del número que escribe.
 */
export const VARIABLES = [
  { clave: '{{enlace_registro}}', ayuda: 'El enlace del portal de ESA clínica. Lo resuelve el servidor por su número.' },
]

export const cargarInteractivos = () => orbitApi('/whatsapp/interactivos')

export const guardarInteractivo = (datos) =>
  orbitApi('/whatsapp/interactivos', { method: 'POST', body: datos })

export const borrarInteractivo = (id) =>
  orbitApi(`/whatsapp/interactivos/${id}`, { method: 'DELETE' })

export const enviarInteractivo = (contacto, clave) =>
  orbitApi(`/whatsapp/conversaciones/${encodeURIComponent(contacto)}/interactivo`, {
    method: 'POST', body: { clave },
  })

/** Cuántas filas lleva un menú. Meta las cuenta en TOTAL, no por sección. */
export function contarFilas(opciones = []) {
  return opciones.reduce((a, s) => a + (s?.filas?.length || 0), 0)
}

/** Un molde vacío según el tipo, para no arrancar de la nada. */
export function nuevoInteractivo(tipo = 'BOTONES') {
  return {
    id: null, clave: '', nombre: '', descripcion: '', tipo,
    encabezado: '', cuerpo: '', pie: '', boton_texto: '',
    opciones: tipo === 'LISTA'
      ? [{ titulo: 'Opciones', filas: [{ id: '', titulo: '', descripcion: '' }] }]
      : tipo === 'BOTONES' ? [{ id: '', titulo: '' }] : [],
    url: tipo === 'CTA_URL' ? '' : '',
    usa_agente: true, activo: true, orden: 0,
  }
}
