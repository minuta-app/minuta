# Seguridad de Minuta

*(English below.)*

Minuta vive en tu computador y trabaja con cosas privadas: audio y transcripciones de tus reuniones, notas, tokens de GitHub o GitLab para el respaldo y la dirección secreta de tu calendario. Si encuentras una falla de seguridad, gracias por
avisarnos **en privado** para arreglarla antes de que alguien la aproveche.

## Cómo avisar

1. Entra a [**Reportar una vulnerabilidad**](https://github.com/minuta-app/minuta/security/advisories/new) (pestaña *Security* del repo).
   Solo quienes mantienen el proyecto ven lo que escribas.
2. Cuenta qué encontraste, cómo reproducirlo (pasos, sistema y versión de Minuta) y qué podría hacer alguien con eso.
3. **No abras un issue público ni un pull request** con el detalle mientras no esté arreglado.

Te respondemos dentro de una semana. Cuando esté resuelto publicamos una versión nueva (las apps se actualizan solas) y un
aviso de seguridad, con tu nombre si quieres.

## Qué cubre

- La app de Mac, la de Windows y Linux, los scripts de `bin/`, la interfaz (`ui/`), los instaladores (`instalar.sh`,
  `instalar.ps1`), el actualizador y los workflows de GitHub Actions.
- Ejemplos de lo que nos importa: código que se ejecuta desde contenido externo (catálogo, notas, transcripciones, respuestas
  de la IA), acceso a archivos fuera de las carpetas de la app, fugas de tokens o grabaciones, descargas sin verificar y
  cualquier forma de publicar una versión que no salga de este repo.
- Fuera de alcance: fallas de la IA de cada persona (Claude Code, Codex, Gemini), de GitHub o del sistema operativo; avísales a
  ellos. Si afecta cómo Minuta las usa, sí cuéntanos.

## Versiones con soporte

Solo la última versión publicada en [Releases](https://github.com/minuta-app/minuta/releases/latest).

## Cómo nos cuidamos

- Todo cambio entra por pull request y lo revisa una persona antes de juntarlo; los workflows nunca corren código de un
  pull request con permisos de escritura ni con secretos.
- Las actions de GitHub van fijadas por su commit (SHA) y con los permisos mínimos; Dependabot propone actualizaciones
  con unos días de espera.
- Las descargas que hace la app (versiones nuevas, modelos, Python, herramientas) se verifican con su huella SHA-256 antes
  de usarse.
- Lo que viene de afuera (universos, idiomas, transcripciones, respuestas de la IA) es solo dato: se valida, se escapa
  antes de mostrarse y la interfaz tiene una política de contenido (CSP) que no deja ejecutar código que no sea el de la app.
- La IA de cada persona corre sin herramientas, sin servidores MCP, sin su memoria y sin las variables de la app; si su
  versión no permite quitarle las herramientas, no se usa. El pedido va por la entrada estándar o en un archivo, nunca como
  argumento. El puente de la app solo atiende a su propia ventana (marco principal y origen de la app).

---

## Security (English)

Minuta runs on your computer and handles private data (meeting audio and transcripts, notes, GitHub/GitLab backup tokens and your secret calendar address). If you find a security issue, please report it
**privately** through [**Report a vulnerability**](https://github.com/minuta-app/minuta/security/advisories/new) in the repo's
*Security* tab. Include what you found, how to reproduce it (steps, OS and Minuta version) and its impact. Please don't
open a public issue or pull request with the details until it's fixed. We reply within a week, ship a fixed release (the
apps update themselves) and publish an advisory, crediting you if you want. Only the latest release is supported.
