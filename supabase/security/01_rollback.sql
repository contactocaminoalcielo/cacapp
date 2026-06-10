-- ============================================================
-- ORBIT — SCRIPT DE ROLLBACK COMPLETO
-- Restaura exactamente el estado anterior al hardening de 2026-06-04
-- Ejecutar via Management API si algo falla después del hardening
-- ============================================================

BEGIN;

-- ============================================================
-- PASO 1: Deshabilitar RLS en las 33 tablas que lo habilitamos
-- ============================================================
ALTER TABLE public.aliados               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.canal_origen          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.comisiones_aliados    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_comisiones     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuarto_frio           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.entregas              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.especies              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.flujos_proceso        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.maquinas_produccion   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.mascotas              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos_inventario DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.novedades_servicio    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.nps_seguimiento       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_roles        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_recordatorios    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.planes                DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.planes_precios        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.planes_presequiales   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.procesos_disposicion  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.recogidas             DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.recordatorio_materiales DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.recordatorios         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles_personal        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.seguimiento_compostaje DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.servicio_recordatorios DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.servicios             DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitudes_imagenes  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tipo_establecimiento  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.traslados_tenjo       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.vip_recordatorios     DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- PASO 2: Eliminar todas las policies nuevas (auth_full + anon_*)
-- ============================================================
DROP POLICY IF EXISTS "auth_full" ON public.aliados;
DROP POLICY IF EXISTS "auth_full" ON public.canal_origen;
DROP POLICY IF EXISTS "auth_full" ON public.certificados_emitidos;
DROP POLICY IF EXISTS "auth_full" ON public.clientes;
DROP POLICY IF EXISTS "auth_full" ON public.comisiones_aliados;
DROP POLICY IF EXISTS "auth_full" ON public.config_comisiones;
DROP POLICY IF EXISTS "auth_full" ON public.config_sistema;
DROP POLICY IF EXISTS "auth_full" ON public.cuarto_frio;
DROP POLICY IF EXISTS "auth_full" ON public.cuarto_frio_movimientos;
DROP POLICY IF EXISTS "auth_full" ON public.entregas;
DROP POLICY IF EXISTS "auth_full" ON public.especies;
DROP POLICY IF EXISTS "auth_full" ON public.estado_cuarto_frio;
DROP POLICY IF EXISTS "auth_full" ON public.estado_nevera_reporte;
DROP POLICY IF EXISTS "auth_full" ON public.flujos_proceso;
DROP POLICY IF EXISTS "auth_full" ON public.inventario;
DROP POLICY IF EXISTS "auth_full" ON public.lotes_grupales;
DROP POLICY IF EXISTS "auth_full" ON public.maquinas_produccion;
DROP POLICY IF EXISTS "auth_full" ON public.mascotas;
DROP POLICY IF EXISTS "auth_full" ON public.movimientos_inventario;
DROP POLICY IF EXISTS "auth_full" ON public.neveras;
DROP POLICY IF EXISTS "auth_full" ON public.notificaciones;
DROP POLICY IF EXISTS "auth_full" ON public.novedades_servicio;
DROP POLICY IF EXISTS "auth_full" ON public.nps_seguimiento;
DROP POLICY IF EXISTS "auth_full" ON public.personal;
DROP POLICY IF EXISTS "auth_full" ON public.personal_roles;
DROP POLICY IF EXISTS "auth_full" ON public.plan_recordatorios;
DROP POLICY IF EXISTS "auth_full" ON public.planes;
DROP POLICY IF EXISTS "auth_full" ON public.planes_precios;
DROP POLICY IF EXISTS "auth_full" ON public.planes_presequiales;
DROP POLICY IF EXISTS "auth_full" ON public.procesos_disposicion;
DROP POLICY IF EXISTS "auth_full" ON public.recibos_tecnico;
DROP POLICY IF EXISTS "auth_full" ON public.recogidas;
DROP POLICY IF EXISTS "auth_full" ON public.recordatorio_materiales;
DROP POLICY IF EXISTS "auth_full" ON public.recordatorios;
DROP POLICY IF EXISTS "auth_full" ON public.roles_personal;
DROP POLICY IF EXISTS "auth_full" ON public.seguimiento_compostaje;
DROP POLICY IF EXISTS "auth_full" ON public.servicio_recordatorios;
DROP POLICY IF EXISTS "auth_full" ON public.servicios;
DROP POLICY IF EXISTS "auth_full" ON public.solicitudes_imagenes;
DROP POLICY IF EXISTS "auth_full" ON public.solicitudes_servicio;
DROP POLICY IF EXISTS "auth_full" ON public.tipo_establecimiento;
DROP POLICY IF EXISTS "auth_full" ON public.traslados_tenjo;
DROP POLICY IF EXISTS "auth_full" ON public.vip_recordatorios;

