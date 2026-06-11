# orbit-backend

Servicio backend propio de ORBIT en el VPS Contabo (Fase 2 del módulo Tenjo).
Materializa la arquitectura objetivo: lógica crítica, jobs y permisos fuera de
las capas de Supabase. Conecta **directo a PostgreSQL** (red `supabase_default`).

## Qué hace
- **Jobs por cron del VPS** (a diario; cada job decide si aplica según `config_operativa`):
  - `POST /jobs/generar-propuesta` — lun/mié/vie crea el lote PROPUESTO de la
    próxima jornada (mar/jue/sáb) con sus items clasificados y notifica coordinadores.
  - `POST /jobs/alertas` — motor diario: crea alertas persistentes con dedupe y
    auto-resuelve las que ya no aplican (incluye LOTE_SIN_CERRAR).
- **API** (migración gradual desde PostgREST):
  - `GET /health`
  - `GET /tenjo/candidatos` (JWT)
  - `POST /tenjo/generar-propuesta` (JWT + rol COORDINADOR/ADMIN)

## Seguridad
- Jobs: header `x-job-token` (token en `.env`, solo conocido por el cron local).
- API: valida el JWT del auth actual (mismo `JWT_SECRET`) y resuelve el rol
  contra `personal`/`roles_personal` → el permiso vive en el backend, no en RLS.
- El puerto 8787 solo escucha en 127.0.0.1; nginx hace el proxy público.

## Despliegue (en el VPS)
```bash
cd /opt/orbit-backend
# .env: ver .env.example (PGPASSWORD y JWT_SECRET salen de /opt/supabase/docker/.env)
docker compose up -d --build
docker logs -f orbit-backend
```
Crontab: ver `deploy/crontab.txt`. Nginx: `deploy/nginx-api.conf` → `api.orbitacac.com`
(requiere registro DNS proxied en Cloudflare apuntando al VPS).

## Actualizar tras cambios de código
```bash
# desde el PC local
scp -i ~/.ssh/orbit_deploy -r orbit-backend/src orbit-backend/package.json root@13.140.139.61:/opt/orbit-backend/
ssh -i ~/.ssh/orbit_deploy root@13.140.139.61 "cd /opt/orbit-backend && docker compose up -d --build"
```
