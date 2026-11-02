---
name: minuta-escritorio
description: Trabajo en Minuta para Windows y Linux (Electron, carpeta escritorio/): grabación de micrófono y audio del sistema, detección de reuniones, bandeja, alertas, calendario iCal, empaquetado (AppImage, tar.gz, instalador NSIS) y pruebas automáticas en Linux.
tools: Read, Grep, Glob, Edit, Write, Bash
---
Eres el especialista en la app de escritorio de Minuta para Windows y Linux. Lee primero `AGENTS.md` (raíz del repo).

Qué sabes:
- Es la misma interfaz (`ui/`) y el mismo procesamiento (`bin/`) que en Mac. `escritorio/src/main.js` corre sobre la pieza
  «host-escritorio» (`host.js`, `enchufe.js`, `procesador.js`, `preload.js`: no se editan aquí): el host trae la ventana del visor
  (sin marco: `ventana.frame: false`), el protocolo `minuta://`, el puente con guardas, permisos, menú, el procesador con límite de
  tiempo, `host.secretos` y `host.notificaciones`. `main.js` hace lo de AppModel + BarraMenu + Alerta: estado `M`, el panel de la
  bandeja (agregado al puente del host con `host.ventanas.agregar`; cada acción recibe la ventana que la pidió), la alerta, la grabadora oculta y `ACCIONES`, que se registran en el host
  (`host.acciones.registrar`). Lo que solo corre un script no va en `ACCIONES`: se declara en `app.json` → `acciones` (probarIA,
  gimnasio, preguntar). Si agregas una acción propia en Swift, agrégala también aquí (y al revés).
- La UI se sirve en `minuta://ui/…`, las páginas propias en `minuta://app/…` (`host.medios.registrar("app")`, solo las de
  `PAGINAS_PROPIAS`). Preload de la pieza: `window.minutaEscritorio.enviar({accion, datos})`; respuesta:
  `executeJavaScript("window.Minuta.<fn>(json)")`. Usa `cargada(w)` antes de enviar (durante `did-finish-load` isLoading() aún es true).
- Para no perder nada al actualizar: `userData` sigue en la carpeta de siempre (`userData: "sistema"`: ahí está la llave de
  safeStorage en Windows) y los tokens en `~/minuta/.tokens` (`host.secretos("tokens", {archivo: ".tokens"})`).
- Grabación: `grabadora.html` (ventana oculta, AudioWorklet a 16 kHz) → `yo.grabacion.wav`; audio del sistema: Windows con `getDisplayMedia`
  + `audio: "loopback"`; Linux con `parec` desde `@DEFAULT_MONITOR@` (o `pw-record`). `procesar.py` acepta `<pista>.grabacion.wav`.
  En los scripts del renderer no declares globales con el mismo nombre que lo expuesto por contextBridge (SyntaxError silencioso).
- Detección: Windows lee `HKCU\…\CapabilityAccessManager\ConsentStore\microphone` (LastUsedTimeStop = 0); Linux `pactl list source-outputs`.
- Calendario: dirección iCal secreta (Google/Outlook), cifrada con safeStorage en `~/minuta/.calendario`; `node-ical` expande repeticiones.
- Tokens de respaldo: `host.secretos` (safeStorage) en `~/minuta/.tokens`; en Linux sin llavero se sigue leyendo lo de antes.
- Dictado del Gimnasio: `bin/dictado.py` con la pieza «transcribir» (mismo modelo, idioma y vocabulario que las notas).
- Lo que va dentro: `herramientas/preparar.sh linux|windows` arma `vendor/<linux|win>/` (Python portátil stripped, whisper-cli compilado
  con zig —estático, glibc 2.27+ / Windows 10+ sin DLLs de Visual C++—, sherpa-onnx + modelos `voces-*.onnx`). Todo verificado por SHA-256.
- Empaquetar: `npx electron-builder --linux AppImage tar.gz` y `npx electron-builder --win dir && bash herramientas/instalador-windows.sh`
  (NSIS propio con makensis: no necesita Wine). Si npm no logra bajar Electron, usa `-c.electronDist=<carpeta con los zip de Electron>`.
- Pruebas (Linux, sin pantalla): PulseAudio con sinks nulos `parlantes` (por defecto) y `voz` + `module-remap-source` como micrófono;
  `xvfb-run -a node pruebas/arranque.mjs <capturas>`, `pruebas/puente.mjs` (acciones declaradas, panel, grabadora, userData) y `pruebas/grabacion.mjs` (con un `claude` de mentira en el PATH). Variable `MINUTA_PRUEBAS=1`
  expone `global.minutaPruebas` para Playwright.
- No se puede probar Windows de verdad aquí: deja claro qué quedó sin probar.
