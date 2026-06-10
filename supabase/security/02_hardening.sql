-- ============================================================
-- ORBIT — HARDENING RLS COMPLETO
-- Fecha: 2026-06-04 | Proyecto: gfnvrmpcwchqdyozwygd
-- ============================================================
-- Objetivo:
--   1. Habilitar RLS en las 33 tablas que lo tenían desactivado
--   2. Eliminar todas las policies inseguras (allow_all, dead code)
--   3. Crear: authenticated = acceso completo a todo
--   4. Crear: anon = solo lo que usan /solicitud y /fotos (rutas públicas)
--   5. Eliminar anon SELECT sin filtro en solicitudes_servicio
--
-- NO cambia: lógica de negocio, estructura de tablas, grants, storage
-- service_role sigue bypassando RLS (comportamiento de Supabase)
-- ============================================================

BEGIN;

-- ============================================================
-- BLOQUE 1: HABILITAR RLS EN 33 TABLAS
-- ============================================================
ALTER TABLE public.aliados                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canal_origen           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comisiones_aliados     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_comisiones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuarto_frio            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entregas               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.especies               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flujos_proceso         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maquinas_produccion    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mascotas               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos_inventario  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.novedades_servicio     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nps_seguimiento        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_roles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_recordatorios     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planes                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planes_precios         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planes_presequiales    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procesos_disposicion   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recogidas              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recordatorio_materiales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recordatorios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles_personal         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seguimiento_compostaje  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.servicio_recordatorios  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.servicios              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitudes_imagenes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tipo_establecimiento   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.traslados_tenjo        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vip_recordatorios      ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- BLOQUE 2: ELIMINAR POLICIES INSEGURAS
-- ============================================================

-- Tablas previamente RLS=OFF (dead code policies)
DROP POLICY IF EXISTS "lectura_publica"             ON public.aliados;
DROP POLICY IF EXISTS "permitir lectura publica"    ON public.aliados;
DROP POLICY IF EXISTS "lectura_publica"             ON public.canal_origen;
DROP POLICY IF EXISTS "permitir lectura publica"    ON public.canal_origen;
DROP POLICY IF EXISTS "lectura_publica"             ON public.clientes;
DROP POLICY IF EXISTS "permitir lectura publica"    ON public.clientes;
DROP POLICY IF EXISTS "escritura_publica"           ON public.clientes;
DROP POLICY IF EXISTS "lectura_publica"             ON public.cuarto_frio;
DROP POLICY IF EXISTS "escritura_publica"           ON public.cuarto_frio;
DROP POLICY IF EXISTS "lectura_publica"             ON public.entregas;
DROP POLICY IF EXISTS "actualizacion_publica"       ON public.entregas;
DROP POLICY IF EXISTS "escritura_publica"           ON public.entregas;
DROP POLICY IF EXISTS "lectura_publica"             ON public.especies;
DROP POLICY IF EXISTS "permitir lectura publica"    ON public.especies;
DROP POLICY IF EXISTS "lectura_publica"             ON public.flujos_proceso;
DROP POLICY IF EXISTS "lectura_publica"             ON public.mascotas;
DROP POLICY IF EXISTS "escritura_publica"           ON public.mascotas;
DROP POLICY IF EXISTS "permitir lectura publica"    ON public.mascotas;
DROP POLICY IF EXISTS "lectura_publica"             ON public.novedades_servicio;
DROP POLICY IF EXISTS "escritura_publica"           ON public.novedades_servicio;
DROP POLICY IF EXISTS "lectura_publica"             ON public.personal;
DROP POLICY IF EXISTS "permitir lectura publica"    ON public.personal;
DROP POLICY IF EXISTS "personal_lectura_autenticados" ON public.personal;
DROP POLICY IF EXISTS "lectura_publica"             ON public.plan_recordatorios;
DROP POLICY IF EXISTS "permitir lectura publica"    ON public.plan_recordatorios;
DROP POLICY IF EXISTS "lectura_publica"             ON public.planes;
DROP POLICY IF EXISTS "permitir lectura publica"    ON public.planes;
DROP POLICY IF EXISTS "lectura_publica"             ON public.recogidas;
DROP POLICY IF EXISTS "actualizacion_publica"       ON public.recogidas;
DROP POLICY IF EXISTS "escritura_publica"           ON public.recogidas;
DROP POLICY IF EXISTS "lectura_publica"             ON public.seguimiento_compostaje;
DROP POLICY IF EXISTS "escritura_publica"           ON public.seguimiento_compostaje;
DROP POLICY IF EXISTS "lectura_publica"             ON public.servicio_recordatorios;
DROP POLICY IF EXISTS "actualizacion_publica"       ON public.servicio_recordatorios;
DROP POLICY IF EXISTS "escritura_publica"           ON public.servicio_recordatorios;
DROP POLICY IF EXISTS "lectura_publica"             ON public.servicios;
DROP POLICY IF EXISTS "actualizacion_publica"       ON public.servicios;
DROP POLICY IF EXISTS "escritura_publica"           ON public.servicios;
DROP POLICY IF EXISTS "lectura_publica"             ON public.tipo_establecimiento;

