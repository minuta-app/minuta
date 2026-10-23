# Minuta — guía para trabajar en el proyecto

Minuta es una app de escritorio (estilo Granola) para macOS, Windows y Linux que graba reuniones, transcribe **localmente** (whisper.cpp), separa voces,
y con la IA del usuario (Claude Code, Codex o Gemini CLI, con su propia cuenta) genera notas, feedback de comunicación y un mensaje para los participantes.
Tiene gamificación con "universos" (Star Wars, Marvel…), agenda con compromisos, fichas de personas, gimnasio de práctica y coach en vivo.

**Principios que no se negocian**
1. **Todo es del usuario.** Audio, transcripciones y notas viven en su Mac (y, si quiere, en *su* repo git). No hay servidores ni base de datos propios.
2. **Gratis y abierto.** El catálogo (universos e idiomas) es un repo público con JSON; los comentarios llegan como issues de GitHub.
3. **Nada personal en el código.** Lo personal va en `~/minuta/perfil.json` (no versionado). Ver "Privacidad" abajo.
4. **Formato abierto.** Las notas son Markdown documentado en el README ("Formato de las notas"): la gente arma scripts y
   automatizaciones encima. No cambies nombres de campos ni marcadores sin mantener compatibilidad y actualizar el README.
5. **Plug and play.** Lo que haya que preguntar al usuario se pregunta en la app (Preferencias / asistente), no se escribe a mano en archivos.

## Mapa del repo

| Ruta | Qué es |
|---|---|
| `app/Sources/Minuta/` | App Swift (SwiftPM, macOS 15). Barra de menú (`BarraMenu.swift`), ventana web (`VisorWeb.swift`), captura de audio y detección de reuniones (`Audio.swift`), modelo y flujo (`MinutaApp.swift`), alertas flotantes (`Alerta.swift`), coach en vivo (`Vivo.swift`), dictado del Gimnasio (`Dictado.swift`), perfil (`Perfil.swift`), catálogo e idiomas (`Catalogo.swift`), universos y juego (`Juego.swift`). `Visor.swift` es el visor SwiftUI antiguo (casi sin uso). |
| `app/Sources/Diarizar/` | Binario `minuta-diarizar` (FluidAudio) que separa voces de la pista "Ellos". |
| `app/Sources/Transcribir/` | Binario `minuta-transcribir`: whisper.cpp (xcframework oficial v1.8.3, Metal) con las **mismas opciones que `whisper-cli`**, para que el pipeline sea igual en Mac, Windows y Linux. |
| `bin/` | Python: `procesar.py` (pipeline principal y prompt de notas), `perfil.py` (perfil compartido, `limpiar_nombre`, `hechos`), `corregir.py` (corrige una nota con la IA según una instrucción en palabras; guarda copia en `~/minuta/respaldos/` y lo aprendido en `personas_conocidas.json`, que `procesar.py` usa en las próximas notas), `limpiar_notas.py` (ordena nombres de participantes en notas viejas), `redactar.py` (mensaje para participantes), `gimnasio.py`, `preguntar.py` (⌘K), `semana.py`, `universo.py` (creador de universos), `logros.py`, `recalcular_interrupciones.py`. |
| `ui/` | Interfaz web única (`app.js` + CSS) que usan la ventana y el panel de la barra de menú. `demo.json` = datos ficticios para la vista previa en navegador. `idiomas/en.json` = inglés incluido. |
| `universos/` | Los 4 universos incluidos (cine, starwars, harrypotter, marvel). El resto está en el catálogo. |
| `herramientas/` | `revisar_privacidad.sh` (auditoría antes de commitear) y `empaquetar.sh` (arma `dist/Minuta.app` + `dist/Minuta-macOS.zip` y su `.sha256`). |
| `build.sh` | Empaqueta e instala en `~/Applications/Minuta.app`. **Cierra la app** (ver Despliegue). |
| `instalar.sh` | Instalador de un comando para usuarios (`curl … \| bash`): baja la última Release, verifica SHA-256 e instala. Sin Python ni Homebrew. |
| `.github/workflows/` | `revisar.yml` (pruebas en cada cambio) y `publicar.yml` (al subir la versión en Info.plist: compila Mac, Windows y Linux y publica la Release). |
| `pruebas/` | Pruebas automáticas (ver "Pruebas"). |
| `docs/` | Página pública (GitHub Pages): `index.html` (español/inglés, detecta el sistema del visitante), `ia.html` (guía para instalar Claude Code, Codex o Gemini CLI) y capturas en `docs/img` hechas con `demo.json`. |
| `escritorio/` | App de **Windows y Linux** (Electron): misma `ui/` y mismo `bin/`. Ver "Windows y Linux" abajo. |
| `instalar.ps1` | Instalador de un comando para Windows (`irm … \| iex`). `instalar.sh` sirve para Mac y Linux. |
| `.claude/agents/` | Agentes especializados (ver abajo). |

