// Prueba de INTEGRACIÓN de la oferta posterior (migr. 210): las migraciones 209 y
// 210 tal cual están en el repo + el código REAL del backend, contra un Postgres
// embebido en memoria (PGlite). WhatsApp está simulado: no sale ningún mensaje y
// no se toca ninguna base real.
//
// El repo no tiene base de datos de prueba, así que `schema.sql` es una copia
// MÍNIMA de las tablas de producción que toca el módulo (solo las columnas que
// usa). Si una migración posterior cambia esas tablas, hay que reflejarlo ahí.
//
// Cómo correrla (desde la raíz del repo; PGlite no es dependencia del proyecto):
//   npm install --no-save @electric-sql/pglite
//   node --import ./tests/integracion/oferta-posterior/register.mjs tests/integracion/oferta-posterior/prueba.mjs
//
// Los dobles (`fake-*.mjs`) reemplazan db.js, whatsapp.js y whatsapp-cloud.js del
// backend por medio de `hooks.mjs`.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import assert from 'node:assert/strict'

import { fileURLToPath } from 'node:url'
const RAIZ = new URL('../../../', import.meta.url)
const REPO = fileURLToPath(RAIZ).slice(0, -1)   // sin la barra final
const SRC = new URL('orbit-backend/src', RAIZ).href
const pg = new PGlite()
globalThis.__pg = pg
const q = async (t, p = []) => (await pg.query(t, p)).rows
let n = 0
const ok = (nombre) => { n++; console.log(`  ✓ ${nombre}`) }
const paso = t => console.log(`\n■ ${t}`)

// ── Esquema + migraciones tal cual están en el repo ─────────────────────────
paso('Migraciones')
await pg.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
await pg.exec(fs.readFileSync(`${REPO}/migrations/209_condolencias.sql`, 'utf8'))
ok('209 aplica')
const m210 = fs.readFileSync(`${REPO}/migrations/210_oferta_posterior_ventas.sql`, 'utf8')
await pg.exec(m210); ok('210 aplica')
await pg.exec(m210); ok('210 es idempotente (aplicarla dos veces no falla)')
assert.equal((await q(`SELECT count(*)::int n FROM config_operativa WHERE modulo='OFERTA_POSTERIOR'`))[0].n, 20)
ok('20 filas de configuración')
const priv = (await q(`SELECT has_table_privilege('orbit_backend','public.ventas_posteriores','INSERT') b,
  has_table_privilege('authenticated','public.ventas_posteriores','SELECT') a,
  has_table_privilege('anon','public.ofertas_posteriores','SELECT') an,
  has_table_privilege('orbit_backend','public.oferta_exclusiones','DELETE') d`))[0]
assert.deepEqual(priv, { b: true, a: false, an: false, d: true })
ok('orbit_backend escribe; authenticated y anon NO leen las tablas nuevas')
await assert.rejects(pg.query(`INSERT INTO compras_recordatorios (total, origen) VALUES (1, 'OTRO')`))
await pg.query(`INSERT INTO afiliacion_contratos (descuento_motivo) VALUES ('OFERTA_POSTERIOR')`)
await pg.query(`TRUNCATE afiliacion_contratos`)
ok('las tres restricciones admiten el valor nuevo y siguen rechazando lo ajeno')