-- Tablas que ya tenían RLS=ON con allow_all (inseguro)
DROP POLICY IF EXISTS "allow_all" ON public.certificados_emitidos;
DROP POLICY IF EXISTS "allow_all" ON public.config_sistema;
DROP POLICY IF EXISTS "allow_all" ON public.cuarto_frio_movimientos;
DROP POLICY IF EXISTS "allow_all" ON public.estado_cuarto_frio;
DROP POLICY IF EXISTS "lectura_publica"  ON public.estado_cuarto_frio;
DROP POLICY IF EXISTS "escritura_publica" ON public.estado_cuarto_frio;
DROP POLICY IF EXISTS "allow_all" ON public.estado_nevera_reporte;
DROP POLICY IF EXISTS "lectura_publica"  ON public.estado_nevera_reporte;
DROP POLICY IF EXISTS "escritura_publica" ON public.estado_nevera_reporte;
DROP POLICY IF EXISTS "allow_all" ON public.lotes_grupales;
DROP POLICY IF EXISTS "allow_all" ON public.neveras;
DROP POLICY IF EXISTS "allow_all" ON public.notificaciones;
DROP POLICY IF EXISTS "allow_all" ON public.recibos_tecnico;

-- solicitudes_servicio: eliminar SELECT total de anon (clientes no deben ver solicitudes ajenas)
DROP POLICY IF EXISTS "solicitudes_anon_insert" ON public.solicitudes_servicio;
DROP POLICY IF EXISTS "solicitudes_auth_all"    ON public.solicitudes_servicio;
DROP POLICY IF EXISTS "solicitudes_anon_select" ON public.solicitudes_servicio;

-- ============================================================
-- BLOQUE 3: CREAR POLICY authenticated = ACCESO COMPLETO (43 tablas)
-- Cubre: coordinadores, técnicos, mensajeros, productores, operarios, admins
-- ============================================================
CREATE POLICY "auth_full" ON public.aliados                 FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.canal_origen            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.certificados_emitidos   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.clientes                FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.comisiones_aliados      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.config_comisiones       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.config_sistema          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.cuarto_frio             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.cuarto_frio_movimientos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.entregas                FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.especies                FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.estado_cuarto_frio      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.estado_nevera_reporte   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.flujos_proceso          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.inventario              FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.lotes_grupales          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.maquinas_produccion     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.mascotas                FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.movimientos_inventario  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.neveras                 FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.notificaciones          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.novedades_servicio      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.nps_seguimiento         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.personal                FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.personal_roles          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.plan_recordatorios      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.planes                  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.planes_precios          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.planes_presequiales     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.procesos_disposicion    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.recibos_tecnico         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.recogidas               FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.recordatorio_materiales FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.recordatorios           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.roles_personal          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.seguimiento_compostaje  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.servicio_recordatorios  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.servicios               FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.solicitudes_imagenes    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.solicitudes_servicio    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.tipo_establecimiento    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.traslados_tenjo         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON public.vip_recordatorios       FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- BLOQUE 4: CREAR POLICIES anon — CATÁLOGOS PÚBLICOS
-- Usados por SolicitudCliente.jsx (/solicitud) y FotosCliente.jsx (/fotos)
-- ============================================================

-- planes: SolicitudCliente carga catálogo de planes con precios
CREATE POLICY "anon_select" ON public.planes
  FOR SELECT TO anon USING (true);

-- planes_precios: SolicitudCliente muestra precios por peso/especie
CREATE POLICY "anon_select" ON public.planes_precios
  FOR SELECT TO anon USING (true);

-- plan_recordatorios: SolicitudCliente muestra artículos incluidos por plan
CREATE POLICY "anon_select" ON public.plan_recordatorios
  FOR SELECT TO anon USING (true);

-- recordatorios: SolicitudCliente + FotosCliente acceden a definición de ítems
CREATE POLICY "anon_select" ON public.recordatorios
  FOR SELECT TO anon USING (true);

-- aliados: SolicitudCliente muestra lista de veterinarias registradas
CREATE POLICY "anon_select" ON public.aliados
  FOR SELECT TO anon USING (true);

-- especies: SolicitudCliente + FotosCliente necesitan catálogo de especies
CREATE POLICY "anon_select" ON public.especies
  FOR SELECT TO anon USING (true);

-- tipo_establecimiento: SolicitudCliente usa el catálogo de tipos de aliado
CREATE POLICY "anon_select" ON public.tipo_establecimiento
  FOR SELECT TO anon USING (true);

-- ============================================================
-- BLOQUE 5: POLICIES anon — ACCESO RESTRINGIDO (ruta /fotos)
-- FotosCliente.jsx necesita leer servicios/mascotas/sr por codigo_fotos
-- ============================================================

-- servicios: anon solo ve servicios que tienen código de fotos asignado
CREATE POLICY "anon_select_con_codigo" ON public.servicios
  FOR SELECT TO anon
  USING (codigo_fotos IS NOT NULL);

-- mascotas: anon solo ve mascotas vinculadas a un servicio con código de fotos
CREATE POLICY "anon_select_via_codigo" ON public.mascotas
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.servicios s
      WHERE s.mascota_id = mascotas.id_mascota
        AND s.codigo_fotos IS NOT NULL
    )
  );

-- servicio_recordatorios: anon solo ve ítems de servicios con código de fotos
CREATE POLICY "anon_select_via_codigo" ON public.servicio_recordatorios
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.servicios s
      WHERE s.id = servicio_recordatorios.servicio_id
        AND s.codigo_fotos IS NOT NULL
    )
  );

-- ============================================================
-- BLOQUE 6: solicitudes_servicio — INSERT anon, sin SELECT
-- El formulario público solo inserta. El coordinador (auth) lee.
-- Eliminar el SELECT total de anon previene que un cliente vea
-- las solicitudes de otros clientes.
-- ============================================================
CREATE POLICY "anon_insert_only" ON public.solicitudes_servicio
  FOR INSERT TO anon WITH CHECK (true);

COMMIT;
