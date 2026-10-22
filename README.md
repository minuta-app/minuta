<p align="center"><img src="docs/img/notas.jpg" alt="Minuta" width="860"></p>

<h1 align="center">Minuta</h1>
<p align="center"><b>Notas de reuniones y coach de comunicación que vive en tu Mac.</b><br>
Gratis · Open source (MIT) · Tus datos no salen de tu Mac</p>
<p align="center"><a href="https://soydavidcornejo.github.io/minuta/">Sitio</a> · <a href="https://github.com/soydavidcornejo/minuta/releases/latest">Descargar</a> · <a href="#english">English</a></p>

---

Minuta graba tus reuniones (Teams, Zoom, Meet, Slack…), las **transcribe en tu propio Mac** y, con la IA que tú elijas,
te deja notas, compromisos y un feedback honesto para que cada reunión te salga mejor que la anterior.
Sin bots que entren a la llamada, sin cuentas de Minuta, sin servidores.

## Instalar

**Con un comando** (abre la Terminal y pega):

```bash
curl -fsSL https://raw.githubusercontent.com/soydavidcornejo/minuta/main/instalar.sh | bash
```

Descarga la última versión, verifica su huella SHA-256, la instala en `~/Applications` y la abre.

**Descargando:** baja [`Minuta-macOS.zip`](https://github.com/soydavidcornejo/minuta/releases/latest/download/Minuta-macOS.zip),
descomprime, arrastra Minuta a Aplicaciones y ábrela con **clic derecho → Abrir** la primera vez (aún no está firmada por Apple).

Al abrirla, un asistente te pregunta lo necesario: idioma, quién eres, tu IA, el modelo de transcripción (se descarga y verifica solo),
dónde guardar tus notas (carpeta nueva, una que ya tengas o tu repo de notas) y, si quieres, crea un respaldo privado en **tu** GitHub o GitLab.

**Requisitos:** Mac con chip Apple (M1 o posterior) · macOS 15+ · [Claude Code](https://claude.com/claude-code) con tu cuenta de Claude · ~1 GB libre.
No hace falta Homebrew, Python ni ffmpeg: todo viene dentro de la app.

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

- **El audio nunca sale de tu Mac.** La transcripción (whisper.cpp) y la separación de voces (FluidAudio) corren en el chip de tu Mac.
- **Solo el texto** va a la IA que elegiste, con tu propia cuenta (hoy Claude vía `claude -p`; ChatGPT y Gemini vienen pronto).
- **Tus notas son archivos Markdown tuyos** (funcionan con Obsidian). El respaldo opcional va a un repo privado de tu cuenta;
  el token queda en el Llavero de macOS.
- Minuta no tiene servidores, cuentas ni telemetría. El catálogo de universos e idiomas es un repo público con JSON que la app valida al descargar.

Grabar a otras personas tiene reglas distintas según el país: avisa y pide consentimiento antes de grabar.

## Actualizaciones

Minuta revisa sola si hay una versión nueva y te ofrece actualizar con un clic. Tus notas, perfil, universos y modelos viven fuera de la app,
así que actualizar no borra nada.

## Desarrollo

```bash
git clone https://github.com/soydavidcornejo/minuta ~/minuta
cd ~/minuta && bash ./build.sh        # compila (Xcode 16+), empaqueta e instala en ~/Applications
cd ui && python3 -m http.server 8765  # vista previa de la interfaz con datos ficticios: http://localhost:8765
```

- `app/` app de macOS en Swift (SwiftPM) · `bin/` procesamiento en Python (solo biblioteca estándar) · `ui/` interfaz web ·
  `universos/` universos incluidos · `herramientas/` empaquetado y revisión de privacidad · `docs/` sitio.
- Con `~/minuta` como checkout git, la app usa ese código y se actualiza con `git pull`.
- Publicar una versión: sube la versión en `app/Info.plist` y `git tag vX.Y.Z && git push --tags`; GitHub Actions compila y crea la Release.
- La guía completa para contribuir (arquitectura, reglas, agentes) está en [`CLAUDE.md`](CLAUDE.md).

Windows y Linux están en camino: la interfaz, la transcripción y el procesamiento ya son multiplataforma; falta la captura de audio de cada sistema.

Comentarios y errores: desde la app (⋯ → Enviar comentarios) o en [issues](https://github.com/soydavidcornejo/minuta/issues).

---

<a id="english"></a>
## English

**Minuta** is a free, open-source meeting notes app and communication coach that runs on your Mac. It records your meetings,
**transcribes them locally** (whisper.cpp + speaker separation), and uses the AI you choose — with your own account — to give you
notes, commitments, and honest, quote-backed feedback. Audio never leaves your Mac; notes are plain Markdown files you own,
optionally backed up to a private repo in your own GitHub or GitLab account. No Minuta accounts, servers or telemetry.

**Install:**

```bash
curl -fsSL https://raw.githubusercontent.com/soydavidcornejo/minuta/main/instalar.sh | bash
```

or download [`Minuta-macOS.zip`](https://github.com/soydavidcornejo/minuta/releases/latest/download/Minuta-macOS.zip), move it to
Applications and right-click → Open the first time. Requires an Apple silicon Mac, macOS 15+ and Claude Code with your Claude account.
The interface ships in Spanish and English (more languages downloadable). The code and comments are in Spanish.

## Licencia / License

[MIT](LICENSE)