// ── Datos ───────────────────────────────────────────────────────────────────
paso('Datos de prueba')
await pg.exec(`
INSERT INTO roles_personal VALUES (1,'COORDINADOR'),(2,'TECNICO'),(4,'PRODUCTOR'),(6,'ADMIN');
INSERT INTO personal (id, nombre, rol_principal_id) VALUES
  ('00000000-0000-4000-8000-000000000001','Coordi',1),
  ('00000000-0000-4000-8000-000000000004','Produ',4),
  ('00000000-0000-4000-8000-000000000002','Tecni',2);
INSERT INTO planes (codigo, nombre) VALUES ('BASICO','Básico'),('DESAMPARADO','Desamparado'),('STANDARD','Standard'),('PREMIUM','Premium');
INSERT INTO especies (nombre) VALUES ('Perro'),('Gato');
INSERT INTO recordatorios (id, nombre, descripcion, categoria, requiere_imagen, solo_nombre, max_fotos, precio_base, precio_publico, venta_publica, campos_texto, tiempo_produccion_dias) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001','Memopet','Cuadro','fisico',true,false,1,26000,NULL,true,'[]',5),
  ('aaaaaaaa-0000-4000-8000-000000000002','Huella 3D','Huella','fisico',false,false,0,90000,100000,true,'[]',8),
  ('aaaaaaaa-0000-4000-8000-000000000003','Cédula de mascota','Carné','fisico',true,false,1,37000,NULL,true,'[{"label":"Color y señas particulares","cantidad":1}]',3),
  ('aaaaaaaa-0000-4000-8000-000000000004','Solo interno','No público','fisico',false,false,0,5000,NULL,false,'[]',1);
UPDATE config_operativa SET valor = to_jsonb((fn_hoy_bogota() - 30)::text) WHERE modulo='OFERTA_POSTERIOR' AND clave='arranque_desde';
UPDATE config_operativa SET valor = 'true' WHERE modulo='OFERTA_POSTERIOR' AND clave='activo';
UPDATE config_operativa SET valor = '{"nombre":"oferta_posterior_servicio","idioma":"es_MX","categoria":"MARKETING"}' WHERE modulo='OFERTA_POSTERIOR' AND clave='plantilla';
INSERT INTO config_operativa (modulo, clave, valor) VALUES
  ('AFILIACIONES','precios','{"ANUAL":{"BRONCE":37000,"PLATA":60000,"ORO":0,"DIAMANTE":143000},"VITALICIO":{"PLATA":380000}}'),
  ('CATALOGO_PUBLICO','activo','true'),('CATALOGO_PUBLICO','valor_envio','12000'),('CATALOGO_PUBLICO','datos_pago','"Nequi 300 000 0000"');
`)
const HOY = (await q(`SELECT fn_hoy_bogota()::text h`))[0].h
// nombre, whatsapp, mascota, plan, díasFallecido, díasEntregado (null = no entregado)
const CASOS = [
  ['A', 'ANA MARIA', '3001110001', 'LUNA',  'BASICO', 61, 40],
  ['B', 'Beto',      '3001110002', 'Rocky', 'BASICO', 62, 40],
  ['C', 'Caro',      '3001110003', 'Max',   'DESAMPARADO', 61, 40],
  ['D', 'Dora',      '3001110004', 'Nala',  'BASICO', 61, 40],
  ['F', 'Fabio',     '',           'Coco',  'BASICO', 61, 40],
  ['G', 'Gina',      '3001110007', 'Toby',  'BASICO', 61, 40],
  ['H', 'Hugo',      '+57 300 111 0008', 'Simba', 'BASICO', 61, 20],
  ['I', 'Iris',      '3001110009', 'Kira',  'BASICO', 61, 40],
  ['J', 'Juan',      '3001110010', 'Bruno', 'BASICO', 61, null],
  ['K', 'Kike',      '3001110011', 'Mora',  'BASICO', 61, 40],
  ['V', 'Vieja',     '3001110012', 'Old',   'BASICO', 300, 280],
]
const S = {}
for (const [k, nom, wa, masc, plan, df, de] of CASOS) {
  const [c] = await q(`INSERT INTO clientes (nombre, apellido, whatsapp, cedula_nit) VALUES ($1,'PEREZ',$2,'1020') RETURNING id_cliente`, [nom, wa])
  const [m] = await q(`INSERT INTO mascotas (nombre, especie_id, tamano, peso_kg, cliente_id, fallecida, fecha_fallecimiento)
                       VALUES ($1,1,'Mediano',10,$2,true, fn_hoy_bogota() - $3::int) RETURNING id_mascota`, [masc, c.id_cliente, df])
  const [s] = await q(`INSERT INTO servicios (mascota_id, plan_id, estado, fecha_entrega_real)
                       VALUES ($1,(SELECT id FROM planes WHERE codigo=$2),$3, CASE WHEN $4::int IS NULL THEN NULL ELSE fn_hoy_bogota() - $4::int END) RETURNING id`,
                      [m.id_mascota, plan, de === null ? 'EN_PRODUCCION' : 'ENTREGADO', de])
  S[k] = { cliente: c.id_cliente, mascota: m.id_mascota, servicio: s.id, wa }
}
// E: segunda mascotica de Ana (misma familia)
{
  const [m] = await q(`INSERT INTO mascotas (nombre, especie_id, tamano, peso_kg, cliente_id, fallecida, fecha_fallecimiento)
                       VALUES ('Mia',2,'Mediano',4,$1,true, fn_hoy_bogota() - 60) RETURNING id_mascota`, [S.A.cliente])
  const [s] = await q(`INSERT INTO servicios (mascota_id, plan_id, estado, fecha_entrega_real) VALUES ($1,1,'ENTREGADO', fn_hoy_bogota() - 30) RETURNING id`, [m.id_mascota])
  S.E = { cliente: S.A.cliente, mascota: m.id_mascota, servicio: s.id }
}
await pg.query(`INSERT INTO servicio_recordatorios (servicio_id, recordatorio_id, origen, estado) VALUES ($1,'aaaaaaaa-0000-4000-8000-000000000001','PLAN','ENTREGADO')`, [S.A.servicio])
await pg.query(`INSERT INTO condolencias (servicio_id, fecha_programada, estado, fecha_envio) VALUES ($1, fn_hoy_bogota() - 31, 'ENVIADO', now() - interval '31 days')`, [S.A.servicio])
await pg.query(`INSERT INTO condolencias (servicio_id, fecha_programada, estado, fecha_envio) VALUES ($1, fn_hoy_bogota() - 10, 'ENVIADO', now() - interval '10 days')`, [S.G.servicio])
await pg.query(`INSERT INTO condolencias (servicio_id, fecha_programada, estado, motivo_exclusion, excluido_por) VALUES ($1, fn_hoy_bogota() - 20, 'EXCLUIDO', 'Caso delicado', '00000000-0000-4000-8000-000000000001')`, [S.K.servicio])
await pg.query(`INSERT INTO nps_seguimiento (servicio_id, tipo, satisfaccion, nps) VALUES ($1,'POST_ENTREGA','MALA',1)`, [S.B.servicio])
await pg.query(`INSERT INTO nps_seguimiento (servicio_id, tipo, satisfaccion, nps) VALUES ($1,'POST_ENTREGA','BUENA',5)`, [S.H.servicio])
await pg.query(`INSERT INTO pqrs (servicio_id, tipo, descripcion) VALUES ($1,'QUEJA','Demora')`, [S.D.servicio])
await pg.query(`INSERT INTO pqrs (servicio_id, tipo, descripcion) VALUES ($1,'FELICITACION','Gracias')`, [S.H.servicio])
await pg.query(`INSERT INTO oferta_exclusiones (tel10, motivo, origen) VALUES ('3001110009','Lo pidió por teléfono','EQUIPO')`)
ok(`sembrados ${Object.keys(S).length} servicios · hoy = ${HOY}`)

// ── Código real del backend ─────────────────────────────────────────────────
const OP = await import(`${SRC}/oferta-posterior.js`)
const JOB = await import(`${SRC}/jobs/oferta-posterior.js`)
const PORTAL = await import(`${SRC}/oferta-portal.js`)
const VP = await import(`${SRC}/ventas-posteriores.js`)
const oferta = async k => (await q(`SELECT * FROM ofertas_posteriores WHERE servicio_id = $1`, [S[k].servicio]))[0]

paso('Preparar (en seco y de verdad)')
const seco = await OP.prepararOfertas({ dryRun: true })
assert.equal((await q(`SELECT count(*)::int n FROM ofertas_posteriores`))[0].n, 0)
ok(`en seco cuenta sin escribir: ${JSON.stringify(seco)}`)
const prep = await OP.prepararOfertas()
assert.deepEqual(prep, { creadas: seco.creadas, excluidas: seco.excluidas })
assert.equal(await oferta('J'), undefined); ok('servicio sin entregar: no se programa')
assert.equal(await oferta('V'), undefined); ok('fallecimiento de hace 300 días: fuera de la ventana, no se programa')
assert.equal((await oferta('C')).motivo_exclusion, 'Plan Desamparado (no hay familia)'); ok('Desamparado: excluida')
assert.equal((await oferta('F')).motivo_exclusion, 'Sin WhatsApp válido'); ok('sin WhatsApp: excluida')
const fp = async k => (await q(`SELECT (fecha_programada - fn_hoy_bogota())::int d FROM ofertas_posteriores WHERE servicio_id=$1`, [S[k].servicio]))[0].d
assert.equal(await fp('A'), -1); ok('A: max(fallec.+60, condolencia+30, entrega+15) = ayer')
assert.equal(await fp('G'), 20); ok('G: su condolencia salió hace 10 días → la oferta espera 20 días más')
assert.equal(await fp('H'), -1); ok('H: sin condolencia, manda fallecimiento + 60')
assert.deepEqual(await OP.prepararOfertas(), { creadas: 0, excluidas: 0 }); ok('preparar otra vez no duplica')

paso('Revisar exclusiones')
await OP.revisarExclusiones()
assert.match((await oferta('B')).motivo_exclusion, /Calificó mal/); ok('B calificó MALA la encuesta → excluida')
assert.match((await oferta('D')).motivo_exclusion, /queja o reclamo/); ok('D tiene una QUEJA → excluida')
assert.match((await oferta('I')).motivo_exclusion, /pidió no recibir/); ok('I está en «No contactar» (por número) → excluida')
assert.match((await oferta('K')).motivo_exclusion, /condolencia fue excluida a mano/); ok('K: condolencia excluida a mano → excluida')
assert.equal((await oferta('H')).estado, 'PENDIENTE'); ok('H (calificó BUENA, solo una felicitación) sigue programada')

