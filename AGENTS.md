# Minuta — guía para trabajar en el proyecto

> Para personas y para cualquier IA de programación (Claude Code, Codex, Gemini/Antigravity…). `CLAUDE.md` y `GEMINI.md` solo
> importan este archivo: la guía es una sola.

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
| `app/Sources/Minuta/` | App Swift (SwiftPM, macOS 15). Barra de menú (`BarraMenu.swift`), ventana web (`VisorWeb.swift`), captura de audio y detección de reuniones (`Audio.swift`), modelo y flujo (`MinutaApp.swift`), alertas flotantes (`Alerta.swift`), coach en vivo (`Vivo.swift`), dictado del Gimnasio (`Dictado.swift`), perfil (`Perfil.swift`), idiomas y lo propio del catálogo (`Idioma.swift`: `Idioma`, `CatalogoPublico`), universos y juego (`Juego.swift`). `app/Sources/PiezaCatalogo/` es la pieza «catálogo» (su propio target). `Visor.swift` es el visor SwiftUI antiguo (casi sin uso). |
| `app/Sources/Diarizar/` | Binario `minuta-diarizar` (FluidAudio) que separa voces de la pista "Ellos". |
| `app/Sources/Transcribir/` | Binario `minuta-transcribir`: whisper.cpp (xcframework oficial v1.8.3, Metal) con las **mismas opciones que `whisper-cli`**, para que el pipeline sea igual en Mac, Windows y Linux. |
| `bin/` | Python: `procesar.py` (pipeline principal y prompt de notas, sobre la pieza «transcribir»), `perfil.py` (perfil compartido, `limpiar_nombre`, `hechos`, `NOMBRE_IA` y `ejecutar_ia` sobre la pieza «ia»), `nucleo.py`, `ia.py`, `transcribir.py` y `catalogo.py` (piezas de Pieza: ver «Piezas»), `universo_formato.py` e `idioma_formato.py` (los validadores de Minuta para la pieza «catálogo»; los mismos archivos que `minuta-catalogo/herramientas/`), `corregir.py` (corrige una nota con la IA según una instrucción en palabras; guarda copia en `~/minuta/respaldos/` y lo aprendido en `personas_conocidas.json`, que `procesar.py` usa en las próximas notas), `limpiar_notas.py` (ordena nombres de participantes en notas viejas), `redactar.py` (mensaje para participantes), `gimnasio.py`, `preguntar.py` (⌘K), `semana.py`, `universo.py` (creador de universos), `logros.py`, `recalcular_interrupciones.py`. |
| `app.json`, `piezas.json` | **Pieza** (ver «Piezas»): `app.json` describe la app para las piezas (id, nombre, plataformas); `piezas.json` lo escribe `pieza.py` (versión y huella de cada archivo copiado). |
| `ui/` | Interfaz web única (`app.js` + CSS) que usan la ventana y el panel de la barra de menú. `demo.json` = datos ficticios para la vista previa en navegador. `idiomas/en.json` = inglés incluido. |
| `universos/` | Los 4 universos incluidos (cine, starwars, harrypotter, marvel). El resto está en el catálogo. |
| `herramientas/` | `revisar_privacidad.sh` (auditoría antes de commitear) y `empaquetar.sh` (arma `dist/Minuta.app` + `dist/Minuta-macOS.zip` y su `.sha256`). |
| `build.sh` | Empaqueta e instala en `~/Applications/Minuta.app`. **Cierra la app** (ver Despliegue). |
| `instalar.sh` | Instalador de un comando para usuarios (`curl … \| bash`): baja la última Release, verifica SHA-256 e instala. Sin Python ni Homebrew. |
| `.github/workflows/` | `revisar.yml` (pruebas en cada cambio) y `publicar.yml` (al subir la versión en Info.plist: compila Mac, Windows y Linux y publica la Release). |
| `pruebas/` | Pruebas automáticas (ver "Pruebas"). |
| `docs/` | Página pública (GitHub Pages): `index.html` (español/inglés, detecta el sistema del visitante), `ia.html` (guía para instalar Claude Code, Codex o Gemini CLI) y capturas en `docs/img` hechas con `demo.json`. |
| `CHANGELOG.md` | Lo que cambia para quien usa la app, en palabras simples (ver «Lo que rodea a un cambio»). |
| `escritorio/` | App de **Windows y Linux** (Electron): misma `ui/` y mismo `bin/`. Ver "Windows y Linux" abajo. |
| `instalar.ps1` | Instalador de un comando para Windows (`irm … \| iex`). `instalar.sh` sirve para Mac y Linux. |
| `.claude/agents/` | Agentes especializados (ver abajo). |

