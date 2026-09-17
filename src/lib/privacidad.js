// Política de Tratamiento de Datos Personales — fuente única.
//
// La página /privacidad, el aviso corto de las casillas y el documento de docs/
// salen todos de aquí. Si el texto cambia, SUBIR `VERSION`: cada autorización
// guarda la versión que la persona aceptó, y una autorización solo prueba algo
// si se sabe qué decía lo que se aceptó (Ley 1581 de 2012, art. 9).
//
// Marco: Ley 1581 de 2012 y Decreto 1377 de 2013, compilado en el Decreto 1074
// de 2015 (Libro 2, Parte 2, Título 2, Capítulo 25). Los plazos de respuesta
// son los de los artículos 14 y 15 de la Ley 1581.

// Orbit corre con HashRouter: la ruta pública es /#/privacidad, no /privacidad.
// Sin el # el servidor entrega index.html, la app arranca sin ruta y la persona
// termina en el login en vez de en la política que iba a leer.
export const URL_POLITICA = '/#/privacidad'

export const VERSION = '1.1'
export const VIGENTE_DESDE = '2026-09-17'

export const RESPONSABLE = {
  razon:     'MARTEN´S INVERSIONES S.A.S',
  nit:       '901.792.844-5',
  comercial: 'Camino al Cielo',
  direccion: 'Calle 57 # 80-86, Los Monjes, Engativá',
  ciudad:    'Bogotá D.C., Colombia',
  email:     'contacto@caminoalcielo.com.co',
  whatsapp:  '319 358 5508',
  web:       'www.caminoalcielo.com.co',
}

// Aviso corto que acompaña a la casilla. No reemplaza la política: la resume y
// enlaza a ella. Es el «aviso de privacidad» del art. 2.2.2.25.3.2 del Decreto
// 1074 de 2015.
export const AVISO_CORTO =
  `${RESPONSABLE.comercial} (${RESPONSABLE.razon}, NIT ${RESPONSABLE.nit}) trata sus datos para ` +
  'prestar el servicio funerario de su mascota, coordinar la recogida y la entrega, elaborar los ' +
  'recordatorios, comunicarse con usted por WhatsApp y cumplir sus obligaciones legales y contables. ' +
  'Usted puede conocer, actualizar, rectificar y suprimir sus datos, y revocar esta autorización, ' +
  `escribiendo a ${RESPONSABLE.email}.`