paso('Job de envío')
const dry = await JOB.jobOfertaPosterior({ dryRun: true })
assert.equal(globalThis.__plantillas.length, 0); ok(`?dry=1 no envía: ${dry.candidatos ?? 0} candidatos`)
const res = await JOB.jobOfertaPosterior()
console.log('   resultado:', JSON.stringify(res))
if (res.descanso) {
  console.log('   (hoy es fin de semana o festivo: el job no envía; se prueba el envío directo)')
  for (const k of ['A', 'H', 'E']) await OP.enviarOferta({ id: (await oferta(k)).id })
} else {
  assert.equal(res.enviados, 2); assert.equal(res.excluidas_al_enviar, 1)
}
assert.equal((await oferta('A')).estado, 'ENVIADO')
assert.equal((await oferta('H')).estado, 'ENVIADO')
ok('A y H recibieron la plantilla')
assert.equal(globalThis.__plantillas.length, 2)
const pl = globalThis.__plantillas.find(p => p.bodyParams[0] === 'Luna')
assert.ok(pl, 'LUNA debe salir como Luna')
assert.equal(pl.plantillaNombre, 'oferta_posterior_servicio'); assert.equal(pl.category, 'MARKETING'); assert.equal(pl.personalId, null)
ok('plantilla correcta, «LUNA» sale como «Luna», sin personalId (el agente no se calla)')
assert.match((await oferta('E')).motivo_exclusion, /otra mascotica/); ok('E (segunda mascotica de Ana): UNA sola oferta por familia')
assert.equal((await oferta('G')).estado, 'PENDIENTE'); ok('G sigue esperando su fecha')
await JOB.jobOfertaPosterior()
assert.equal(globalThis.__plantillas.length, 2); ok('correr el job otra vez no reenvía nada')

paso('Error de Meta y reintento')
await pg.query(`UPDATE ofertas_posteriores SET fecha_programada = fn_hoy_bogota() WHERE servicio_id=$1`, [S.G.servicio])
await pg.query(`UPDATE condolencias SET fecha_envio = now() - interval '40 days' WHERE servicio_id=$1`, [S.G.servicio])
globalThis.__falla_wa = true
let e1 = await OP.enviarOferta({ id: (await oferta('G')).id })
assert.equal(e1.motivo, 'error_envio'); assert.equal((await oferta('G')).estado, 'ERROR'); assert.equal((await oferta('G')).intentos, 1)
ok('si Meta rechaza, queda ERROR con su motivo (nunca ENVIADO)')
globalThis.__falla_wa = false
e1 = await OP.enviarOferta({ id: (await oferta('G')).id })
assert.equal(e1.enviado, true); ok('el reintento sale')
assert.equal((await OP.enviarOferta({ id: (await oferta('G')).id })).motivo, 'ya_enviado'); ok('una ENVIADA no se vuelve a mandar')

paso('Condolencia reciente al enviar')
{
  const [c] = await q(`INSERT INTO clientes (nombre, apellido, whatsapp) VALUES ('Lola','R','3001110020') RETURNING id_cliente`)
  const [m] = await q(`INSERT INTO mascotas (nombre, especie_id, tamano, peso_kg, cliente_id, fallecida, fecha_fallecimiento) VALUES ('Pipo',1,'Mediano',5,$1,true,fn_hoy_bogota()-70) RETURNING id_mascota`, [c.id_cliente])
  const [s] = await q(`INSERT INTO servicios (mascota_id, plan_id, estado, fecha_entrega_real) VALUES ($1,1,'ENTREGADO',fn_hoy_bogota()-50) RETURNING id`, [m.id_mascota])
  S.L = { cliente: c.id_cliente, servicio: s.id }
  await OP.prepararOfertas()
  // La condolencia sale DESPUÉS de preparada la oferta (hace 5 días).
  await pg.query(`INSERT INTO condolencias (servicio_id, fecha_programada, estado, fecha_envio) VALUES ($1, fn_hoy_bogota()-5,'ENVIADO', now() - interval '5 days')`, [s.id])
  const r = await OP.enviarOferta({ id: (await oferta('L')).id })
  assert.equal(r.motivo, 'espera_condolencia'); assert.equal(await fp('L'), 25); assert.equal((await oferta('L')).estado, 'PENDIENTE')
  ok('la oferta NO se adelanta a la condolencia: se reprograma a condolencia + 30')
}

