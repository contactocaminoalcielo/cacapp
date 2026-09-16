"""Despliegue acotado de la auditoría 2026-09-07; ejecutar en el VPS.

Requiere un directorio de release con dist, los tres archivos de backend,
migración y verificador. Conserva assets anteriores y respalda código/imagen.
"""
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import sys
import time
import urllib.request

release = pathlib.Path(sys.argv[1]).resolve()
if not release.is_relative_to('/opt/orbit-releases'):
    raise SystemExit('El release debe estar dentro de /opt/orbit-releases')
backend = pathlib.Path('/opt/orbit-backend')
frontend = pathlib.Path('/var/www/orbit/dist')
esperados = {
    'db.js': 'a94cc726d86fc5c40d2a4e2531137098dc90647d052cc8a43b2a9a30040ba25d',
    'grupales-ia.js': '67068504def0ad10f409939fea7dcc85cbfb474d701e8c81ad2f0c4dda4121aa',
    'cuadres-ia.js': '9c2c11e82c9dbb7ea57734ea7ba0a4282ab9f169a243e7a24dd0f8cf31b5e48b',
}


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def sql(texto):
    return run(['docker', 'exec', '-i', 'supabase-db', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-At'], input=texto, capture_output=True).stdout


def reposo():
    activos = sql("SELECT (SELECT count(*) FROM public.piezas_digitales WHERE estado IN ('GENERANDO','PUBLICANDO')) + (SELECT count(*) FROM public.whatsapp_campanas WHERE estado='EN_CURSO');").strip()
    if activos != '0':
        raise RuntimeError('Hay renders/publicaciones/campañas en curso; no se reinicia')
    logs = run(['docker', 'logs', '--since', '6m', 'orbit-backend'], capture_output=True)
    if '[llamadas]' in logs.stdout + logs.stderr:
        raise RuntimeError('Hay actividad reciente de llamadas; no se reinicia')


def hash_texto(archivo):
    return hashlib.sha256(archivo.read_text().replace('\r\n', '\n').encode()).hexdigest()


for nombre, esperado in esperados.items():
    if hash_texto(backend / 'src' / nombre) != esperado:
        raise SystemExit('El backend cambió desde la revisión: ' + nombre)
    if not (release / 'orbit-backend' / 'src' / nombre).is_file():
        raise SystemExit('Falta archivo de backend en el release')
if not (release / 'dist' / 'index.html').is_file():
    raise SystemExit('Falta build')
html = (release / 'dist' / 'index.html').read_text()
for archivo in re.findall(r'/assets/[^"\s]+', html):
    if not (release / 'dist' / archivo.lstrip('/')).is_file():
        raise SystemExit('Falta asset: ' + archivo)
supabase = re.search(r'/assets/supabase-[^"\s]+\.js', html).group(0)
cliente = (release / 'dist' / supabase.lstrip('/')).read_text()
if 'https://db.orbitacac.com' not in cliente or 'orbit-test.invalid' in cliente:
    raise SystemExit('El build no tiene la configuración de producción')
reposo()
indice_anterior = hashlib.sha256((frontend / 'index.html').read_bytes()).hexdigest()
inspeccion = json.loads(run(['docker', 'inspect', 'orbit-backend'], capture_output=True).stdout)[0]
imagen_anterior, etiqueta = inspeccion['Image'], inspeccion['Config']['Image']
respaldo = release / 'respaldo'
respaldo.mkdir(exist_ok=False)
(respaldo / 'backend').mkdir()
for nombre in esperados:
    shutil.copy2(backend / 'src' / nombre, respaldo / 'backend' / nombre)
shutil.copytree(frontend, respaldo / 'frontend', ignore=shutil.ignore_patterns('assets'))
(respaldo / 'imagen.json').write_text(json.dumps({'imagen': imagen_anterior, 'etiqueta': etiqueta}))
run(['docker', 'tag', imagen_anterior, 'orbit-backend:respaldo-rendimiento-20260907'])
reiniciado = False
frontend_tocado = False
try:
    for nombre in esperados:
        shutil.copy2(release / 'orbit-backend' / 'src' / nombre, backend / 'src' / nombre)
    print('Construyendo backend; el contenedor actual sigue atendiendo', flush=True)
    run(['docker', 'compose', 'build', 'orbit-backend'], cwd=backend, timeout=900)
    reposo()
    if hashlib.sha256((frontend / 'index.html').read_bytes()).hexdigest() != indice_anterior:
        raise RuntimeError('Hubo otro despliegue del frontend durante la preparación')
    migracion = (release / 'migrations' / '144_lecturas_operativas.sql').read_text()
    migracion = re.sub(r'(?m)^(BEGIN|COMMIT);\s*$', '', migracion)
    comprobar = (release / 'scripts' / 'verificar-lecturas-operativas.sql').read_text()
    sql("BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL statement_timeout='15s';\n" + migracion + '\n' + comprobar + '\nSET LOCAL ROLE authenticated;\n' + comprobar + '\nRESET ROLE; COMMIT;')
    print('Migración verificada y aplicada', flush=True)
    reiniciado = True
    run(['docker', 'compose', 'up', '-d', '--no-deps', 'orbit-backend'], cwd=backend, timeout=120)
    salud = False
    for _ in range(15):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8787/health', timeout=3) as r:
                salud = r.status == 200 and json.load(r).get('ok') is True
            if salud:
                break
        except Exception:
            pass
        time.sleep(1)
    if not salud:
        raise RuntimeError('El backend nuevo no pasó /health')
    frontend_tocado = True
    # Assets primero. El índice cambia de forma atómica al final; las pestañas
    # anteriores siguen teniendo disponibles sus chunks con hash.
    for archivo in (release / 'dist').rglob('*'):
        if not archivo.is_file() or archivo.name == 'index.html':
            continue
        destino = frontend / archivo.relative_to(release / 'dist')
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(archivo, destino)
    temporal = frontend / 'index.html.next'
    shutil.copy2(release / 'dist' / 'index.html', temporal)
    temporal.replace(frontend / 'index.html')
    diferencias = [str(p.relative_to(release / 'dist')) for p in (release / 'dist').rglob('*') if p.is_file() and hashlib.sha256(p.read_bytes()).digest() != hashlib.sha256((frontend / p.relative_to(release / 'dist')).read_bytes()).digest()]
    if diferencias:
        raise RuntimeError('No coincide la copia del frontend')
    (release / 'resultado.json').write_text(json.dumps({'ok': True, 'backend_health': True, 'frontend_hash': hashlib.sha256((frontend / 'index.html').read_bytes()).hexdigest(), 'respaldo': str(respaldo)}))
    print('OK: frontend, backend y lecturas publicados; respaldo en ' + str(respaldo), flush=True)
except Exception:
    for nombre in esperados:
        shutil.copy2(respaldo / 'backend' / nombre, backend / 'src' / nombre)
    run(['docker', 'tag', imagen_anterior, etiqueta])
    if reiniciado:
        run(['docker', 'compose', 'up', '-d', '--no-deps', 'orbit-backend'], cwd=backend, timeout=120)
    if frontend_tocado:
        shutil.copytree(respaldo / 'frontend', frontend, dirs_exist_ok=True)
    # Las funciones nuevas son aditivas y compatibles con la versión anterior.
    print('Despliegue detenido; código e imagen anteriores restaurados', flush=True)
    raise