Repos relacionados: catálogo público `minuta-app/minuta-catalogo` (universos/, idiomas/, herramientas/).

## Qué lleva la app adentro (sin Homebrew)

`herramientas/empaquetar.sh` (lo usan `build.sh` y la Release) arma `Minuta.app` con: la app, `minuta-transcribir` + `whisper.framework`, `minuta-diarizar` y un Python portátil
(python-build-standalone 3.13, verificado por SHA-256) en `Contents/Resources/python`, y una copia de `bin/`, `ui/` y `universos/`
en `Contents/Resources/minuta`. **Código vs. datos:** `Temas.base` (`~/minuta`) son los datos; `Temas.recursos` es el código: `~/minuta` si es
un checkout git con `ui/` (desarrollo), si no `Contents/Resources/minuta`. Los scripts lo reciben en `MINUTA_RECURSOS` (`perfil.RECURSOS`).
Firma ad hoc con requisito por identificador (`app.minuta.mac`), así los permisos sobreviven a cada actualización. La app lanza los scripts con ese Python y
les pasa `MINUTA_HERRAMIENTAS` (= `Contents/MacOS`); `procesar.herramienta()` busca ahí, luego en `bin/`, luego en el sistema.
La conversión de audio usa `afconvert` (viene con macOS); ffmpeg solo se usa en Windows/Linux. Los scripts solo usan la biblioteca
estándar de Python: no agregues dependencias de pip. `build.sh` se niega a instalar si hay una grabación o un procesamiento en curso.

## Primera vez, respaldo y actualizaciones (`Bienvenida.swift`)

- **Bienvenida:** se abre si no existe `perfil.json` (o desde Preferencias). Pasos: idioma → quién eres → IA (`IA.buscar`/`IA.probar`
  detectan y prueban `claude`, `codex` o `agy`/`gemini`; la elegida queda en `perfil.json` → `ia`) → modelo (`Modelos`: turbo/small según RAM, descarga verificada por
  SHA-256 desde Hugging Face) → notas (carpeta nueva, carpeta existente o `git clone` de su repo) → respaldo opcional → permisos → universo.
- **Respaldo:** `Respaldo.crearRepo` crea un repo **privado en la cuenta del usuario** (GitHub o GitLab) con su token; el token va al
  Llavero y git lo recibe como encabezado en memoria (`-c http.extraHeader`), nunca en disco. Tras cada nota: `Respaldo.sincronizar()`.
- **Actualizaciones:** `Actualizaciones.revisar` al abrir y cada 6 h. Instalación de desarrollo (`~/minuta/.git` existe): `git fetch` y,
  al aceptar, `git pull` + `build.sh` + reabrir. Instalación normal: GitHub Releases (`Minuta-macOS.zip` + `.sha256`); un script espera a que la app
  cierre, reemplaza `Minuta.app` (deja `.anterior` si falla) y la reabre. **Publicar versión:** ver "Publicar una versión" abajo. Los datos del usuario viven fuera de `Minuta.app`, por eso actualizar no borra nada.

## Windows y Linux (`escritorio/`)

- Electron 44 con la misma interfaz y el mismo Python. `src/main.js` = AppModel + BarraMenu + VisorWeb + Alerta de Mac: estado `M` y `ACCIONES`
  (un caso por cada `host.enviar`). **Una acción nueva en Swift también va en `ACCIONES`** (y al revés). La UI detecta `window.MINUTA_HOST`
  = `"windows"`/`"linux"` (constante `ESCRITORIO` en app.js: ventana rectangular, sin la forma recortada; textos sin "Mac").
- Grabación: ventana oculta `grabadora.html` (AudioWorklet a 16 kHz) → `yo.grabacion.wav`; sistema: Windows `getDisplayMedia` + loopback,
  Linux `parec` (`@DEFAULT_MONITOR@`). `procesar.py` acepta `.caf` (Mac) o `.grabacion.wav`. Separación de voces: sherpa-onnx (`voces-*.onnx`).
