# Cómo aportar a Minuta

Minuta es gratis y abierta, y la hacemos entre todos. Hay lugar para cualquiera, programes o no. *(English below.)*

## Sin programar

- **Conversa:** dudas, ideas a medio cocinar o algo que armaste con tus notas → [Discussions](https://github.com/minuta-app/minuta/discussions).
- **Cuéntanos qué falla o qué te gustaría:** desde la app (⋯ → Enviar comentarios) o en [issues](https://github.com/minuta-app/minuta/issues/new/choose).
- **Universos:** vota con 👍/👎 en la galería de la app, crea el tuyo (Universos → Crear universo) y propónlo al catálogo con 📤.
- **Traducciones:** revisa o suma un idioma en el [catálogo](https://github.com/minuta-app/minuta-catalogo/tree/main/idiomas).
- **Comparte lo que armaste:** tus notas son Markdown en tu Git ([formato](README.md#formato-de-las-notas)). Si hiciste un script,
  un tablero o una automatización, muéstralo en Discussions → *Muestra lo que armaste*: le sirve a más gente.

## Programando (con o sin IA)

1. Lee [`AGENTS.md`](AGENTS.md): arquitectura, reglas y cómo se conectan las piezas. Sirve igual para personas y para tu IA
   (Claude Code, Codex, Gemini/Antigravity: `CLAUDE.md` y `GEMINI.md` solo apuntan a ese archivo).
2. Haz un fork, una rama y tu cambio. La sección "Desarrollo" del [README](README.md#desarrollo) explica cómo correr la app.
3. Corre `bash pruebas/correr.sh` (lo mismo que revisa GitHub en cada cambio).
4. Abre un pull request contando qué cambia para quien usa Minuta y cómo lo probaste.

Reglas que importan: código, comentarios y textos en español (todo texto nuevo de la interfaz con su traducción en `ui/idiomas/en.json`);
**nada personal** en el repo (nombres, empresas, correos, notas reales: usa datos ficticios); y no romper el formato de las notas,
porque hay gente con scripts que dependen de él.

## Cómo revisamos

Todo entra por pull request y lo junta alguien que mantiene el proyecto: nadie puede subir cambios directo. Revisamos:

- **Siempre:** que las pruebas de GitHub pasen, que no haya datos personales y que el cambio haga lo que dice. Si es tu primer
  aporte, GitHub espera a que aprobemos correr las pruebas (es normal).
- **Código:** que no cambie el formato de las notas, que los textos nuevos tengan su traducción y que no agregue dependencias
  ni conexiones a internet nuevas sin conversarlo antes.
- **Universos e idiomas:** que sean solo datos válidos, homenajes breves (sin letras ni textos copiados) y, en los idiomas, que
  una persona que lo hable revise la traducción.

Si algo falta te lo pedimos con un comentario; casi nunca cerramos un aporte sin conversar.

¿Buscas por dónde empezar? Mira los issues con la etiqueta
[`good first issue`](https://github.com/minuta-app/minuta/labels/good%20first%20issue) o pregunta en Discussions.

**Fallas de seguridad:** nunca en un issue público. Avísanos en privado como explica [SECURITY.md](SECURITY.md).

Al participar aceptas el [código de conducta](CODE_OF_CONDUCT.md).

---

## Contributing (English)

- **No code needed:** chat in [Discussions](https://github.com/minuta-app/minuta/discussions), report bugs or ideas in
  [issues](https://github.com/minuta-app/minuta/issues/new/choose) (or from the app), vote and propose universes from the app's gallery,
  help with translations in the [catalog](https://github.com/minuta-app/minuta-catalogo), and share the scripts and automations you built on
  top of your notes ([format](README.md#formato-de-las-notas)).
- **Code (with or without AI):** read [`AGENTS.md`](AGENTS.md) (works for humans and any coding AI), fork, branch, run
  `bash pruebas/correr.sh` and open a pull request. The code and its comments are in Spanish; UI text needs its English entry in
  `ui/idiomas/en.json`; never commit personal data.
- **Review:** everything goes through a pull request and a maintainer merges it. We check tests, privacy and the note format;
  universes and languages must be data only, and translations get a review from a native speaker.
- **Security issues:** never in a public issue; report them privately as described in [SECURITY.md](SECURITY.md).