DROP POLICY IF EXISTS "anon_select"            ON public.planes;
DROP POLICY IF EXISTS "anon_select"            ON public.planes_precios;
DROP POLICY IF EXISTS "anon_select"            ON public.plan_recordatorios;
DROP POLICY IF EXISTS "anon_select"            ON public.recordatorios;
DROP POLICY IF EXISTS "anon_select"            ON public.aliados;
DROP POLICY IF EXISTS "anon_select"            ON public.especies;
DROP POLICY IF EXISTS "anon_select"            ON public.tipo_establecimiento;
DROP POLICY IF EXISTS "anon_select_con_codigo" ON public.servicios;
DROP POLICY IF EXISTS "anon_select_via_codigo" ON public.mascotas;
DROP POLICY IF EXISTS "anon_select_via_codigo" ON public.servicio_recordatorios;
DROP POLICY IF EXISTS "anon_insert_only"       ON public.solicitudes_servicio;

-- ============================================================
-- PASO 3: Restaurar policies originales en tablas que tenían RLS=ON
-- ============================================================

-- certificados_emitidos
CREATE POLICY "allow_all" ON public.certificados_emitidos
  FOR ALL TO public USING (true) WITH CHECK (true);

-- config_sistema
CREATE POLICY "allow_all" ON public.config_sistema
  FOR ALL TO public USING (true) WITH CHECK (true);

-- cuarto_frio_movimientos
CREATE POLICY "allow_all" ON public.cuarto_frio_movimientos
  FOR ALL TO public USING (true) WITH CHECK (true);

-- estado_cuarto_frio
CREATE POLICY "allow_all"        ON public.estado_cuarto_frio FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "lectura_publica"  ON public.estado_cuarto_frio FOR SELECT TO anon USING (true);
CREATE POLICY "escritura_publica" ON public.estado_cuarto_frio FOR INSERT TO anon WITH CHECK (true);

-- estado_nevera_reporte
CREATE POLICY "allow_all"        ON public.estado_nevera_reporte FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "lectura_publica"  ON public.estado_nevera_reporte FOR SELECT TO anon USING (true);
CREATE POLICY "escritura_publica" ON public.estado_nevera_reporte FOR INSERT TO anon WITH CHECK (true);

-- lotes_grupales
CREATE POLICY "allow_all" ON public.lotes_grupales
  FOR ALL TO public USING (true) WITH CHECK (true);

-- neveras
CREATE POLICY "allow_all" ON public.neveras
  FOR ALL TO public USING (true) WITH CHECK (true);

-- notificaciones
CREATE POLICY "allow_all" ON public.notificaciones
  FOR ALL TO public USING (true) WITH CHECK (true);

-- recibos_tecnico
CREATE POLICY "allow_all" ON public.recibos_tecnico
  FOR ALL TO public USING (true) WITH CHECK (true);

-- solicitudes_servicio
CREATE POLICY "solicitudes_anon_insert" ON public.solicitudes_servicio
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "solicitudes_auth_all"    ON public.solicitudes_servicio
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "solicitudes_anon_select" ON public.solicitudes_servicio
  FOR SELECT TO anon USING (true);