Repos relacionados: catálogo público `minuta-app/minuta-catalogo` (`temas/<categoria>/<id>.json`, `idiomas/comunidad/<codigo>.json`, sus índices con huella y `herramientas/`; `universos/` e `idiomas/<codigo>.json` son el formato de antes, generado para Minuta ≤ 0.3.1).

## Qué lleva la app adentro (sin Homebrew)

`herramientas/empaquetar.sh` (lo usan `build.sh` y la Release) arma `Minuta.app` con: la app, `minuta-transcribir` + `whisper.framework`, `minuta-diarizar` y un Python portátil
(python-build-standalone 3.13, verificado por SHA-256) en `Contents/Resources/python`, y una copia de `bin/`, `ui/`, `universos/` y `app.json`
en `Contents/Resources/minuta`. **Código vs. datos:** `Temas.base` (`~/minuta`) son los datos; `Temas.recursos` es el código: `~/minuta` si es
un checkout git con `ui/` (desarrollo), si no `Contents/Resources/minuta`. Los scripts lo reciben en `MINUTA_RECURSOS`; `perfil.RECURSOS` es `nucleo.recursos()`: la carpeta del `app.json` junto a `bin/` (y `MINUTA_RECURSOS` solo si el script vive fuera de ella).
Firma ad hoc con requisito por identificador (`app.minuta.mac`), así los permisos sobreviven a cada actualización. La app lanza los scripts con ese Python y
les pasa `MINUTA_HERRAMIENTAS` (= `Contents/MacOS`); `transcribir.herramienta()` (pieza) busca ahí, luego en `bin/`, luego en el sistema.
La conversión de audio usa `afconvert` (viene con macOS); ffmpeg solo se usa en Windows/Linux. Los scripts solo usan la biblioteca
estándar de Python: no agregues dependencias de pip.
**Lo que escribe la persona nunca va como argumento** de un proceso (se ve en la lista de procesos). El vocabulario
(`vocabulario.txt`) llega al transcriptor en un archivo temporal 0600 que se borra al terminar (pieza «transcribir», `transcribir.comando`):
`minuta-transcribir --prompt-archivo <ruta>` en Mac y, con `whisper-cli`, su archivo de argumentos oficial (`whisper-cli @<ruta>`,
una opción por línea; las rutas en la página de códigos del sistema en Windows y el prompt en UTF-8). La prueba
`VocabularioPrivado` lo revisa. `build.sh` se niega a instalar si hay una grabación o un procesamiento en curso.

## Primera vez, respaldo y actualizaciones (`Bienvenida.swift`)

- **Bienvenida:** se abre si no existe `perfil.json` o si solo tiene `idioma_ui` (`Perfil.falta`; también desde Preferencias). **Lo primero es el idioma**:
  una pantalla propia (`pantallaIdioma()` en `app.js`) con título fijo «Elige tu idioma · Choose your language» y dos botones escritos cada uno en su
  idioma (`data-sin-traducir`), el del sistema sugerido (`idioma.sistema`). Al elegir se guarda `idioma_ui` con la acción `perfil` (en la primera vez
  solo esa clave, así cerrar la app ahí no se salta la bienvenida), se carga la traducción y recién ahí se avanza. Antes de elegir no aparece nada más:
  sin permiso de avisos al abrir (se pide en el paso Permisos), sin alertas de reunión ni de calendario, sin aviso de actualización, y el ícono de la
  barra de menú/bandeja abre la bienvenida en vez del panel. Los botones de los avisos del sistema se registran con `Idioma.t`
  (`registrarAccionesAvisos`) y se vuelven a registrar al cambiar el idioma. Pasos: idioma → hola → quién eres → IA (`IA.buscar`/`IA.probar`
  detectan y prueban `claude`, `codex` o `agy`/`gemini`; la elegida queda en `perfil.json` → `ia`) → modelo (`Modelos`: turbo/small según RAM, descarga verificada por
  SHA-256 desde Hugging Face) → notas (carpeta nueva, carpeta existente o `git clone` de su repo) → respaldo opcional → permisos → universo.
