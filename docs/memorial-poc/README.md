# Memorial POC — Remotion (Fase 0)

Prueba de concepto del **motor de render** para el "Memorial Camino al Cielo" (ver
`docs/Memorial_Canva_Diagnostico.md`). Recrea la pieza de Canva **mejorada y animada**, y demuestra
que Remotion self-host puede generar el MP4 por completo sin Canva Enterprise.

## Qué genera
- Pieza **1080×1350** (4:5, feed IG), 12s, 30fps, H.264.
- Fondo salvia con glow cálido + viñeta, partículas doradas, destellos.
- Logo oficial (embebido desde `src/lib/logoCamino.js`).
- Foto en **arco tipo portal** con marco dorado, Ken Burns (zoom lento) y viñeta interna.
- Revelado escalonado: logo → foto → "EN MEMORIA DE" → nombre (Playfair) → divisor dorado →
  fecha → "Siempre en nuestro corazón".
- **Melodía original** (`public/audio/memorial.mp3`): piano cálido, progresión I–V–vi–IV con bajo,
  pad y reverb; sintetizada con `scratchpad/make_music.py` (numpy) → **100% libre de derechos**.
  Se embebe con `<Audio>` de Remotion, así un solo render produce video + sonido. Para cambiarla,
  regenerar el WAV/MP3 y reemplazar el asset (o ajustar notas/tempo en el script).

## Cómo renderizar
```bash
npm install
npm run still     # PNG de prueba (frame 200) → out/still.png
npm run render    # MP4 completo → out/memorial.mp4
npm run studio    # editor visual en el navegador
```

## Variables de la plantilla (defaultProps en src/Root.tsx)
- `name`   — nombre de la mascota (`mascotas.nombre`)
- `date`   — fecha a mostrar
- `photo`  — ruta de la foto en `public/img/` (en producción: descargada del bucket `fotos-clientes`)

## Para Fase 1 (integración ORBIT)
- Este proyecto se mueve a **orbit-backend** y se invoca headless con
  `@remotion/renderer` (`renderMedia`) pasando `inputProps` = { name, date, photoUrl }.
- La foto se baja del bucket `fotos-clientes` a un archivo temporal antes de renderizar.
- El MP4 resultante se guarda en almacenamiento propio / bucket `memoriales` y se registra en la
  tabla `memoriales` (estado, url, instagram_url).
- Notas: la foto de este POC se recortó del video de muestra (queda un leve arco abajo-derecha); con
  la **foto original del cliente** el arco no aparece.