-- ============================================================
-- PASO 4: Restaurar dead-code policies en tablas RLS=OFF
-- (No tienen efecto funcional pero restauran el estado exacto)
-- ============================================================
CREATE POLICY "lectura_publica"          ON public.aliados FOR SELECT TO anon USING (true);
CREATE POLICY "permitir lectura publica" ON public.aliados FOR SELECT TO public USING (true);
CREATE POLICY "lectura_publica"          ON public.canal_origen FOR SELECT TO anon USING (true);
CREATE POLICY "permitir lectura publica" ON public.canal_origen FOR SELECT TO public USING (true);
CREATE POLICY "lectura_publica"          ON public.clientes FOR SELECT TO anon USING (true);
CREATE POLICY "permitir lectura publica" ON public.clientes FOR SELECT TO public USING (true);
CREATE POLICY "escritura_publica"        ON public.clientes FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "lectura_publica"          ON public.cuarto_frio FOR SELECT TO anon USING (true);
CREATE POLICY "escritura_publica"        ON public.cuarto_frio FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "lectura_publica"          ON public.entregas FOR SELECT TO anon USING (true);
CREATE POLICY "actualizacion_publica"    ON public.entregas FOR UPDATE TO anon USING (true);
CREATE POLICY "escritura_publica"        ON public.entregas FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "lectura_publica"          ON public.especies FOR SELECT TO anon USING (true);
CREATE POLICY "permitir lectura publica" ON public.especies FOR SELECT TO public USING (true);
CREATE POLICY "lectura_publica"          ON public.flujos_proceso FOR SELECT TO anon USING (true);
CREATE POLICY "lectura_publica"          ON public.mascotas FOR SELECT TO anon USING (true);
CREATE POLICY "escritura_publica"        ON public.mascotas FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "permitir lectura publica" ON public.mascotas FOR SELECT TO public USING (true);
CREATE POLICY "lectura_publica"          ON public.novedades_servicio FOR SELECT TO anon USING (true);
CREATE POLICY "escritura_publica"        ON public.novedades_servicio FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "lectura_publica"          ON public.personal FOR SELECT TO anon USING (true);
CREATE POLICY "permitir lectura publica" ON public.personal FOR SELECT TO public USING (true);
CREATE POLICY "personal_lectura_autenticados" ON public.personal FOR SELECT TO authenticated USING (true);
CREATE POLICY "lectura_publica"          ON public.plan_recordatorios FOR SELECT TO anon USING (true);
CREATE POLICY "permitir lectura publica" ON public.plan_recordatorios FOR SELECT TO public USING (true);
CREATE POLICY "lectura_publica"          ON public.planes FOR SELECT TO anon USING (true);
CREATE POLICY "permitir lectura publica" ON public.planes FOR SELECT TO public USING (true);
CREATE POLICY "lectura_publica"          ON public.recogidas FOR SELECT TO anon USING (true);
CREATE POLICY "actualizacion_publica"    ON public.recogidas FOR UPDATE TO anon USING (true);
CREATE POLICY "escritura_publica"        ON public.recogidas FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "lectura_publica"          ON public.seguimiento_compostaje FOR SELECT TO anon USING (true);
CREATE POLICY "escritura_publica"        ON public.seguimiento_compostaje FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "lectura_publica"          ON public.servicio_recordatorios FOR SELECT TO anon USING (true);
CREATE POLICY "actualizacion_publica"    ON public.servicio_recordatorios FOR UPDATE TO anon USING (true);
CREATE POLICY "escritura_publica"        ON public.servicio_recordatorios FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "lectura_publica"          ON public.servicios FOR SELECT TO anon USING (true);
CREATE POLICY "actualizacion_publica"    ON public.servicios FOR UPDATE TO anon USING (true);
CREATE POLICY "escritura_publica"        ON public.servicios FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "lectura_publica"          ON public.tipo_establecimiento FOR SELECT TO anon USING (true);

COMMIT;