- **Respaldo:** `Respaldo.crearRepo` crea un repo **privado en la cuenta del usuario** (GitHub o GitLab) con su token; el token va al
  Llavero y git lo recibe como encabezado en memoria (`-c http.extraHeader`), nunca en disco. Tras cada nota: `Respaldo.sincronizar()`.
- **Actualizaciones:** `Actualizaciones.revisar` al abrir y cada 6 h. Instalación de desarrollo (`~/minuta/.git` existe): `git fetch` y,
  al aceptar, `git pull` + `build.sh` + reabrir. Instalación normal: GitHub Releases (`Minuta-macOS.zip` + `.sha256`); un script espera a que la app
  cierre, reemplaza `Minuta.app` (deja `.anterior` si falla) y la reabre. **Publicar versión:** ver "Publicar una versión" abajo. Los datos del usuario viven fuera de `Minuta.app`, por eso actualizar no borra nada.

## Windows y Linux (`escritorio/`)

- Electron 44 con la misma interfaz y el mismo Python. `src/main.js` = AppModel + BarraMenu + VisorWeb + Alerta de Mac: estado `M` y `ACCIONES`
  (un caso por cada `host.enviar`; reciben `msg.datos`). **Una acción nueva en Swift también va en `ACCIONES`** (y al revés). El preload
  expone `window.minutaEscritorio` y `window.MINUTA_HOST` = `"windows"`/`"linux"`, que host-ui lee (`host.esEscritorio` → constante
  `ESCRITORIO` en app.js: ventana rectangular, sin la forma recortada; textos sin "Mac").
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
- `temas/` (universos descargados o creados; ganan sobre los incluidos con el mismo id) · `idiomas/` (idiomas descargados) · `catalogo/` (el último índice validado de cada tipo: id, ruta, tamaño y huella; lo escribe la pieza «catálogo»)
- `grabaciones/<fecha>/` (audio .caf, `yo.segmentos.json`/`ellos.segmentos.json` con `{desde, hasta, texto}` en segundos —en grabaciones de antes, el JSON de whisper `yo.json`/`ellos.json`—, `hablantes.json` con `{hablante, ini, fin}` del separador de voces, `meta.json`, `procesar.log`) · `models/` (whisper y el detector de voz; la pieza «transcribir» los busca aquí: `procesar.py` le cambia `carpeta_modelos`)
- `ia-herramientas.json` (lo que aprendió la pieza «ia» de tu versión de Claude)
- Notas: carpeta `carpeta_notas` del perfil (`.md` con frontmatter: fecha, hora, tipo, plataforma, correos, métricas, `participantes` como lista JSON de nombres limpios).

## Cómo se conectan las piezas

