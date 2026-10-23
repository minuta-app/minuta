<p align="center"><img src="docs/img/notas.jpg" alt="Minuta" width="860"></p>

<h1 align="center">Minuta</h1>
<p align="center"><b>Notas de reuniones y coach de comunicación que vive en tu computador.</b><br>
Gratis · Open source (MIT) · Mac, Windows y Linux · Tus datos no salen de tu computador</p>
<p align="center"><a href="https://soydavidcornejo.github.io/minuta/">Sitio</a> · <a href="https://github.com/soydavidcornejo/minuta/releases/latest">Descargar</a> · <a href="#english">English</a></p>

---

Minuta graba tus reuniones (Teams, Zoom, Meet, Slack…), las **transcribe en tu propio computador** y, con la IA que tú elijas,
te deja notas, compromisos y un feedback honesto para que cada reunión te salga mejor que la anterior.
Sin bots que entren a la llamada, sin cuentas de Minuta, sin servidores.

## Instalar

| | Con un comando | Descargando |
|---|---|---|
| 🍎 **Mac** | `curl -fsSL https://raw.githubusercontent.com/soydavidcornejo/minuta/main/instalar.sh \| bash` (Terminal) | [`Minuta-macOS.zip`](https://github.com/soydavidcornejo/minuta/releases/latest/download/Minuta-macOS.zip): descomprime, arrastra a Aplicaciones y la primera vez ábrela con **clic derecho → Abrir** |
| 🪟 **Windows** | `irm https://raw.githubusercontent.com/soydavidcornejo/minuta/main/instalar.ps1 \| iex` (PowerShell) | [`Minuta-Windows.exe`](https://github.com/soydavidcornejo/minuta/releases/latest/download/Minuta-Windows.exe): si aparece «Windows protegió tu PC», **Más información → Ejecutar de todas formas** |
| 🐧 **Linux** | `curl -fsSL https://raw.githubusercontent.com/soydavidcornejo/minuta/main/instalar.sh \| bash` (sin sudo) | [`Minuta-Linux.AppImage`](https://github.com/soydavidcornejo/minuta/releases/latest/download/Minuta-Linux.AppImage) (necesita FUSE: `sudo apt install libfuse2`) |

Los comandos bajan la última versión, verifican su huella SHA-256, la instalan solo para tu usuario y la abren.
Las descargas aún no están firmadas por Apple ni Microsoft; por eso el aviso la primera vez.

Al abrirla, un asistente te pregunta lo necesario: idioma, quién eres, tu IA, el modelo de transcripción (se descarga y verifica solo),
dónde guardar tus notas (carpeta nueva, una que ya tengas o tu repo de notas) y, si quieres, crea un respaldo privado en **tu** GitHub o GitLab.

**Requisitos:** [Claude Code](https://claude.com/claude-code) con tu cuenta de Claude · ~1 GB libre, y además:
- **Mac:** chip Apple (M1 o posterior) y macOS 15+.
- **Windows:** Windows 10 u 11 de 64 bits. Git solo si quieres respaldar en GitHub/GitLab.
- **Linux:** x86_64 (Ubuntu 18.04+, Debian, Fedora…) con PulseAudio o PipeWire (`pulseaudio-utils` para grabar a los demás).

No hace falta Homebrew, Python ni ffmpeg: todo viene dentro de la app. En Windows y Linux la transcripción usa el procesador
(en Mac, el chip gráfico): el modelo «Liviano» va bien en casi cualquier computador. El calendario se conecta en Preferencias
pegando la dirección iCal secreta de Google Calendar u Outlook.

## Qué hace

| | |
|---|---|
| 🔔 **Detecta tus reuniones** | Te avisa al empezar (un clic y graba) y te pregunta si cortar cuando termina. Puedes grabar otra mientras la anterior se procesa. |
| 📝 **Notas** | Temas, decisiones, pendientes y próximos pasos con responsable y fecha. Quién dijo qué, con las voces separadas. |
| 🎯 **Feedback** | Veredicto en una frase, lo que te costó con la cita exacta, qué probar la próxima vez, puntajes y un hábito por reunión. |
| ⏱️ **Coach en vivo** | Cuánto llevas hablando, tu % de habla y si cortaste a alguien, mientras pasa. |
| 📅 **Agenda y personas** | Prepara cada reunión con lo pendiente y los compromisos abiertos; los compromisos se marcan una vez y quedan al día en todas partes. |
| 🥊 **Gimnasio** | Ensaya hablando: la IA hace de la otra persona y te evalúa. |
| ✦ **Pregúntale a tus reuniones** | ⌘K: "¿qué le debo a Matías?", con la reunión y el minuto exacto. |
| ✉️ **Resumen para enviar** | Correo o mensaje para los participantes, solo con los hechos (nunca tu feedback privado). |
| 🪐 **Universos** | Rangos y logros con la estética que te guste. 4 incluidos, más en el [catálogo](https://github.com/soydavidcornejo/minuta-catalogo), o crea el tuyo. |
| 🌐 **Idiomas** | Español e inglés incluidos; portugués, francés y otros se descargan. |

<p align="center"><img src="docs/img/desempeno.jpg" width="49%"> <img src="docs/img/agenda.jpg" width="49%"></p>

## Privacidad

- **El audio nunca sale de tu computador.** La transcripción (whisper.cpp) y la separación de voces (FluidAudio en Mac, sherpa-onnx en Windows/Linux) corren ahí mismo.
- **Solo el texto** va a la IA que elegiste, con tu propia cuenta (hoy Claude vía `claude -p`; ChatGPT y Gemini vienen pronto).
- **Tus notas son archivos Markdown tuyos** (funcionan con Obsidian). El respaldo opcional va a un repo privado de tu cuenta;
  el token queda cifrado con el llavero del sistema (Llavero en Mac, DPAPI en Windows, libsecret en Linux).
- Minuta no tiene servidores, cuentas ni telemetría. El catálogo de universos e idiomas es un repo público con JSON que la app valida al descargar.

Grabar a otras personas tiene reglas distintas según el país: avisa y pide consentimiento antes de grabar.

## Actualizaciones

Minuta revisa sola si hay una versión nueva y te ofrece actualizar con un clic. Tus notas, perfil, universos y modelos viven fuera de la app,
así que actualizar no borra nada.

## Desarrollo

```bash
git clone https://github.com/soydavidcornejo/minuta ~/minuta
cd ~/minuta && bash ./build.sh        # Mac: compila (Xcode 16+), empaqueta e instala en ~/Applications
cd ui && python3 -m http.server 8765  # vista previa de la interfaz con datos ficticios: http://localhost:8765
```

- `app/` app de macOS en Swift (SwiftPM) · `bin/` procesamiento en Python (solo biblioteca estándar) · `ui/` interfaz web ·
  `universos/` universos incluidos · `herramientas/` empaquetado y revisión de privacidad · `docs/` sitio.
- Con `~/minuta` como checkout git, la app usa ese código y se actualiza con `git pull`.
- Publicar una versión: sube la versión en `app/Info.plist` y `git tag vX.Y.Z && git push --tags`; GitHub Actions compila y crea la Release.
- La guía completa para contribuir (arquitectura, reglas, agentes) está en [`CLAUDE.md`](CLAUDE.md).

**Windows y Linux** (`escritorio/`, Electron):

```bash
cd escritorio && npm install
bash herramientas/preparar.sh linux     # o windows: Python portátil, whisper (compilado con zig) y separador de voces
npx electron .                          # en desarrollo
npx electron-builder --linux AppImage tar.gz                                        # paquetes de Linux
npx electron-builder --win dir && bash herramientas/instalador-windows.sh           # instalador de Windows (makensis, sin Wine)
```

Comentarios y errores: desde la app (⋯ → Enviar comentarios) o en [issues](https://github.com/soydavidcornejo/minuta/issues).

---

<a id="english"></a>
## English

**Minuta** is a free, open-source meeting notes app and communication coach for Mac, Windows and Linux. It records your meetings,
**transcribes them locally** (whisper.cpp + speaker separation), and uses the AI you choose — with your own account — to give you
notes, commitments, and honest, quote-backed feedback. Audio never leaves your computer; notes are plain Markdown files you own,
optionally backed up to a private repo in your own GitHub or GitLab account. No Minuta accounts, servers or telemetry.

**Install:** Mac and Linux: `curl -fsSL https://raw.githubusercontent.com/soydavidcornejo/minuta/main/instalar.sh | bash` ·
Windows (PowerShell): `irm https://raw.githubusercontent.com/soydavidcornejo/minuta/main/instalar.ps1 | iex` ·
or download from the [latest release](https://github.com/soydavidcornejo/minuta/releases/latest). Requires Claude Code with your Claude account;
Mac needs Apple silicon and macOS 15+, Windows 10/11 64-bit, Linux x86_64 with PulseAudio or PipeWire.
The interface ships in Spanish and English (more languages downloadable). The code and comments are in Spanish.

## Licencia / License

[MIT](LICENSE)
