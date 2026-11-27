-- Copia MÍNIMA de las tablas de producción que toca el módulo (solo columnas usadas).
CREATE ROLE orbit_backend; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE FUNCTION public.fn_hoy_bogota() RETURNS date LANGUAGE sql STABLE AS
  $$ SELECT (now() AT TIME ZONE 'America/Bogota')::date $$;
CREATE TABLE roles_personal (id int PRIMARY KEY, nombre text);
CREATE TABLE personal (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text, apellido text, activo boolean DEFAULT true, rol_principal_id int);
CREATE TABLE clientes (id_cliente uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text, apellido text, cedula_nit text, whatsapp text, telefono text, email text, direccion text, ciudad text, tipo_cliente text, notas text);
CREATE TABLE especies (id serial PRIMARY KEY, nombre text);
CREATE TABLE mascotas (id_mascota uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text, especie_id int, raza text, sexo text CHECK (sexo IN ('Macho','Hembra')), tamano text NOT NULL, peso_kg numeric NOT NULL, cliente_id uuid REFERENCES clientes(id_cliente), fallecida boolean, fecha_fallecimiento date, fecha_nacimiento date, notas text);
CREATE TABLE planes (id serial PRIMARY KEY, codigo text, nombre text);
CREATE TABLE servicios (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), mascota_id uuid REFERENCES mascotas(id_mascota), plan_id int REFERENCES planes(id), estado text, fecha_entrega_real date);
CREATE TABLE recordatorios (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text, descripcion text, categoria text, foto_url text, tiempo_produccion_dias int, campos_texto jsonb, requiere_imagen boolean, solo_nombre boolean, max_fotos int, precio_base numeric, precio_publico numeric, activo boolean DEFAULT true, venta_publica boolean NOT NULL DEFAULT false);
CREATE TABLE servicio_recordatorios (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), servicio_id uuid, recordatorio_id uuid, origen text, estado text);
CREATE TABLE nps_seguimiento (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), servicio_id uuid, tipo text, satisfaccion varchar(10), nps int);
CREATE TABLE pqrs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), servicio_id uuid, tipo text, descripcion text);
CREATE TABLE festivos (fecha date);
CREATE TABLE config_operativa (modulo text, clave text, valor jsonb, descripcion text, updated_at timestamptz, UNIQUE (modulo, clave));
CREATE TABLE afiliaciones (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), estado text);
CREATE TABLE afiliacion_contratos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), afiliacion_id uuid, numero int, numero_contrato text, descuento_motivo text,
  CONSTRAINT afil_contratos_descuento_motivo_valido CHECK (descuento_motivo IS NULL OR descuento_motivo IN ('RENOVACION_ANTICIPADA','MULTIPLES_MASCOTAS','RENOVACION_MULTIPLE_TARDIA','MANUAL')));
CREATE TABLE whatsapp_mensajes (wa_message_id text, estado text);
CREATE TABLE notificaciones (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), para_personal_id uuid, tipo text, titulo text, mensaje text, servicio_id uuid, datos jsonb, leido boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE SEQUENCE compras_recordatorios_numero_seq;
CREATE TABLE compras_recordatorios (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), numero int UNIQUE DEFAULT nextval('compras_recordatorios_numero_seq'), cliente_id uuid, mascota_id uuid, total numeric(12,2), valor_pagado numeric(12,2) DEFAULT 0,
  estado_pago text GENERATED ALWAYS AS (CASE WHEN valor_pagado >= total THEN 'COMPLETO' WHEN valor_pagado > 0 THEN 'PARCIAL' ELSE 'PENDIENTE' END) STORED,
  notas text, registrado_por uuid, anulada_en timestamptz, created_at timestamptz DEFAULT now(),
  origen text NOT NULL DEFAULT 'INTERNO', valor_envio numeric NOT NULL DEFAULT 0, entrega jsonb, pago_cliente jsonb,
  CONSTRAINT compras_rec_origen_check CHECK (origen IN ('INTERNO','CATALOGO_WEB')));
CREATE TABLE compra_recordatorio_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), compra_id uuid, recordatorio_id uuid, nombre text, cantidad int, precio_unitario numeric, estado text DEFAULT 'PENDIENTE', datos_cliente jsonb, imagenes_urls text[], notas text, created_at timestamptz DEFAULT now());
CREATE TABLE compra_recordatorio_eventos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), compra_id uuid, item_id uuid, tipo text, detalle jsonb, por uuid, created_at timestamptz DEFAULT now());
CREATE TABLE compra_web_borradores (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now(), expira_en timestamptz DEFAULT now() + interval '3 hours', usado_en timestamptz, ip inet);
CREATE TABLE autorizaciones_datos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), origen text, medio text, politica_version text, finalidades text[], titular_nombre text, titular_documento text, titular_telefono text, titular_email text, servicio_id uuid, cliente_id uuid, solicitud_id uuid, aliado_id uuid, declarada_por uuid, ip inet, user_agent text, notas text,
  CONSTRAINT autorizaciones_datos_origen_check CHECK (origen = ANY (ARRAY['SOLICITUD_CLIENTE','CATALOGO_RECORDATORIOS'])));
