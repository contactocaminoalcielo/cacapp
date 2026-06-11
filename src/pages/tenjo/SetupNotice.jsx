// Aviso cuando las tablas de Fase 1 aún no existen en la base de datos.
export default function SetupNotice() {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
      <div className="text-3xl mb-2">🛠️</div>
      <p className="text-[14px] font-bold text-amber-800">Falta aplicar la migración de base de datos</p>
      <p className="text-[12px] text-amber-700 mt-1">
        Ejecuta <code className="font-mono bg-amber-100 px-1.5 py-0.5 rounded">migrations/003_fase1_modelo_tenjo.sql</code> en
        el servidor (SSH → psql) y recarga esta página. El resto del módulo Tenjo sigue funcionando normal.
      </p>
    </div>
  )
}