- **JS ↔ Swift:** la UI llama `host.enviar(accion, datos)` (pieza «host-ui») → mensaje `{accion, datos}` a `webkit.messageHandlers.minuta` → `switch` en `VisorWeb.swift` (ventana) o `BarraMenu.swift` (panel), que leen los datos de `cuerpo["datos"]`. En Windows/Linux va a `window.minutaEscritorio` (preload) y `ACCIONES` recibe `msg.datos`. Swift responde con `window.Minuta.<funcion>(json)` (`llamarFuncion` / `llamar`). Al agregar una acción: caso en Swift + `ACCIONES` + manejador en `host.responder({…})` de `app.js` + su respuesta de vista previa en `SIMULAR` (al final de `app.js`; en el navegador host-ui le pasa ahí cada acción). `pruebas/contrato.py` revisa la forma del mensaje.
- **IA del usuario:** los scripts nunca llaman a `claude` directo: usan `perfil.ejecutar_ia(prompt, timeout, cwd)`, que llama a `ia.ejecutar` de la pieza «ia» con la IA de `perfil.json` → `ia` (siempre explícita: Minuta no usa la config de la pieza). La pieza arma el comando (`claude -p --strict-mcp-config --disallowedTools "*"` y `--tools ""` si lo conoce, `codex exec -s read-only … -o archivo -`; para Gemini, `agy -p` de Antigravity CLI —el prompt siempre en un archivo, nunca como argumento— o el `gemini -p` antiguo) y amplía el PATH (Homebrew, npm, nvm, `~/.local/bin`). Corre en una carpeta temporal vacía, sin las variables `MINUTA_*` y, con Claude, sin su memoria (y con `--safe-mode`/`--setting-sources user` si los conoce). `MINUTA_MODELO` elige el modelo de Claude. Antes pregunta al CLI qué opciones conoce (`ia._soporta`, `--help` una vez por versión, sin las variables `MINUTA_*`): si no conoce `--strict-mcp-config` o `--disallowedTools`, **nunca** se corre sin ellas (`ia.VersionVieja`; `perfil.ejecutar_ia` devuelve el código 3 de siempre con «Actualiza … para usarla con Minuta»). Probar la IA (bienvenida) es `bin/ia.py probar <entrada.json {ia}> <salida.json>` desde `VisorWeb.swift` y `ACCIONES.probarIA`: las mismas protecciones que una nota. Mensajes al usuario con `NOMBRE_IA`, no "Claude". Guía pública para instalarlas: `docs/ia.html`.
- **Swift → Python:** `AppModel.ejecutar` / `correrScriptJSON(script, args)`; el último argumento siempre es la ruta del JSON de salida. Los scripts leen el perfil con `from perfil import …`.
- **Formato de nota:** el prompt de `procesar.py` define secciones y marcadores (`### Próximos pasos`, `## Personas`, `## Feedback para …`, `**Veredicto:**`, `**Puntajes:**`, `**Hábito para la próxima:**`, `**Decisión:**`, `**Pendiente:**`, `🔧`, `✅`, `→ Prueba:`). **Los marcadores van siempre en español** aunque la nota esté en otro idioma: `app.js`, `redactar.py`, `semana.py` y `preguntar.py` los usan para leer.
- **Universos:** JSON de solo datos (rangos ×10, apartados claridad/escucha/preguntas/cierre ×10, logros, íconos, `estilo`; formato en `bin/universo_formato.py`). `Temas.paraJS()` une incluidos + `~/minuta/temas`. Se descargan con la pieza «catálogo» (tipo `temas`): `Catalogo.listar`/`descargar` (Swift) y `catalogo().listar`/`descargar` (Electron) bajan solo de `raw.githubusercontent.com/minuta-app/minuta-catalogo/main/`, sin redirecciones, y comparan tamaño y SHA-256 con el último índice validado; `bin/catalogo.py` lo vuelve a validar con `universo_formato.validar` y lo guarda. La interfaz sigue pidiendo `catalogo {tipo: universos|idiomas}`, `descargarUniverso` y `descargarIdioma`; la lista llega con cada universo entero y `paraGaleria()` arma la vista previa.
- **Transcribir:** pieza «transcribir». `procesar.transcribir_pista` → `transcribir.transcribir(wav, idioma, modelo, vocabulario)` da `{desde, hasta, texto}` (segundos) sin marcas, inventos ni bucles; lo propio de Minuta (`corregir`, `partir_por_silencios`, `quien`, eco, turnos, métricas) trabaja sobre esos segmentos con `desde`/`hasta`, y `transcribir.limpiar(segs, energía)` quita lo que cae en silencio después de partir. El formato de las notas no cambia.
- **Idiomas:** el español es el idioma del código. `traducirDOM()` en `app.js` traduce el DOM ya pintado con la pieza «i18n» (`textos`: claves = texto en español, `{n}` números, `{x}` texto libre; `palabras`: fechas). El paquete que manda la app en `cargar` (o el que carga la vista previa) pasa por `i18n.usar`, que lo valida. Los atributos (`title`, `aria-label`, `placeholder`) dentro de una zona de `NO_TRADUCIR` y el `placeholder` de un `textarea` sí se traducen (`noTraducirAtributos` de la pieza); solo `.notas`, `.turnos` y `[data-sin-traducir]` quedan sin tocar. En Swift: `Idioma.t("…")` e `Idioma.f("… {x} …", valor)`.

## Piezas (de [Pieza](https://github.com/pieza-app/pieza))
Minuta usa piezas de Pieza, la base de la familia de apps: código probado que se copia a la app (modelo «copiar y adueñarse»).

