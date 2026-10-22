#!/bin/bash
# Compila Minuta y la instala en ~/Applications/Minuta.app (para desarrollo en este Mac).
# El empaquetado está en herramientas/empaquetar.sh (el mismo que usa GitHub para publicar versiones).
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$PATH
RAIZ="$(cd "$(dirname "$0")" && pwd)"

# Si se está procesando una reunión, reemplazar la app rompería el procesamiento (usa herramientas de adentro).
if pgrep -f "bin/procesar.py" >/dev/null && [ "${FORZAR:-0}" != "1" ]; then
  echo "✗ Minuta está procesando una reunión. Espera a que termine (o usa FORZAR=1)." >&2
  exit 3
fi
# Si hay una grabación en curso (carpeta más nueva sin meta.json), cerrar la app la cortaría.
ULTIMA=$(ls -d "$HOME/minuta/grabaciones/"*/ 2>/dev/null | tail -1 || true)
if [ -n "$ULTIMA" ] && [ ! -f "$ULTIMA/meta.json" ] && pgrep -x Minuta >/dev/null && [ "${FORZAR:-0}" != "1" ]; then
  echo "✗ Hay una grabación en curso. Instala cuando termine (o usa FORZAR=1)." >&2
  exit 3
fi

bash "$RAIZ/herramientas/empaquetar.sh"
APP="$HOME/Applications/Minuta.app"
mkdir -p "$HOME/Applications"
pkill -x Minuta 2>/dev/null || true
rm -rf "$APP"
ditto "$RAIZ/dist/Minuta.app" "$APP"
echo "Instalada en $APP ($(du -sh "$APP" | cut -f1))"