paso('Botones de WhatsApp')
const H = await oferta('H')
assert.equal(await OP.manejarRespuestaOferta({ contacto: '573001110008', tipo: 'button', boton: 'Bueno' }), false)
ok('«Bueno» (botón de la encuesta) no es de la oferta → sigue su camino')
assert.equal(await OP.manejarRespuestaOferta({ contacto: '573009999999', tipo: 'button', boton: 'Planes preexequiales' }), false)
ok('un número sin oferta enviada → lo atiende el agente')
assert.equal(await OP.manejarRespuestaOferta({ contacto: '573001110008', tipo: 'text', boton: 'Planes preexequiales' }), false)
ok('texto escrito (no botón) → lo atiende el agente')
assert.equal(await OP.manejarRespuestaOferta({ contacto: '573001110008', tipo: 'button', boton: 'Recordatorios adicionales' }), true)
let ventas = await q(`SELECT * FROM ventas_posteriores WHERE oferta_id=$1`, [H.id])
assert.equal(ventas.length, 1); assert.equal(ventas[0].categoria, 'RECORDATORIOS'); assert.equal(ventas[0].estado, 'INTERESADO')
const sobre = globalThis.__sobres.at(-1)
assert.equal(sobre.payload.interactive.type, 'cta_url')
assert.equal(sobre.payload.interactive.action.parameters.url, `https://orbit.orbitacac.com/#/oferta/${H.codigo}/recordatorios`)
assert.ok(sobre.payload.interactive.action.parameters.display_text.length <= 20)
assert.match(sobre.payload.interactive.body.text, /30% de descuento/)
ok('«Recordatorios adicionales» → venta INTERESADO + enlace del portal con el 30 %')
// David, 27-nov: tocar un botón es INTERÉS, no una compra. Antes avisaba a
// Diseño «NUEVA OPORTUNIDAD» y lo leían como una venta sin producto.
let notis = await q(`SELECT p.nombre FROM notificaciones n JOIN personal p ON p.id=n.para_personal_id WHERE n.tipo='VENTA_POSTERIOR' ORDER BY 1`)
assert.deepEqual(notis.map(x => x.nombre), []); ok('tocar un botón NO avisa a nadie: es interés, no una compra')
await OP.manejarRespuestaOferta({ contacto: '573001110008', tipo: 'button', boton: 'Recordatorios adicionales' })
assert.equal((await q(`SELECT count(*)::int n FROM ventas_posteriores WHERE oferta_id=$1`, [H.id]))[0].n, 1)
assert.equal((await q(`SELECT count(*)::int n FROM notificaciones`))[0].n, 0)
ok('tocar el mismo botón dos veces no duplica la venta')
{
  // (el uuid de COORD, que se declara más abajo)
  const [vi] = await q(`SELECT id FROM ventas_posteriores WHERE oferta_id=$1 AND categoria='RECORDATORIOS'`, [H.id])
  assert.equal((await VP.cambiarEstadoVenta({ id: vi.id, estado: 'COMPRA_REGISTRADA', personalId: '00000000-0000-4000-8000-000000000001' })).status, 409)
  const lista = await VP.listarVentas({ grupo: 'INTERES' })
  assert.ok(lista.ventas.some(x => x.id === vi.id && x.grupo === 'INTERES'))
  assert.ok(!(await VP.listarVentas({ grupo: 'COMPRA' })).ventas.some(x => x.id === vi.id))
  ok('sin compra con productos no se marca «Compra registrada», y la lista la deja en «Solo interés»')
}
// M3 de la revisión: botones PARECIDOS de otra plantilla, o por otra línea, no son de la oferta.
for (const ajeno of ['No deseo recibir llamadas', 'Cédula de mascota', 'Plan preexequial Oro']) {
  assert.equal(await OP.manejarRespuestaOferta({ contacto: '573001110008', tipo: 'button', boton: ajeno }), false, ajeno)
}
assert.equal(await OP.manejarRespuestaOferta({ phoneNumberId: '1313164878540238', contacto: '573001110008', tipo: 'button', boton: 'No deseo informacion' }), false)
assert.equal((await q(`SELECT count(*)::int n FROM oferta_exclusiones WHERE cliente_id=$1`, [S.H.cliente]))[0].n, 0)
assert.equal((await q(`SELECT count(*)::int n FROM ventas_posteriores WHERE oferta_id=$1`, [H.id]))[0].n, 1)
ok('un «No deseo…» o una «cédula» de OTRA plantilla, o por la línea de veterinarias, no se toca: ni baja ni venta')
await OP.manejarRespuestaOferta({ contacto: '573001110008', tipo: 'button', boton: 'Planes preexequiales' })
notis = await q(`SELECT p.nombre FROM notificaciones n JOIN personal p ON p.id=n.para_personal_id WHERE n.datos->>'categoria'='PREEXEQUIALES'`)
assert.deepEqual(notis.map(x => x.nombre), []); ok('el botón de pre-exequiales tampoco avisa (el aviso llega con la solicitud)')
// Baja
assert.equal(await OP.manejarRespuestaOferta({ contacto: '573001110001', tipo: 'button', boton: 'No deseo informacion' }), true)
assert.equal((await q(`SELECT count(*)::int n FROM oferta_exclusiones WHERE cliente_id=$1 AND origen='FAMILIA' AND retirado_en IS NULL`, [S.A.cliente]))[0].n, 1)
assert.equal(globalThis.__sobres.at(-1).tipo, 'text'); assert.equal((await oferta('A')).respuesta, 'NO_DESEA')
await OP.manejarRespuestaOferta({ contacto: '573001110001', tipo: 'button', boton: 'No deseo informacion' })
assert.equal((await q(`SELECT count(*)::int n FROM oferta_exclusiones WHERE cliente_id=$1`, [S.A.cliente]))[0].n, 1)
ok('«No deseo informacion» → marca a la familia (una sola vez) y le contesta con respeto')

paso('Portal: ver la oferta')
assert.equal((await PORTAL.verOferta({ codigo: 'x' })).status, 404)
assert.equal((await PORTAL.verOferta({ codigo: 'f'.repeat(32) })).status, 404)
assert.equal((await PORTAL.verOferta({ codigo: (await oferta('C')).codigo })).status, 404)
ok('código inválido, inexistente o de una oferta excluida → 404')
let v = (await PORTAL.verOferta({ codigo: H.codigo })).body
assert.equal(v.vigente, true); assert.equal(v.mascota, 'Simba'); assert.equal(v.familia, 'Hugo')
assert.deepEqual(v.recordatorios.map(p => [p.nombre, p.precio_lista, p.precio]), [['Huella 3D', 100000, 70000], ['Memopet', 26000, 18200]])
assert.deepEqual(v.cedulas.map(p => [p.nombre, p.precio_lista, p.precio]), [['Cédula de mascota', 37000, 18500]])
ok('recordatorios al 30 %, cédula al 50 %; lo no público no aparece')
assert.deepEqual(v.planes.map(p => [p.nivel, p.tipo, p.valor_lista, p.valor]),
  [['BRONCE', 'ANUAL', 37000, 18500], ['PLATA', 'ANUAL', 60000, 30000], ['PLATA', 'VITALICIO', 380000, 190000], ['DIAMANTE', 'ANUAL', 143000, 71500]])
assert.deepEqual(v.planes[0].activacion, { hasta_180: 185000, desde_181: 111000 })
assert.deepEqual(v.planes[0].equivale, ['Básico']); assert.equal(v.planes[2].activacion, null)
ok('planes con precio al 50 %; ORO (sin precio) no se ofrece; activación 5×/3× sobre el precio de LISTA')
const texto = JSON.stringify(v)
assert.ok(!texto.includes('3001110008') && !texto.includes('1020') && !texto.includes('PEREZ'))
ok('el portal NO devuelve teléfono, cédula ni apellido de la ficha')
const vA = (await PORTAL.verOferta({ codigo: (await oferta('A')).codigo })).body
assert.deepEqual(vA.recordatorios.map(p => p.nombre), ['Huella 3D']); assert.equal(vA.baja, true)
ok('a Ana no se le ofrece el Memopet que ya venía en su servicio; el portal sabe que pidió la baja')

paso('Portal: comprar recordatorios')
const AUT = { autorizacion: { aceptada: true, politica_version: '1.1' } }
const ENT = { direccion: 'Calle 1 # 2-3', ciudad: 'Bogotá', barrio: 'Chapinero', recibe: 'Hugo', telefono: '3001110008', indicaciones: 'Portería' }
const MEMO = 'aaaaaaaa-0000-4000-8000-000000000001', HUELLA = 'aaaaaaaa-0000-4000-8000-000000000002', CED = 'aaaaaaaa-0000-4000-8000-000000000003', INT = 'aaaaaaaa-0000-4000-8000-000000000004'
const b1 = (await PORTAL.borradorOferta({ codigo: H.codigo, contexto: { ip: '1.2.3.4' } })).body.borrador
const foto = b => `https://db.orbitacac.com/storage/v1/object/public/fotos-clientes/compra-web/${b}/f.jpg`
const pedido = (extra = {}) => ({ categoria: 'RECORDATORIOS', borrador: b1, ...AUT,
  items: [{ recordatorio_id: MEMO, cantidad: 2, imagenes_urls: [foto(b1)], precio_unitario: 1 }, { recordatorio_id: HUELLA, cantidad: 1 }],
  entrega: ENT, pago: { modo: 'DESPUES' }, observaciones: 'Gracias', ...extra })