- Detección de reuniones: registro de uso del micrófono (Windows) / `pactl list source-outputs` (Linux). Calendario: dirección iCal secreta
  (Google/Outlook) en Preferencias, cifrada con safeStorage. Recordatorios: abre un `.ics`. Dictado del Gimnasio: whisper local.
- `escritorio/herramientas/preparar.sh linux|windows` arma `vendor/` (Python portátil, whisper-cli compilado con zig —estático, sin DLLs de
  Visual C++, glibc 2.27+—, sherpa-onnx). Todo con huella SHA-256 fija.
- Empaquetar (desde Linux, sin Wine): `npx electron-builder --linux AppImage tar.gz`; `npx electron-builder --win dir && bash herramientas/instalador-windows.sh`
  (NSIS propio `herramientas/instalador.nsi`, por usuario, `/S` silencioso). Versión en `escritorio/package.json` (igual que `app/Info.plist`).
- Instalación: Windows en `%LOCALAPPDATA%\Programs\Minuta`; Linux con `instalar.sh` en `~/.local/share/Minuta` (+ lanzador `~/.local/bin/minuta`,
  que agrega `--no-sandbox` si el sistema restringe user namespaces) o el AppImage. El actualizador de la app maneja los tres casos.
- Pruebas automáticas en Linux (PulseAudio virtual + Xvfb + Playwright): ver el agente `minuta-escritorio`. **Windows no se puede probar aquí.**

## Publicar una versión

1. Sube la versión en `app/Info.plist` y `escritorio/package.json` y haz push a main. **Eso es todo:** el workflow `publicar.yml`
   ve que cambió `Info.plist`, compila Mac, Windows y Linux y crea el Release `vX.Y.Z` (si esa versión ya existe, no hace nada).
   Las apps instaladas lo ven al abrir o cada 6 h y muestran el aviso **dentro de la app** (banner y Preferencias, nunca una alerta del sistema).
2. También se puede lanzar con una etiqueta `vX.Y.Z` o a mano desde Actions.
3. A mano (si Actions no está disponible): Mac con `bash herramientas/empaquetar.sh` en el Mac; Windows/Linux con los comandos de arriba;
   cada archivo con su `.sha256`; luego `gh release create vX.Y.Z <archivos>` (desde el Mac del usuario, que tiene `gh` con sesión).
   Nombres fijos (los usan los instaladores y el actualizador): `Minuta-macOS.zip`, `Minuta-Windows.exe`, `Minuta-Linux.AppImage`, `Minuta-Linux.tar.gz`.
4. El Mac del usuario es una instalación de desarrollo (`~/minuta` es checkout git): se actualiza con `git pull` + `build.sh`, no con Releases.

## Comentarios, votos y propuestas desde la app

`Comentarios.swift` / `Comentarios` en `escritorio/src/main.js`. Sin servidor: si la persona conectó GitHub para el respaldo, se usa ese token
(Llavero / safeStorage) para publicar issues (`minuta-app/minuta` o el catálogo), votar universos (reacciones) y proponer universos creados
(issue con etiqueta `propuesta` y el JSON, solo con los campos de datos). Sin cuenta, se abre GitHub con todo listo. Nada es obligatorio ni
aparece solo: se abre únicamente cuando la persona lo pide (⋯ → Enviar comentarios, ⋯ → Comentar el feedback, 💬/📤 en la galería).

## Datos en tiempo de ejecución (en el computador, nunca en git)

`~/minuta` es a la vez el checkout del repo **y** la carpeta de datos. El `.gitignore` es una lista blanca: solo se versiona lo listado.
- `perfil.json` (nombre, rol, idiomas, carpeta de notas) · `config.json` (universo elegido) · `ajustes.json` (avisos) · `categorias.json` · `personas_conocidas.json` (correcciones sobre personas) · `respaldos/` (copias antes de corregir)
- `correcciones.json`, `vocabulario.txt`, `votos.json`, `historial.jsonl`, `practicas.jsonl`, `mensajes/` (borradores redactados por nota)
- `temas/` (universos descargados o creados; ganan sobre los incluidos con el mismo id) · `idiomas/` (idiomas descargados) · `catalogo/` (caché de índices)
- `grabaciones/<fecha>/` (audio .caf, JSON de whisper, `hablantes.json`, `meta.json`, `procesar.log`) · `models/` (whisper)
- Notas: carpeta `carpeta_notas` del perfil (`.md` con frontmatter: fecha, hora, tipo, plataforma, correos, métricas, `participantes` como lista JSON de nombres limpios).