| Pieza | Versión | Archivos | Qué usa Minuta |
|---|---|---|---|
| `nucleo` | 0.7.0 | `bin/nucleo.py` | `app.json` y `recursos()` (dónde está el código: `perfil.RECURSOS`). La pieza `ia` lo necesita para el prefijo `MINUTA_` y los temporales. |
| `host-ui` | 0.2.0 | `ui/host.js` | El puente: `host = PiezaHost.crearHost({nombre: "minuta", global: "Minuta", simular})`, mensaje `{accion, datos}`, `host.responder({…})` deja las respuestas en `window.Minuta`, `host.plataforma`/`esWeb`/`esEscritorio` (en vez de leer `window.MINUTA_HOST`). La vista previa del navegador es `simular()`/`SIMULAR`. |
| `i18n` | 0.3.0 | `ui/i18n.js` | `tr` y `traducirDOM` (ver «Idiomas»), con `crear({noTraducir: NO_TRADUCIR, noTraducirAtributos: ".notas, .turnos, [data-sin-traducir]"})`. |
| `tema` | 0.2.0 | `ui/tema.css`, `ui/tema.js` | Los tokens (`--fondo`, `--panel`, `--texto`, `--texto-suave`, `--linea`, `--acento`, `--sobre-acento`, `--radio-chico`…) y `data-pz-modo="claro\|oscuro"` en `<html>`. Minuta no ofrece «Apariencia»: cada universo escribe sus colores **directo en los tokens** y su modo con `apariencia.aplicar(e.modo)` (`aplicarTema`). Lo propio (`--fondo2`, `--acento2`, `--acento-t`, `--patron`…) sigue en `app.css`. El universo que se elige en la galería es `data-universo` . Sin «Apariencia», `tema` no va en `app.json` → `config` (`piezas.json` → `tema` → `"sin_config": ["tema"]`). |
| `componentes` | 0.2.0 | `ui/componentes.js`, `ui/componentes.css` | Los avisos (`toast()` → `ui.aviso`, que traduce la frase ya armada con `tr`; en cola, sobre `#toast` con el color del universo) y el foco de las ventanas: cada `.galeria-caja` lleva `role="dialog" aria-modal="true"`; la pieza deja el foco adentro (Tab), al abrir lo pone en el título (nunca en «Borrar»: un Enter apurado no borra), lo devuelve al cerrar y Esc llama `cerrarArriba()` (el orden de qué se cierra primero). Las filas de IA, actualizaciones, Acerca de y comentarios de la pieza no se usan todavía (ver abajo). |
| `transcribir` | 0.1.0 | `bin/transcribir.py` | `transcribir` (whisper con el vocabulario por archivo privado), `energia`/`rms`, `limpiar`, `segmentos_de`, `modelo_elegido`, `herramienta` (también para el separador de voces), `ErrorTranscribir`. Los modelos siguen en `~/minuta/models` (no en `<datos>/modelos`): `procesar.py` asigna `transcribir.carpeta_modelos`. El binario `minuta-transcribir` y la descarga de modelos (Swift/Electron) siguen en la app. |
| `catalogo` | 0.1.0 | `bin/catalogo.py`, `app/Sources/PiezaCatalogo/Catalogo.swift`, `escritorio/src/catalogo.js` | Universos (tipo `temas`) e idiomas del catálogo (`app.json` → `catalogo`), con huella obligatoria. Validadores de Minuta: `universo_formato.py`, `idioma_formato.py`. Swift: `Catalogo.configurar` en `AppModel.init` con `AppModel.conEntrada`; Electron: `catalogo()` en `main.js` con `conEntrada`. |
| `ia` | 0.6.0 | `bin/ia.py` | La IA de la persona: `ejecutar` (detrás de `perfil.ejecutar_ia`), `IAS`, `nombre`, `comando`, `VersionVieja` y `probar` (`ia.py probar <entrada {ia}> <salida>`, desde los hosts). Lo propio de Minuta (prompts, `NOMBRE_IA`, `MINUTA_MODELO`, el código 3 «Actualiza…» que esperan los scripts) sigue en `perfil.py`. En la bienvenida, `iaProbada` trae `codigo` (`no_instalada` muestra «No está instalada»). |

- **Los datos no se mueven:** siguen en `~/minuta` (`perfil.BASE`, `perfil.json`, `config.json`…). `app.json` → `datos` es
  `{"carpeta": "~/minuta"}`: lo que guardan las piezas (`temas/`, `idiomas/`, `catalogo/` del catálogo) queda ahí, donde siempre.
  Minuta **no** usa `nucleo.config()` ni `guardar_config()` (`~/minuta/config.json` es el universo elegido: nunca lo escribas con
  la pieza); la IA elegida se le pasa siempre a la pieza (`ia=`). `pruebas/test_python.py` (`Piezas`) revisa que no se cree
  ninguna otra carpeta de datos.