assert.equal((await PORTAL.comprarOferta({ codigo: H.codigo, payload: pedido({ autorizacion: null }) })).status, 422)
ok('sin la casilla de datos personales → 422')
assert.equal((await PORTAL.comprarOferta({ codigo: H.codigo, payload: pedido({ items: [{ recordatorio_id: CED, cantidad: 1, imagenes_urls: [foto(b1)] }] }) })).status, 400)
ok('una cédula no se puede colar en un pedido de recordatorios')
assert.equal((await PORTAL.comprarOferta({ codigo: H.codigo, payload: pedido({ items: [{ recordatorio_id: INT, cantidad: 1 }] }) })).status, 400)
ok('un producto que no está a la venta → 400')
assert.equal((await PORTAL.comprarOferta({ codigo: H.codigo, payload: pedido({ items: [{ recordatorio_id: MEMO, cantidad: 1, imagenes_urls: ['https://otro.sitio/x.jpg'] }] }) })).status, 400)
ok('una foto que no es de la carpeta del pedido → 400')
assert.equal((await PORTAL.comprarOferta({ codigo: H.codigo, payload: pedido({ entrega: { ...ENT, direccion: '' } }) })).status, 400)
ok('producto físico sin dirección → 400 (no pasa a producción incompleto)')
assert.equal((await q(`SELECT count(*)::int n FROM compras_recordatorios`))[0].n, 0); ok('ningún intento fallido dejó nada a medias')
let c1 = await PORTAL.comprarOferta({ codigo: H.codigo, payload: pedido(), contexto: { ip: '1.2.3.4', userAgent: 'x' } })
assert.equal(c1.status, 201); assert.equal(c1.body.total, 2 * 18200 + 70000 + 12000)
let compra = (await q(`SELECT * FROM compras_recordatorios`))[0]
assert.equal(compra.origen, 'OFERTA_POSTERIOR'); assert.equal(compra.cliente_id, S.H.cliente); assert.equal(compra.mascota_id, S.H.mascota)
assert.equal(Number(compra.total), 118400); assert.equal(Number(compra.valor_envio), 12000); assert.equal(compra.pago_cliente.modo, 'DESPUES')
let its = await q(`SELECT nombre, cantidad, precio_unitario::int p FROM compra_recordatorio_items ORDER BY nombre`)
assert.deepEqual(its, [{ nombre: 'Huella 3D', cantidad: 1, p: 70000 }, { nombre: 'Memopet', cantidad: 2, p: 18200 }])
ok('compra creada con el precio de la BASE (el «precio_unitario: 1» del navegador se ignoró) + envío')
ventas = await q(`SELECT * FROM ventas_posteriores WHERE oferta_id=$1 AND categoria='RECORDATORIOS'`, [H.id])
assert.equal(ventas[0].estado, 'COMPRA_REGISTRADA'); assert.equal(compra.venta_posterior_id, ventas[0].id)
assert.equal((await q(`SELECT origen FROM autorizaciones_datos`))[0].origen, 'OFERTA_POSTERIOR')
assert.ok((await q(`SELECT titulo FROM notificaciones`)).some(x => /COMPRA ADICIONAL – RECORDATORIO/.test(x.titulo)))
ok('venta → COMPRA_REGISTRADA, autorización guardada, aviso «COMPRA ADICIONAL – RECORDATORIO»')
c1 = await PORTAL.comprarOferta({ codigo: H.codigo, payload: pedido() })
assert.equal(c1.body.repetida, true); assert.equal((await q(`SELECT count(*)::int n FROM compras_recordatorios`))[0].n, 1)
ok('reintento por corte de red: no duplica la compra')

paso('Portal: cédula para una mascotica viva')
const b2 = (await PORTAL.borradorOferta({ codigo: H.codigo })).body.borrador
const ced = (extra = {}) => ({ categoria: 'CEDULAS', borrador: b2, ...AUT,
  items: [{ recordatorio_id: CED, cantidad: 1, imagenes_urls: [foto(b2)], datos_cliente: { 'Color y señas particulares': ['Negro'] } }],
  mascota: { nombre: 'Nube', especie_id: 2, sexo: 'Hembra', raza: 'Criolla', fecha_nacimiento: '2022-05-01' },
  entrega: ENT, pago: { modo: 'COMPROBANTE', metodo: 'NEQUI', comprobante_url: foto(b2) }, ...extra })
assert.equal((await PORTAL.comprarOferta({ codigo: H.codigo, payload: ced({ mascota: { nombre: 'Nube' } }) })).status, 400)
assert.equal((await q(`SELECT count(*)::int n FROM mascotas WHERE nombre='Nube'`))[0].n, 0)
ok('cédula sin especie/sexo → 400 y no queda la mascota a medias')
const c2 = await PORTAL.comprarOferta({ codigo: H.codigo, payload: ced() })
assert.equal(c2.status, 201); assert.equal(c2.body.total, 18500 + 12000)
const nube = (await q(`SELECT * FROM mascotas WHERE nombre='Nube'`))[0]
assert.equal(nube.fallecida, false); assert.equal(nube.cliente_id, S.H.cliente)
compra = (await q(`SELECT * FROM compras_recordatorios WHERE id=$1`, [b2]))[0]
assert.equal(compra.mascota_id, nube.id_mascota); assert.equal(compra.pago_cliente.modo, 'COMPROBANTE')
ok('cédula al 50 % para «Nube», registrada VIVA en la ficha de la familia; comprobante por verificar')

paso('Portal: plan pre-exequial')
const SOL = { ...AUT, plan: { nivel: 'PLATA', tipo: 'ANUAL' },
  propietario: { nombre: 'Hugo', apellido: 'Pérez', documento: '1020304050', whatsapp: '3001110008', email: 'h@x.co', direccion: 'Calle 1' },
  mascotas: [{ nombre: 'Nube', especie_id: 2, sexo: 'Hembra', peso_kg: 4, edad: '3 años' }, { nombre: 'Trueno', especie_id: 1, sexo: 'Macho', peso_kg: '22,5', fecha_nacimiento: '2020-01-01' }] }