## Cómo se conectan las piezas

- **JS ↔ Swift:** la UI llama `host.enviar(accion, datos)` → `webkit.messageHandlers.minuta` → `switch` en `VisorWeb.swift` (ventana) o `BarraMenu.swift` (panel). Swift responde con `window.Minuta.<funcion>(json)` (`llamarFuncion` / `llamar`). Al agregar una acción: caso en Swift + manejador en `window.Minuta` + modo `E.plataforma === "web"` simulado para la vista previa.
- **IA del usuario:** los scripts nunca llaman a `claude` directo: usan `perfil.ejecutar_ia(prompt, timeout, cwd)`, que arma el comando según `perfil.ia` (`claude -p`, `codex exec … -o archivo -`; para Gemini, `agy -p` de Antigravity CLI —prompt como argumento o en un archivo si es largo— o el `gemini -p` antiguo) y amplía el PATH (Homebrew, npm, nvm, `~/.local/bin`). Mensajes al usuario con `NOMBRE_IA`, no "Claude". Guía pública para instalarlas: `docs/ia.html`.
- **Swift → Python:** `AppModel.ejecutar` / `correrScriptJSON(script, args)`; el último argumento siempre es la ruta del JSON de salida. Los scripts leen el perfil con `from perfil import …`.
- **Formato de nota:** el prompt de `procesar.py` define secciones y marcadores (`### Próximos pasos`, `## Personas`, `## Feedback para …`, `**Veredicto:**`, `**Puntajes:**`, `**Hábito para la próxima:**`, `**Decisión:**`, `**Pendiente:**`, `🔧`, `✅`, `→ Prueba:`). **Los marcadores van siempre en español** aunque la nota esté en otro idioma: `app.js`, `redactar.py`, `semana.py` y `preguntar.py` los usan para leer.
- **Universos:** JSON de solo datos (rangos ×10, apartados claridad/escucha/preguntas/cierre ×10, logros, íconos, `estilo`). `Temas.paraJS()` une incluidos + `~/minuta/temas`. Se descargan con `Catalogo.descargarUniverso` (valida antes de guardar).
- **Idiomas:** el español es el idioma del código. `traducirDOM()` en `app.js` traduce el DOM ya pintado con `textos` (claves = texto en español, `{n}` números, `{x}` texto libre) y `palabras` (fechas). En Swift: `Idioma.t("…")` e `Idioma.f("… {x} …", valor)`.

## Reglas al cambiar cosas

- Código, comentarios, commits y textos de la app en **español** (de Chile neutro). Nombres descriptivos en español como el resto.
- **Todo texto nuevo visible en la UI** (JS o Swift) debe agregarse a `ui/idiomas/en.json` en el mismo cambio. Para otros idiomas: `herramientas/traducir_idioma.py` en el catálogo.
- Nunca pongas el contenido de las notas en una ruta de traducción: usa `data-sin-traducir` o una clase de `NO_TRADUCIR`.
- Lo que se envía a otras personas (correo/Teams) **siempre** lo redacta la IA del usuario con `redactar.py`, sin feedback, opiniones ni la sección `## Personas`.
- Universos y paquetes de idioma son datos: nunca agregues campos que se ejecuten o se inyecten como HTML sin `esc()`.
- Interfaz: usa `render({ mantenerScroll: true })` para no saltar; el contenedor de página usa `data-pagina` (no `data-vista`, que dispara navegación).
- Antes de terminar un cambio de UI: `node --check ui/app.js` y prueba en navegador (`cd ui && python3 -m http.server 8765` → `http://localhost:8765/index.html`; `#panel` para el panel, `?idioma=en` para inglés, `window.Minuta._probar({...})` para saltar a cualquier vista).
- Python: `python3 -m py_compile bin/*.py`. Swift: solo compila en el Mac (`build.sh`).

## Pruebas (GitHub las corre en cada cambio: `.github/workflows/revisar.yml`)

- `bash pruebas/correr.sh`: todo lo de abajo menos compilar Swift. Córrelo antes de cada commit (la interfaz necesita Playwright: `PLAYWRIGHT=/ruta/playwright`).
- `pruebas/contrato.py`: cada `host.enviar("x")`/`data-pn`/`data-av` de la interfaz existe en Swift (VisorWeb/BarraMenu) **y** en `ACCIONES`
  de Electron, y cada `window.Minuta.x` que llaman las apps existe. Excepciones a propósito en `EXCEPCIONES` con su motivo.