export const SECCIONES = [
  {
    t: 'Quién responde por sus datos',
    p: [
      `${RESPONSABLE.razon}, NIT ${RESPONSABLE.nit}, que opera bajo el nombre comercial ` +
      `${RESPONSABLE.comercial}, es el Responsable del Tratamiento de los datos personales que usted ` +
      'nos entrega.',
      `Domicilio: ${RESPONSABLE.direccion}, ${RESPONSABLE.ciudad}. Correo para asuntos de datos ` +
      `personales: ${RESPONSABLE.email}. WhatsApp: ${RESPONSABLE.whatsapp}.`,
      'Esta política se expide en cumplimiento de la Ley 1581 de 2012 y del Decreto 1377 de 2013, ' +
      'compilado en el Decreto 1074 de 2015.',
    ],
  },
  {
    t: 'Qué datos tratamos',
    p: ['Según el trámite, podemos tratar:'],
    l: [
      'Identificación y contacto: nombre, apellido, cédula o NIT, teléfono, WhatsApp y correo electrónico.',
      'Ubicación: ciudad, localidad, barrio y dirección de recogida y de entrega, y el nombre y el ' +
        'teléfono de quien recibe si no es usted.',
      'Datos de su mascota: nombre, especie, raza, sexo, peso y los detalles y fechas del servicio.',
      'Datos del servicio y de pago: plan contratado, valores, medio de pago y comprobantes.',
      'Imágenes y audios que usted decida enviarnos: fotos de su mascota o de su familia para los ' +
        'recordatorios, y mensajes de voz por WhatsApp.',
      'Conversaciones por WhatsApp con nuestras líneas de atención, incluidas las que atiende un ' +
        'asistente automático.',
    ],
    p2: [
      'No pedimos datos sensibles ni datos de niñas, niños y adolescentes. Si usted nos envía una ' +
      'fotografía en la que aparecen personas, esa imagen se usa únicamente para el recordatorio que ' +
      'usted pidió.',
    ],
  },
  {
    t: 'Para qué los usamos',
    l: [
      'Prestar el servicio funerario de su mascota y coordinar la recogida, el proceso y la entrega.',
      'Elaborar y entregar los recordatorios, certificados y piezas incluidas en su plan.',
      'Comunicarnos con usted por WhatsApp, llamada o correo sobre el estado de su servicio.',
      'Cobrar, facturar y llevar la contabilidad.',
      'Atender sus preguntas, quejas y reclamos, y medir la satisfacción con el servicio.',
      'Cumplir obligaciones legales y atender requerimientos de autoridades.',
    ],
    p2: ['No vendemos ni alquilamos sus datos. No los usamos para publicidad de terceros.'],
  },
  {
    t: 'Cómo se da la autorización',
    p: [
      'Usted autoriza el tratamiento marcando la casilla correspondiente en nuestros formularios, o ' +
      'manifestándolo por WhatsApp, por teléfono o en persona cuando el registro lo hace nuestro ' +
      'equipo. En todos los casos guardamos constancia de la fecha, del medio y de la versión de esta ' +
      'política que estaba vigente.',
      'Cuando es una clínica veterinaria aliada la que nos entrega sus datos, esa clínica declara que ' +
      'cuenta con su autorización previa. Si usted no la dio, escríbanos y suprimimos sus datos.',
      'La autorización es voluntaria. Sin ella no podemos prestar el servicio, porque necesitamos sus ' +
      'datos de contacto y de dirección para recoger y entregar.',
    ],
  },
  {
    t: 'Quién más puede ver sus datos',
    p: ['Compartimos lo estrictamente necesario con:'],
    l: [
      'Nuestro equipo, y los técnicos y mensajeros que hacen la recogida y la entrega.',
      'La clínica veterinaria aliada por la que ingresó el servicio, cuando corresponde.',
      'Proveedores que actúan como Encargados: mensajería de WhatsApp (Meta Platforms), ' +
        'infraestructura y almacenamiento, procesamiento de texto, imagen y voz con inteligencia ' +
        'artificial para atender sus mensajes, y servicios de facturación.',
      'Autoridades, cuando una norma o una orden judicial lo exija.',
    ],
    p2: [
      'Nuestros servidores están en Francia (Unión Europea), país con nivel adecuado de protección ' +
      'según la Superintendencia de Industria y Comercio. Algunos de nuestros Encargados están en ' +
      'Estados Unidos; al autorizar esta política usted autoriza esa transferencia internacional, que ' +
      'en todo caso se hace bajo contrato y solo para las finalidades aquí descritas.',
    ],
  },
  {
    t: 'Publicación de los memoriales',
    p: [
      'Con la fotografía que usted nos envía elaboramos el memorial de su mascota. Esas piezas ' +
      'pueden publicarse en nuestras redes sociales como parte de nuestra labor de divulgación y ' +
      'acompañamiento a otras familias.',
      'Solo publicamos piezas en las que aparece la mascota. No publicamos fotografías en las que ' +
      'aparezcan personas, ni el nombre, el teléfono ni ningún otro dato que lo identifique a usted.',
      'Si usted prefiere que la de su mascota no se publique, basta con decírnoslo por cualquiera de ' +
      'nuestros canales, antes o después: si ya estaba publicada, la retiramos. No tiene que dar ' +
      'ninguna razón y su servicio y sus recordatorios no cambian en nada.',
    ],
  },
  {
    t: 'Sus derechos',
    p: ['Como titular de los datos usted puede:'],
    l: [
      'Conocer qué datos suyos tenemos y para qué los usamos, de forma gratuita.',
      'Actualizarlos y rectificarlos cuando estén incompletos o equivocados.',
      'Solicitar que se supriman, cuando no exista un deber legal o contractual de conservarlos.',
      'Revocar la autorización en cualquier momento.',
      'Pedir prueba de la autorización que usted dio.',
      'Presentar quejas ante la Superintendencia de Industria y Comercio, después de haber agotado el ' +
        'trámite con nosotros.',
      'Pedirnos que no lo contactemos más por WhatsApp o por teléfono para comunicaciones que no sean ' +
        'estrictamente necesarias para su servicio.',
    ],
  },
  {
    t: 'Cómo ejercerlos',
    p: [
      `Escríbanos a ${RESPONSABLE.email} o por WhatsApp al ${RESPONSABLE.whatsapp}, indicando su ` +
      'nombre, un dato de contacto y qué necesita. También puede hacerlo por escrito en ' +
      `${RESPONSABLE.direccion}, ${RESPONSABLE.ciudad}.`,
      'Las consultas se responden en un máximo de diez (10) días hábiles. Si no es posible, se lo ' +
      'informamos y respondemos dentro de los cinco (5) días hábiles siguientes.',
      'Los reclamos se atienden en un máximo de quince (15) días hábiles. Si no es posible, se lo ' +
      'informamos y respondemos dentro de los ocho (8) días hábiles siguientes.',
      'Si su solicitud está incompleta, se lo pedimos dentro de los cinco (5) días siguientes; si no ' +
      'recibimos respuesta en dos (2) meses, se entiende desistida.',
    ],
  },
  {
    t: 'Por cuánto tiempo los guardamos',
    p: [
      'Mientras exista la relación con usted y, después, durante los términos legales de conservación ' +
      'de la información comercial y contable —diez (10) años— y los necesarios para atender ' +
      'reclamaciones. Cumplidos esos plazos se eliminan o se anonimizan.',
      'Si usted revoca la autorización o pide la supresión, retiramos sus datos de nuestros usos ' +
      'comerciales y de contacto, y conservamos únicamente lo que la ley nos obliga a conservar.',
    ],
  },
  {
    t: 'Seguridad',
    p: [
      'Aplicamos medidas técnicas y administrativas para proteger sus datos: el acceso al sistema es ' +
      'con usuario y contraseña, cada persona ve solo lo que su rol requiere, la información viaja ' +
      'cifrada y los enlaces que le enviamos son personales y no listan los datos de nadie más.',
      'Ningún sistema es infalible. Si ocurre un incidente que afecte sus datos, lo informaremos a la ' +
      'Superintendencia de Industria y Comercio y a usted, conforme a la ley.',
    ],
  },
  {
    t: 'Vigencia y cambios',
    p: [
      `Esta política rige desde el ${VIGENTE_DESDE} y corresponde a la versión ${VERSION}. Si la ` +
      'cambiamos de forma sustancial, se lo informaremos por los canales habituales antes de que ' +
      'empiece a aplicar. Las bases de datos se conservan mientras se mantengan las finalidades aquí ' +
      'descritas.',
    ],
  },
]