await PORTAL.eventoOferta({ codigo: H.codigo, payload: { categoria: 'PREEXEQUIALES', paso: 'FORMULARIO_INICIADO' } })
let pre = (await q(`SELECT * FROM ventas_posteriores WHERE oferta_id=$1 AND categoria='PREEXEQUIALES'`, [H.id]))[0]
assert.equal(pre.estado, 'FORMULARIO_INICIADO'); ok('abrir el formulario → FORMULARIO_INICIADO')
assert.equal((await PORTAL.solicitarAfiliacion({ codigo: H.codigo, payload: { ...SOL, plan: { nivel: 'ORO', tipo: 'ANUAL' } } })).status, 400)
ok('un plan sin precio (ORO) no se puede solicitar')
assert.equal((await PORTAL.reportarPagoAfiliacion({ codigo: H.codigo, payload: { borrador: b2 } })).status, 409)
ok('no se puede reportar un pago antes de completar el formulario')
let sa = await PORTAL.solicitarAfiliacion({ codigo: H.codigo, payload: SOL })
assert.equal(sa.status, 200); assert.equal(sa.body.total, 60000); assert.equal(sa.body.valor, 30000); assert.equal(sa.body.datos_pago, 'Nequi 300 000 0000')
pre = (await q(`SELECT * FROM ventas_posteriores WHERE id=$1`, [pre.id]))[0]
assert.equal(pre.estado, 'PENDIENTE_PAGO'); assert.equal(Number(pre.valor_lista), 60000); assert.equal(Number(pre.descuento_pct), 50); assert.equal(Number(pre.valor), 30000)
assert.equal(pre.solicitud.mascotas[1].peso_kg, 22.5); assert.equal(pre.solicitud.mascotas[0].especie, 'Gato')
assert.equal(pre.afiliacion_id, null)
assert.equal((await q(`SELECT count(*)::int n FROM afiliaciones`))[0].n, 0)
ok('solicitud guardada → PENDIENTE_PAGO, precio congelado (50 %). NO se creó ningún contrato')
const b3 = (await PORTAL.borradorOferta({ codigo: H.codigo })).body.borrador
assert.equal((await PORTAL.reportarPagoAfiliacion({ codigo: H.codigo, payload: { borrador: b3, metodo: 'NEQUI', comprobante_url: 'https://x/y.jpg' } })).status, 400)
const rp = await PORTAL.reportarPagoAfiliacion({ codigo: H.codigo, payload: { borrador: b3, metodo: 'NEQUI', comprobante_url: foto(b3) } })
assert.equal(rp.status, 200)
pre = (await q(`SELECT * FROM ventas_posteriores WHERE id=$1`, [pre.id]))[0]
assert.equal(pre.estado, 'PAGO_REPORTADO'); assert.equal(pre.pago_validado_en, null)
ok('la familia reporta el pago → PAGO_REPORTADO (todavía SIN validar)')
assert.equal((await PORTAL.solicitarAfiliacion({ codigo: H.codigo, payload: SOL })).status, 409)
ok('con el pago ya reportado, la solicitud no se puede sobrescribir')
v = (await PORTAL.verOferta({ codigo: H.codigo })).body
assert.deepEqual(v.solicitud_plan, { estado: 'PAGO_REPORTADO', plan: { nivel: 'PLATA', tipo: 'ANUAL' }, n_mascotas: 2, valor: 30000, total: 60000 })
ok('el portal sabe en qué va la solicitud (sin devolver los datos personales)')

paso('Coordinación: el contrato exige pago validado')
const COORD = '00000000-0000-4000-8000-000000000001'
const [af] = await q(`INSERT INTO afiliaciones (estado) VALUES ('VIGENTE') RETURNING id`)
await pg.query(`INSERT INTO afiliacion_contratos (afiliacion_id, numero, numero_contrato, descuento_motivo) VALUES ($1,0,'NOV1726HP50-PL0','OFERTA_POSTERIOR')`, [af.id])
assert.equal((await VP.vincularAfiliacion({ id: pre.id, afiliacionId: af.id, personalId: COORD })).status, 409)
assert.equal((await VP.cambiarEstadoVenta({ id: pre.id, estado: 'CONTRATO_GENERADO', personalId: COORD })).status, 409)
assert.equal((await VP.cambiarEstadoVenta({ id: pre.id, estado: 'AFILIACION_ACTIVA', personalId: COORD })).status, 409)
await assert.rejects(pg.query(`UPDATE ventas_posteriores SET estado='AFILIACION_ACTIVA' WHERE id=$1`, [pre.id]))
ok('sin pago validado: ni enlazar contrato, ni «contrato generado», ni «afiliación activa» — tampoco por SQL directo')
assert.equal((await VP.cambiarEstadoVenta({ id: pre.id, estado: 'CERRADA_SIN_VENTA', personalId: COORD })).status, 400)
ok('cerrar sin venta exige motivo')
assert.equal((await VP.validarPagoVenta({ id: pre.id, nota: 'Llegó a Nequi', personalId: COORD })).status, 200)
pre = (await q(`SELECT * FROM ventas_posteriores WHERE id=$1`, [pre.id]))[0]
assert.equal(pre.estado, 'PENDIENTE_CONTRATO'); assert.ok(pre.pago_validado_en); assert.equal(pre.pago_validado_por, COORD)
assert.equal((await VP.validarPagoVenta({ id: pre.id, personalId: COORD })).status, 409)
ok('validar el pago → PENDIENTE_CONTRATO (y no se valida dos veces)')
const vinc = await VP.vincularAfiliacion({ id: pre.id, afiliacionId: af.id, personalId: COORD })
assert.equal(vinc.status, 200); assert.equal(vinc.body.numero_contrato, 'NOV1726HP50-PL0')
pre = (await q(`SELECT * FROM ventas_posteriores WHERE id=$1`, [pre.id]))[0]
assert.equal(pre.estado, 'AFILIACION_ACTIVA'); assert.equal(pre.afiliacion_id, af.id)
ok('con el contrato creado por coordinación → AFILIACION_ACTIVA con su número')
await VP.cambiarEstadoVenta({ id: pre.id, estado: 'PAGO_REPORTADO', nota: 'Se validó por error', personalId: COORD })
assert.equal((await q(`SELECT pago_validado_en FROM ventas_posteriores WHERE id=$1`, [pre.id]))[0].pago_validado_en, null)
ok('devolverla a «pago reportado» quita la validación')
assert.equal((await VP.validarPagoVenta({ id: ventas[0].id, personalId: COORD })).status, 409)
ok('el pago de una compra de recordatorios no se valida aquí (va en Compras)')