- `pruebas/test_python.py`: limpiar nombres, `corregir.py` (con IA simulada), `limpiar_notas.py`, universos incluidos. HOME temporal: nunca toca datos reales.
- `pruebas/interfaz.mjs`: todas las vistas sin errores en español e inglés, **ningún texto sin traducir** (los datos de demo no cuentan),
  los mismos casos de nombres que Python (`casos_nombres.json`) y contraste del botón principal en cada universo. `CAPTURAS=carpeta` guarda capturas
  (en GitHub quedan como artefacto "capturas" de cada revisión).
- `pruebas/evaluar_ia.py`: valida la estructura de la respuesta de la IA (ejemplo fijo en CI; `--real` con tu IA y `pruebas/ia/transcripcion_*.txt`).
  Úsalo con `--real` antes de tocar el prompt de `procesar.py`.
- El job `mac` compila Swift en macos-15 si cambió `app/`, `build.sh` o `empaquetar.sh`. `publicar.yml` corre contrato y Python antes de armar una versión.
- Al agregar algo nuevo: si es una función pura, agrega casos; si es una acción, el contrato la revisa solo; si es texto, la prueba de la interfaz exige su traducción.

## Despliegue al Mac del usuario

El Mac se maneja con las herramientas `mcp__remote-devices__*` (osascript con `do shell script`). Flujo:
1. Commit y push desde el clon de trabajo (autor: el usuario de GitHub dueño del repo con su correo `@users.noreply.github.com`, nunca un correo personal; y las líneas de atribución que pida la sesión).
2. **Comprobar que Minuta esté libre** antes de tocar nada: la carpeta más nueva de `~/minuta/grabaciones` debe tener `meta.json` (si solo tiene `.caf`, **está grabando**) y `pgrep -fl procesar.py` debe estar vacío. Si no está libre, no compiles: programa un chequeo y avisa.
3. `cd ~/minuta && git pull --ff-only`. Los cambios de Python/UI aplican al tiro (la UI al recargar la ventana).
4. Si cambió Swift: compilar en segundo plano (`nohup` de un script que corra `bash ./build.sh` y escriba `FIN $?` en `/tmp/minuta-build.log`), esperar en tramos de ≤25 s (osascript corta los comandos largos), luego `open ~/Applications/Minuta.app`.
5. Nunca reemplazar `bin/minuta-diarizar` mientras se procesa (rompe la separación de voces; `build.sh` ya solo lo cambia si cambió).
6. No dejes archivos temporales ni capturas en `~/minuta`; borra capturas de pantalla al terminar (son privadas).

## Privacidad (el repo será open source)

- Prohibido versionar: nombres reales de personas, empresas o clientes del usuario, correos, rutas personales, notas, transcripciones, `perfil.json`, ni ejemplos sacados de reuniones reales. Ejemplos y `demo.json` usan datos ficticios (Ana Pérez, Matías Soto, "Clientes", "Equipo"…).
- Antes de cada commit corre `bash herramientas/revisar_privacidad.sh` (o usa el agente `minuta-privacidad`). Busca en lo que se va a
  subir los términos de `.terminos-privados` (archivo local, **nunca versionado**: nombres, empresas, correos y rutas del usuario, uno por línea),
  además de correos y rutas `/Users/…`. Si el archivo no existe, créalo a partir de `perfil.json`, `categorias.json` y los participantes de las notas.
- Los universos del catálogo no deben mencionar al usuario ni sus empresas (ni en elogios ni en logros).
- El repo es público desde v0.2.0 (historial nuevo; la historia previa quedó en un repo privado). Bundle id: `app.minuta.mac`.
  Cada commit es público al tiro: la revisión de privacidad no es opcional.

## Agentes

En `.claude/agents/`: `minuta-mac` (Swift y sistema), `minuta-escritorio` (Windows/Linux, Electron), `minuta-pipeline` (Python, prompts y métricas), `minuta-interfaz` (UI web e idiomas),
`minuta-catalogo` (universos e idiomas descargables), `minuta-despliegue` (instalar en el Mac sin romper una grabación) y `minuta-privacidad`
(auditoría antes de commitear o publicar). Úsalos para trabajo acotado a su área; el despliegue y la privacidad son obligatorios al cerrar un cambio.