- **No edites a mano los archivos de una pieza.** Se actualizan con «Pieza al día» (`.github/workflows/pieza-al-dia.yml`, una vez por
  semana abre un PR o un issue) o con `python3 <pieza>/herramientas/pieza.py actualizar .`. Si hay que cambiar algo, el cambio va
  primero a Pieza (`pieza.py diferencias . <pieza>` lo muestra) y vuelve desde allá; `pieza.py estado .` dice si algo quedó distinto.
- `app.json` va dentro de las apps (`herramientas/empaquetar.sh` y `extraResources` de `escritorio/package.json`): `bin/nucleo.py`
  lo busca junto a `bin/`; sin él ningún script arranca. `.gitignore` es una lista blanca: `app.json` y `piezas.json` están en ella.
- No adoptadas todavía: `bienvenida` (la de Minuta es nativa y tiene sus pasos, entre ellos la IA, que sigue con su propio diseño y
  manda `probarIA {ia}`), `actualizaciones` (la de Minuta tiene además el modo desarrollo con `git pull` + `build.sh`, y su respuesta
  es `actualizacion`, no `actualizacionRevisada`: por eso no usa `ui.filaActualizacion`) y `comentarios` (Minuta publica también con
  la cuenta de GitHub del respaldo; su formulario sigue propio hasta que exista esa pieza).
- Lo de las piezas que Minuta **no** adoptó en la interfaz: la clase `.pz-boton` (en Minuta `.boton` es un botón de ícono de 34 px) y
  `ui.dialogo` (sus ventanas `.galeria`/`.galeria-caja` tienen el diseño de cada universo).

## Reglas al cambiar cosas

- Código, comentarios, commits y textos de la app en **español** (de Chile neutro). Nombres descriptivos en español como el resto.
- **Todo texto nuevo visible en la UI** (JS o Swift) debe agregarse a `ui/idiomas/en.json` en el mismo cambio. Para otros idiomas: `herramientas/traducir_idioma.py` en el catálogo.
- Nunca pongas el contenido de las notas en una ruta de traducción: usa `data-sin-traducir` o una clase de `NO_TRADUCIR`.
- Lo que se envía a otras personas (correo/Teams) **siempre** lo redacta la IA del usuario con `redactar.py`, sin feedback, opiniones ni la sección `## Personas`.
- Universos y paquetes de idioma son datos: nunca agregues campos que se ejecuten o se inyecten como HTML sin `esc()`.
- **Seguridad** (ver `SECURITY.md`): los universos entran a la interfaz por `limpiarUniverso()` (textos sin HTML, estilo solo con
  valores CSS esperados) y `ui/index.html` tiene una CSP sin código en línea: no agregues `onclick=`, `<script>` en línea ni
  recursos de otros dominios. La IA corre solo con texto (pieza «ia»: sin herramientas ni MCP), porque las
  transcripciones traen lo que dijeron otras personas. Las acciones del puente que abren cosas (`abrir`, `obsidian`, `finder`)
  solo aceptan esquemas conocidos o notas de la carpeta de reuniones. Los puentes (`VisorWeb`, `BarraMenu`, `ipcMain` de Electron) ignoran mensajes que no vengan del marco principal y del origen de la app. El actualizador solo baja de `https://github.com/minuta-app/minuta/releases/download/` (`esDescargaNuestra`) y todo lo variable de sus guiones de bash va con `comillas()`. En los workflows: actions fijadas por SHA (Dependabot
  las sube), permisos mínimos, `persist-credentials: false`, nunca `pull_request_target` ni `${{ … }}` dentro de `run:`.
- Interfaz: usa `render({ mantenerScroll: true })` para no saltar; el contenedor de página usa `data-pagina` (no `data-vista`, que dispara navegación).
- Antes de terminar un cambio de UI: `node --check ui/app.js` y prueba en navegador (`cd ui && python3 -m http.server 8765` → `http://localhost:8765/index.html`; `#panel` para el panel, `?idioma=en` para inglés, `window.Minuta._probar({...})` para saltar a cualquier vista).
- Python: `python3 -m py_compile bin/*.py`. Swift: solo compila en el Mac (`build.sh`).
- Archivos de piezas (`bin/nucleo.py`, `bin/ia.py`, `bin/transcribir.py`, `bin/catalogo.py`, `app/Sources/PiezaCatalogo/`, `escritorio/src/catalogo.js`, `ui/host.js`, `ui/i18n.js`, `ui/tema.*`, `ui/componentes.*`): no se editan aquí; ver «Piezas».

