#!/bin/bash
# Revisa que lo que se va a subir no tenga datos personales del usuario.
# Uso: bash herramientas/revisar_privacidad.sh [--todo]   (por defecto: lo que está en stage; --todo: todos los archivos versionados)
# Los términos a buscar están en .terminos-privados (local, nunca se versiona): uno por línea, sin distinguir mayúsculas.
cd "$(dirname "$0")/.." || exit 1
LISTA=.terminos-privados
# En GitHub (CI) no existe la lista privada: se revisan solo correos personales y rutas de usuario en todo lo versionado.
if [ "$1" = "--generico" ]; then
  HALLAZGOS=$(git ls-files -z | xargs -0 grep -InE "[A-Za-z0-9._%+-]+@(gmail|hotmail|outlook|yahoo)\.com|/Users/[a-z]" 2>/dev/null | grep -v 'users.noreply.github.com' | head -40)
  if [ -n "$HALLAZGOS" ]; then echo "✗ Posibles datos personales:"; printf '%s\n' "$HALLAZGOS"; exit 1; fi
  echo "✓ Sin correos personales ni rutas de usuario."; exit 0
fi
if [ ! -s "$LISTA" ]; then
  echo "⚠️  Falta $LISTA (nombres, empresas, correos y rutas del usuario, uno por línea). Créalo antes de commitear." >&2
  exit 2
fi
if [ "$1" = "--todo" ]; then
  CONTENIDO=$(git ls-files -z | xargs -0 cat 2>/dev/null)
else
  CONTENIDO=$(git diff --cached -U0 | grep '^+' | grep -v '^+++')
fi
PATRON=$(grep -v '^\s*#' "$LISTA" | grep -v '^\s*$' | sed 's/[.[\*^$]/\\&/g' | paste -sd'|' -)
PATRON="${PATRON}|[A-Za-z0-9._%+-]+@(gmail|hotmail|outlook|yahoo)\.com|/Users/[a-z]"
HALLAZGOS=$(printf '%s\n' "$CONTENIDO" | grep -inE "$PATRON" | grep -v 'users.noreply.github.com' | head -40)
if [ -n "$HALLAZGOS" ]; then
  echo "✗ Posibles datos personales:"; printf '%s\n' "$HALLAZGOS"; exit 1
fi
echo "✓ Sin datos personales en lo revisado."