paso('Una validación vieja no autoriza una solicitud nueva (M1 de la revisión)')
await VP.validarPagoVenta({ id: pre.id, personalId: COORD })
assert.equal((await VP.cambiarEstadoVenta({ id: pre.id, estado: 'CERRADA_SIN_VENTA', nota: 'La familia desistió', personalId: COORD })).status, 200)
pre = (await q(`SELECT * FROM ventas_posteriores WHERE id=$1`, [pre.id]))[0]
assert.equal(pre.estado, 'CERRADA_SIN_VENTA'); assert.equal(pre.pago_validado_en, null); assert.equal(pre.motivo_cierre, 'La familia desistió')
ok('cerrar sin venta quita la validación del pago')
await PORTAL.eventoOferta({ codigo: H.codigo, payload: { categoria: 'PREEXEQUIALES', paso: 'INTERESADO' } })
pre = (await q(`SELECT * FROM ventas_posteriores WHERE id=$1`, [pre.id]))[0]
assert.equal(pre.estado, 'CERRADA_SIN_VENTA'); assert.equal(pre.motivo_cierre, 'La familia desistió')
ok('volver a MIRAR el portal no reabre una venta cerrada ni borra su motivo')
const avisosAntes = (await q(`SELECT count(*)::int n FROM notificaciones`))[0].n
assert.equal((await PORTAL.solicitarAfiliacion({ codigo: H.codigo, payload: { ...SOL, plan: { nivel: 'DIAMANTE', tipo: 'ANUAL' } } })).status, 200)
pre = (await q(`SELECT * FROM ventas_posteriores WHERE id=$1`, [pre.id]))[0]
assert.equal(pre.estado, 'PENDIENTE_PAGO'); assert.equal(pre.pago_validado_en, null); assert.equal(Number(pre.valor), 71500)
assert.ok((await q(`SELECT count(*)::int n FROM notificaciones`))[0].n > avisosAntes)
assert.equal((await VP.vincularAfiliacion({ id: pre.id, afiliacionId: af.id, personalId: COORD })).status, 409)
assert.equal((await VP.cambiarEstadoVenta({ id: pre.id, estado: 'CONTRATO_GENERADO', personalId: COORD })).status, 409)
ok('si la familia vuelve y pide OTRO plan, es una solicitud nueva sin pagar: no hay contrato hasta validar de nuevo')
assert.equal((await PORTAL.solicitarAfiliacion({ codigo: H.codigo, payload: SOL })).status, 200)   // vuelve al plan de antes

paso('Una oferta que Meta no entregó no bloquea a la otra mascotica (L10)')
{
  const [c] = await q(`INSERT INTO clientes (nombre, apellido, whatsapp) VALUES ('Nora','Z','3001110030') RETURNING id_cliente`)
  const sv = []
  for (const [nom, dias] of [['Uno', 61], ['Dos', 60]]) {
    const [m] = await q(`INSERT INTO mascotas (nombre, especie_id, tamano, peso_kg, cliente_id, fallecida, fecha_fallecimiento) VALUES ($1,1,'Mediano',5,$2,true,fn_hoy_bogota()-$3::int) RETURNING id_mascota`, [nom, c.id_cliente, dias])
    const [s] = await q(`INSERT INTO servicios (mascota_id, plan_id, estado, fecha_entrega_real) VALUES ($1,1,'ENTREGADO',fn_hoy_bogota()-30) RETURNING id`, [m.id_mascota])
    sv.push(s.id)
  }
  await OP.prepararOfertas()
  const [o1] = await q(`SELECT id FROM ofertas_posteriores WHERE servicio_id=$1`, [sv[0]])
  const [o2] = await q(`SELECT id FROM ofertas_posteriores WHERE servicio_id=$1`, [sv[1]])
  const e = await OP.enviarOferta({ id: o1.id })
  await pg.query(`INSERT INTO whatsapp_mensajes (wa_message_id, estado) VALUES ($1,'failed')`, [e.mensaje_id])
  assert.equal((await OP.enviarOferta({ id: o2.id })).enviado, true)
  ok('la primera falló en Meta → la segunda mascotica SÍ recibe la oferta')
}

paso('Coordinación: listas y detalle')
const lv = await VP.listarVentas({})
assert.equal(lv.ventas.length, 3)
const fila = lv.ventas.find(x => x.categoria === 'RECORDATORIOS')
assert.equal(fila.compras, 1); assert.equal(Number(fila.compras_total), 118400); assert.equal(fila.mascota, 'Simba')
assert.equal((await VP.listarVentas({ categoria: 'CEDULAS' })).ventas.length, 1)
assert.equal((await VP.listarVentas({ estado: 'ABIERTAS' })).ventas.length, 1)
assert.equal((await VP.listarVentas({ q: 'hugo' })).ventas.length, 3)
assert.equal((await VP.listarVentas({ q: '300 111 0008' })).ventas.length, 3)
assert.equal((await VP.listarVentas({ q: 'nadie' })).ventas.length, 0)
assert.equal((await VP.listarVentas({ q: "o'brien%" })).ventas.length, 0)
ok('lista con filtros por categoría, estado, nombre y teléfono')
const det = (await VP.detalleVenta({ id: pre.id })).body
assert.equal(det.venta.solicitud.propietario.documento, '1020304050'); assert.ok(det.eventos.length >= 6)
assert.equal(det.estados.length, 10)
const detR = (await VP.detalleVenta({ id: ventas[0].id })).body
assert.equal(detR.compras.length, 1); assert.match(detR.compras[0].items, /Memopet ×2/)
assert.equal((await VP.notaVenta({ id: pre.id, texto: 'Llamar el lunes', personalId: COORD })).status, 200)
ok('detalle con solicitud, bitácora, compras y notas')

paso('Coordinación: envíos, excluir y «No contactar»')
const lo = await OP.listarOfertas({})
assert.equal(lo.dia, HOY); assert.ok(lo.filas.length >= 3); assert.equal(lo.config.descuentos.CEDULAS, 50)
assert.ok(lo.filas.every(f => f.enlace.includes('/#/oferta/')))
assert.equal(lo.embudo.enviadas, 5); assert.equal(lo.embudo.no_desean, 1)
ok(`vista del día: ${lo.filas.length} filas · embudo ${JSON.stringify(lo.embudo)}`)
const L = await oferta('L')
assert.equal((await OP.excluirOferta({ id: L.id, motivo: '', personalId: COORD })).status, 400)
assert.equal((await OP.excluirOferta({ id: L.id, motivo: 'Familia en duelo difícil', noVolver: true, personalId: COORD })).status, 200)
assert.equal((await OP.reincluirOferta({ id: L.id })).status, 409)
ok('«Excluir de ofertas posteriores» marca a la familia; no se puede reincluir mientras siga marcada')
const excl = await OP.listarExclusiones()
const deLola = excl.find(e => e.cliente_id === S.L.cliente)
assert.equal(deLola.origen, 'EQUIPO'); assert.equal(deLola.creado_por_nombre, 'Coordi')
assert.equal((await OP.retirarExclusion({ id: deLola.id, personalId: COORD })).status, 200)
assert.equal((await OP.reincluirOferta({ id: L.id })).status, 200)
assert.equal((await oferta('L')).forzada, true); assert.equal((await oferta('L')).estado, 'PENDIENTE')
ok('retirar la marca y volver a incluir → PENDIENTE y forzada')
const B = await oferta('B')
assert.equal((await OP.reincluirOferta({ id: B.id })).status, 200)
await OP.revisarExclusiones()
assert.equal((await oferta('B')).estado, 'PENDIENTE'); ok('una reincluida a mano (forzada) ya no la excluye sola la regla de calificación')
assert.equal((await OP.crearExclusion({ telefono: '300 111 0002', motivo: 'Lo pidió', personalId: COORD })).status, 200)
assert.match((await oferta('B')).motivo_exclusion, /pidió no recibir/); ok('…pero «No contactar» SÍ la saca siempre, aunque esté forzada')
assert.equal((await OP.crearExclusion({ telefono: '3001110002', motivo: 'Otra vez', personalId: COORD })).status, 409)
assert.equal((await OP.crearExclusion({ telefono: '123', motivo: 'x', personalId: COORD })).status, 400)
ok('no se duplica la marca; número inválido → 400')
assert.equal((await PORTAL.bajaOferta({ codigo: H.codigo })).status, 200)
assert.equal((await q(`SELECT count(*)::int n FROM oferta_exclusiones WHERE cliente_id=$1 AND retirado_en IS NULL`, [S.H.cliente]))[0].n, 1)
ok('baja desde el portal')