## Lo que rodea a un cambio
Un cambio está listo cuando la app **y lo que la cuenta** dicen lo mismo. Antes de empezar, anota qué tipo de cambio es; al terminar,
revisa cada fila ("no aplica" se decide, no se supone):

| Si el cambio… | Deja al día |
|---|---|
| agrega o cambia una función | la página (`docs/`: funciones, «cómo funciona», comparación, preguntas frecuentes), el README y la guía si la hay |
| cambia lo que se ve | capturas de la página y del README (datos ficticios, español e inglés, normal y celular) e imagen para compartir si sale esa vista |
| cambia un flujo o un paso | instrucciones paso a paso, preguntas frecuentes, textos de la bienvenida e instalación si la toca |
| quita algo | bórralo de la página, el README y las guías: nada que prometa lo que ya no hace |
| cambia el formato de datos o el puente | la documentación del formato, `ejemplos/` si existe y esta guía |
| cambia carpetas, reglas o pruebas | esta guía (`AGENTS.md`) y `CONTRIBUTING.md` |
| actualiza o agrega una pieza | `piezas.json` (lo escribe `pieza.py`), la tabla «Piezas» de esta guía y `app.json` si pide algo |
| resuelve un issue | ciérralo con «Resuelto en …» dando crédito y abre issues para lo que quedó pendiente |
| lo nota quien usa Minuta | `CHANGELOG.md`: una línea en «Sin publicar», en lenguaje de persona («Ahora puedes…»), en español e inglés |

Todo texto nuevo de la página y del README va en los dos idiomas, sin nada inventado. Antes de cerrar, busca con `grep` en `docs/` y el
README el nombre o el texto viejo de lo que cambió. Al publicar una versión, las líneas de «Sin publicar» pasan a su número.
Los issues que abrimos para una tarea traen una sección «Qué actualizar alrededor» con las filas de esta tabla que le tocan.

## Pruebas (GitHub las corre en cada cambio: `.github/workflows/revisar.yml`)

- `bash pruebas/correr.sh`: todo lo de abajo menos compilar Swift. Córrelo antes de cada commit (la interfaz necesita Playwright: `PLAYWRIGHT=/ruta/playwright`).
- `pruebas/contrato.py`: los tres puentes usan el mensaje `{accion, datos}` de host-ui (y `probarIA {ia}`); cada `host.enviar("x")`/`data-pn`/`data-av` de la interfaz existe en Swift (VisorWeb/BarraMenu) **y** en `ACCIONES`
  de Electron, y cada `window.Minuta.x` que llaman las apps existe. Excepciones a propósito en `EXCEPCIONES` con su motivo.
- `pruebas/test_python.py`: una reunión de punta a punta con un transcriptor falso (`Segmentos`: `desde`/`hasta` y la nota de siempre), el vocabulario fuera de los argumentos y en un archivo 0600 (`VocabularioPrivado`), el catálogo con huella (`CatalogoSeguro`: una huella mala se rechaza), limpiar nombres, `corregir.py` (con IA simulada), `limpiar_notas.py`, universos incluidos, la IA sin herramientas y en carpeta temporal, `ia.py probar` con archivo de entrada y que las piezas no muevan los datos de `~/minuta`. HOME temporal: nunca toca datos reales.
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

Si usas **Claude Code**, en `.claude/agents/` hay agentes especializados: `minuta-mac` (Swift y sistema), `minuta-escritorio` (Windows/Linux, Electron),
`minuta-pipeline` (Python, prompts y métricas), `minuta-interfaz` (UI web e idiomas), `minuta-catalogo` (universos e idiomas descargables),
`minuta-despliegue` (instalar en el Mac sin romper una grabación), `minuta-privacidad` (auditoría antes de commitear o publicar)
y `minuta-revisor` (revisar pull requests de la comunidad: seguridad, pruebas, universos e idiomas; nunca junta sin aprobación).
Con otra IA, cada uno es un buen resumen del área: léelo como guía. El despliegue y la privacidad son obligatorios al cerrar un cambio.
