import { createClient } from '@supabase/supabase-js'

const db = createClient(
  'https://gfnvrmpcwchqdyozwygd.supabase.co',
  'REDACTED_SERVICE_ROLE_KEY',
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const TABLAS_HIJAS = [
  'nps_seguimiento',
  'novedades_servicio',
  'comisiones_aliados',
  'entregas',
  'servicio_recordatorios',
  'solicitudes_imagenes',
  'seguimiento_compostaje',
  'procesos_disposicion',
  'traslados_tenjo',
  'cuarto_frio',
  'recogidas',
]

console.log('Iniciando limpieza de servicios...\n')

for (const tabla of TABLAS_HIJAS) {
  const { error, count } = await db.from(tabla).delete().neq('id', '00000000-0000-0000-0000-000000000000').select('*', { count: 'exact', head: true })
  if (error && !error.message.includes('does not exist') && !error.message.includes('no rows')) {
    // Try with different PK if 'id' doesn't exist
    const { error: e2 } = await db.from(tabla).delete().gte('created_at', '2000-01-01')
    if (e2 && !e2.message.includes('does not exist')) {
      console.log(`  ⚠ ${tabla}: ${e2.message}`)
    } else {
      console.log(`  ✓ ${tabla}: limpiada`)
    }
  } else {
    console.log(`  ✓ ${tabla}: limpiada`)
  }
}

// Limpiar lotes_grupales si existe
const { error: lg } = await db.from('lotes_grupales').delete().gte('created_at', '2000-01-01')
if (!lg) console.log('  ✓ lotes_grupales: limpiada')

// Finalmente servicios
const { error: svcErr, data: svcData } = await db.from('servicios').delete().gte('fecha_ingreso', '2000-01-01').select('id')
if (svcErr) {
  console.log(`\n✗ ERROR borrando servicios: ${svcErr.message}`)
} else {
  console.log(`\n✓ servicios: ${svcData?.length ?? 0} registros eliminados`)
}

console.log('\nLimpieza completada.')