paso('Coordinación: «Registrar la compra» de una familia que compró por chat (REPORTE ORBIT 27-nov)')
{
  const CR = await import(`${SRC}/compras-recordatorios.js`)
  const oA = await oferta('A')
  const [vA] = await q(`INSERT INTO ventas_posteriores (oferta_id, categoria) VALUES ($1,'RECORDATORIOS') RETURNING id`, [oA.id])
  await pg.query(`DELETE FROM notificaciones`)
  const llamar = async body => {
    const res = { c: 0, b: null, status(c) { this.c = c; return this }, json(b) { this.b = b; return this } }
    await CR.crearCompra({ body, personal: { id: COORD }, headers: {}, ip: '127.0.0.1', socket: {} }, res)
    return res
  }
  const cuerpo = {
    id: '22222222-2222-4222-8222-222222222222',
    cliente: { id_cliente: S.A.cliente }, mascota: { id_mascota: S.A.mascota },
    items: [{ recordatorio_id: 'aaaaaaaa-0000-4000-8000-000000000002', cantidad: 2, precio_unitario: 70000 }],
    autorizacion: { aceptada: true, politica_version: '1.1' }, venta_posterior_id: vA.id,
  }
  const r = await llamar(cuerpo)
  // 201 en prod. Aquí puede ser 500: DESPUÉS del COMMIT, `leerDetalle` (el mismo
  // del detalle de cualquier compra) lee ~15 columnas y 2 tablas que este
  // schema.sql mínimo no tiene. Lo que importa se comprueba en la base, abajo.
  assert.ok([201, 500].includes(r.c), `crearCompra respondió ${r.c} ${JSON.stringify(r.b)}`)
  const [cA] = await q(`SELECT * FROM compras_recordatorios WHERE id = $1`, [cuerpo.id])
  assert.equal(cA.origen, 'OFERTA_POSTERIOR'); assert.equal(cA.venta_posterior_id, vA.id); assert.equal(cA.registrado_por, COORD)
  const [vA2] = await q(`SELECT estado FROM ventas_posteriores WHERE id = $1`, [vA.id])
  assert.equal(vA2.estado, 'COMPRA_REGISTRADA')
  const ev = await q(`SELECT detalle FROM venta_posterior_eventos WHERE venta_id = $1 AND tipo = 'ESTADO'`, [vA.id])
  assert.ok(ev.some(e => e.detalle.a === 'COMPRA_REGISTRADA' && /Huella 3D ×2/.test(e.detalle.items) && e.detalle.origen === 'EQUIPO'))
  const avisos = await q(`SELECT p.nombre, n.titulo FROM notificaciones n JOIN personal p ON p.id = n.para_personal_id`)
  assert.ok(avisos.some(a => a.nombre === 'Produ' && /COMPRA ADICIONAL – RECORDATORIO/.test(a.titulo)), JSON.stringify(avisos))
  const lista = await VP.listarVentas({ grupo: 'COMPRA' })
  const fila = lista.ventas.find(x => x.id === vA.id)
  assert.ok(fila && fila.compras_items === 'Huella 3D ×2', JSON.stringify(fila))
  ok('la compra queda OFERTA_POSTERIOR + ligada, la oportunidad pasa a «Compra registrada», Diseño recibe el aviso y la lista dice qué compró')
  // Un plan pre-exequial no se registra como compra de recordatorios.
  const [pA] = await q(`INSERT INTO ventas_posteriores (oferta_id, categoria) VALUES ($1,'PREEXEQUIALES') RETURNING id`, [oA.id])
  const r2 = await llamar({ ...cuerpo, id: '33333333-3333-4333-8333-333333333333', venta_posterior_id: pA.id })
  assert.equal(r2.c, 409)
  assert.equal((await q(`SELECT count(*)::int n FROM compras_recordatorios WHERE id = '33333333-3333-4333-8333-333333333333'`))[0].n, 0)
  ok('ligarla a un pre-exequial → 409 y no queda compra a medias')
}

paso('Vigencia')
await pg.query(`UPDATE ofertas_posteriores SET fecha_envio = now() - interval '45 days' WHERE id=$1`, [H.id])
v = (await PORTAL.verOferta({ codigo: H.codigo })).body
assert.equal(v.vigente, false); assert.equal(v.recordatorios, undefined)
assert.equal((await PORTAL.borradorOferta({ codigo: H.codigo })).status, 410)
assert.equal((await PORTAL.comprarOferta({ codigo: H.codigo, payload: { ...pedido(), borrador: '11111111-1111-4111-8111-111111111111' } })).status, 410)
ok('pasados los 30 días la oferta cierra: no muestra precios ni acepta pedidos')

paso('«Ver contactos» de /automatizaciones (SQL real del archivo)')
const envios = fs.readFileSync(`${REPO}/orbit-backend/src/automatizaciones-envios.js`, 'utf8')
const bloque = envios.match(/oferta_posterior: `([\s\S]*?)`,\r?\n/)[1]
  .replace('${PROPIETARIO}', `TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,''))`)
const filasEnv = await q(bloque)
assert.ok(filasEnv.length >= 8)
assert.ok(filasEnv.some(f => f.estado === 'CANCELADO') && filasEnv.some(f => /no desea/.test(f.detalle)))
ok(`la fuente devuelve ${filasEnv.length} filas con las columnas esperadas`)
const AUTO = fs.readFileSync(`${REPO}/orbit-backend/src/automatizaciones.js`, 'utf8')
const sqlFlujo = { tabla: 'public.ofertas_posteriores', ok: "estado = 'ENVIADO'", error: "estado = 'ERROR'", pendiente: "estado IN ('PENDIENTE', 'ENVIANDO') AND fecha_programada <= public.fn_hoy_bogota()" }
assert.ok(AUTO.includes("tabla: 'public.ofertas_posteriores'"))
await q(`SELECT count(*) FILTER (WHERE ${sqlFlujo.ok}) a, count(*) FILTER (WHERE ${sqlFlujo.error}) b, count(*) FILTER (WHERE ${sqlFlujo.pendiente}) c FROM ${sqlFlujo.tabla}`)
ok('los filtros de la tarjeta de automatizaciones son SQL válido')

console.log(`\n✅ ${n} comprobaciones pasaron\n`)
