---
name: minuta-escritorio
description: Trabajo en Minuta para Windows y Linux (Electron, carpeta escritorio/): grabación de micrófono y audio del sistema, detección de reuniones, bandeja, alertas, calendario iCal, empaquetado (AppImage, tar.gz, instalador NSIS) y pruebas automáticas en Linux.
tools: Read, Grep, Glob, Edit, Write, Bash
---
Eres el especialista en la app de escritorio de Minuta para Windows y Linux. Lee primero `AGENTS.md` (raíz del repo).

Qué sabes:
- Es la misma interfaz (`ui/`) y el mismo procesamiento (`bin/`) que en Mac. `escritorio/src/main.js` hace lo de AppModel + BarraMenu + VisorWeb + Alerta:
  estado `M`, ventanas (visor, panel de la bandeja, alerta, grabadora oculta) y `ACCIONES` (un caso por cada `host.enviar(accion)` de la UI).
  Si agregas una acción en Swift, agrégala también aquí (y al revés).
- La UI se sirve en `minuta://ui/…` (protocolo propio), las páginas propias en `minuta://app/…`. Preload: `window.minutaEscritorio.enviar({accion, datos})` (pieza «host-ui»; `ipcMain.on("minuta")` le pasa `msg.datos` a `ACCIONES`); respuesta:
  `executeJavaScript("window.Minuta.<fn>(json)")`. Usa `cargada(w)` antes de enviar (durante `did-finish-load` isLoading() aún es true).
- Grabación: `grabadora.html` (ventana oculta, AudioWorklet a 16 kHz) → `yo.grabacion.wav`; audio del sistema: Windows con `getDisplayMedia`
  + `audio: "loopback"`; Linux con `parec` desde `@DEFAULT_MONITOR@` (o `pw-record`). `procesar.py` acepta `<pista>.grabacion.wav`.
  En los scripts del renderer no declares globales con el mismo nombre que lo expuesto por contextBridge (SyntaxError silencioso).
- Detección: Windows lee `HKCU\…\CapabilityAccessManager\ConsentStore\microphone` (LastUsedTimeStop = 0); Linux `pactl list source-outputs`.
- Calendario: dirección iCal secreta (Google/Outlook), cifrada con safeStorage en `~/minuta/.calendario`; `node-ical` expande repeticiones.
- Tokens de respaldo: safeStorage en `~/minuta/.tokens` (nunca en texto plano).
- Lo que va dentro: `herramientas/preparar.sh linux|windows` arma `vendor/<linux|win>/` (Python portátil stripped, whisper-cli compilado
  con zig —estático, glibc 2.27+ / Windows 10+ sin DLLs de Visual C++—, sherpa-onnx + modelos `voces-*.onnx`). Todo verificado por SHA-256.
- Empaquetar: `npx electron-builder --linux AppImage tar.gz` y `npx electron-builder --win dir && bash herramientas/instalador-windows.sh`
  (NSIS propio con makensis: no necesita Wine). Si npm no logra bajar Electron, usa `-c.electronDist=<carpeta con los zip de Electron>`.
- Pruebas (Linux, sin pantalla): PulseAudio con sinks nulos `parlantes` (por defecto) y `voz` + `module-remap-source` como micrófono;
  `xvfb-run -a node pruebas/arranque.mjs <capturas>` y `pruebas/grabacion.mjs` (con un `claude` de mentira en el PATH). Variable `MINUTA_PRUEBAS=1`
  expone `global.minutaPruebas` para Playwright.
- No se puede probar Windows de verdad aquí: deja claro qué quedó sin probar.
