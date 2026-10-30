#!/bin/bash
# Arma dist/Minuta.app (autosuficiente) y dist/Minuta-macOS.zip + .sha256, sin instalar nada.
# Lo usan build.sh (en tu Mac) y la acción de GitHub que publica cada versión.
# Dentro van: la app, minuta-transcribir + whisper.framework, minuta-diarizar, Python portátil y el código
# (bin/, ui/, universos/ y app.json) en Contents/Resources/minuta. Los datos del usuario quedan en ~/minuta.
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$PATH
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ/app"
swift build -c release 2>&1 | tee "${MINUTA_PROGRESO:-/dev/null}" | tail -20  # MINUTA_PROGRESO: la app lee "[n/m]" para mostrar el avance
REL=.build/release

# Python portátil (python-build-standalone): se descarga una vez y se verifica su huella.
PY_URL="https://github.com/astral-sh/python-build-standalone/releases/download/20261003/cpython-3.13.16%2B20261003-aarch64-apple-darwin-install_only_stripped.tar.gz"
PY_SHA="9e01f63bbb08576cd9c8bc2d0564d098cb30c8453a0cd4bcf6aef458f6d2a147"
PY_TGZ=.build/python-3.13.16.tar.gz
if [ ! -f "$PY_TGZ" ] || [ "$(shasum -a 256 "$PY_TGZ" | cut -d' ' -f1)" != "$PY_SHA" ]; then
  curl -fsSL "$PY_URL" -o "$PY_TGZ.tmp"
  [ "$(shasum -a 256 "$PY_TGZ.tmp" | cut -d' ' -f1)" = "$PY_SHA" ] || { echo "✗ El Python descargado no coincide con su huella" >&2; exit 1; }
  mv "$PY_TGZ.tmp" "$PY_TGZ"
fi

DIST="$RAIZ/dist"; APP="$DIST/Minuta.app"
rm -rf "$DIST"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/minuta" "$APP/Contents/Frameworks"
cp "$REL/Minuta" "$REL/minuta-transcribir" "$REL/minuta-diarizar" "$APP/Contents/MacOS/"
cp Info.plist "$APP/Contents/Info.plist"
ditto "$REL/whisper.framework" "$APP/Contents/Frameworks/whisper.framework"
tar -xzf "$PY_TGZ" -C "$APP/Contents/Resources"   # → Resources/python/bin/python3
# Código de la app (sin cachés ni datos de prueba pesados).
for d in bin ui universos; do ditto "$RAIZ/$d" "$APP/Contents/Resources/minuta/$d"; done
# app.json: la descripción de la app que leen las piezas de Pieza (bin/nucleo.py la busca junto a bin/).
cp "$RAIZ/app.json" "$APP/Contents/Resources/minuta/app.json"
find "$APP/Contents/Resources/minuta" -name "__pycache__" -prune -exec rm -rf {} + 2>/dev/null || true
rm -f "$APP/Contents/Resources/minuta/bin/minuta-diarizar"* 2>/dev/null || true
chmod +x "$APP/Contents/Resources/minuta/bin/"*.py

# Firma ad hoc, de adentro hacia afuera. El requisito por identificador conserva los permisos entre versiones.
codesign --force --sign - "$APP/Contents/Frameworks/whisper.framework"
find "$APP/Contents/Resources/python" -type f \( -name "*.so" -o -name "*.dylib" -o -perm -u+x \) -exec codesign --force --sign - {} \; 2>/dev/null || true
codesign --force --sign - "$APP/Contents/MacOS/minuta-transcribir" "$APP/Contents/MacOS/minuta-diarizar"
codesign --force --sign - --requirements '=designated => identifier "app.minuta.mac"' "$APP"

cd "$DIST"
ditto -c -k --keepParent Minuta.app Minuta-macOS.zip
shasum -a 256 Minuta-macOS.zip > Minuta-macOS.zip.sha256
echo "Listo: $DIST/Minuta-macOS.zip ($(du -h Minuta-macOS.zip | cut -f1))"
