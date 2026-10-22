#!/bin/bash
# Instala (o actualiza) Minuta con un solo comando:
#   curl -fsSL https://raw.githubusercontent.com/soydavidcornejo/minuta/main/instalar.sh | bash
# Baja la última versión publicada en GitHub, verifica su huella SHA-256 y la deja en ~/Applications.
# No pide contraseña ni instala nada más: tus datos quedan en ~/minuta y nunca se tocan.
set -euo pipefail
REPO="soydavidcornejo/minuta"
verde() { printf "\033[32m%s\033[0m\n" "$1"; }
error() { printf "\033[31m✗ %s\033[0m\n" "$1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || error "Por ahora Minuta funciona en macOS (Windows y Linux vienen en camino)."
[ "$(uname -m)" = "arm64" ] || error "Minuta necesita un Mac con chip Apple (M1 o posterior)."
VER=$(sw_vers -productVersion | cut -d. -f1)
[ "$VER" -ge 15 ] || error "Minuta necesita macOS 15 (Sequoia) o posterior. Tienes $(sw_vers -productVersion)."

echo "Buscando la última versión de Minuta…"
INFO=$(curl -fsSL -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/releases/latest") || error "No pude consultar GitHub."
# (sin python: en un Mac recién comprado /usr/bin/python3 pide instalar herramientas de Apple)
TAG=$(printf '%s' "$INFO" | tr ',' '\n' | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
[ -n "$TAG" ] || error "No encontré una versión publicada."
BASE="https://github.com/$REPO/releases/download/$TAG"

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
echo "Descargando Minuta $TAG…"
curl -fL --progress-bar "$BASE/Minuta-macOS.zip" -o "$TMP/Minuta-macOS.zip"
curl -fsSL "$BASE/Minuta-macOS.zip.sha256" -o "$TMP/Minuta-macOS.zip.sha256"
[ "$(shasum -a 256 "$TMP/Minuta-macOS.zip" | cut -d' ' -f1)" = "$(cut -d' ' -f1 "$TMP/Minuta-macOS.zip.sha256")" ] || error "La descarga no coincide con su huella. No instalé nada."
verde "✓ Descarga verificada"

ditto -x -k "$TMP/Minuta-macOS.zip" "$TMP/app"
xattr -dr com.apple.quarantine "$TMP/app/Minuta.app" 2>/dev/null || true
mkdir -p "$HOME/Applications"
osascript -e 'tell application id "app.minuta.mac" to quit' >/dev/null 2>&1 || true
sleep 1
rm -rf "$HOME/Applications/Minuta.app"
ditto "$TMP/app/Minuta.app" "$HOME/Applications/Minuta.app"
verde "✓ Minuta $TAG instalada en ~/Applications"
open "$HOME/Applications/Minuta.app"
echo "Se abrió el asistente de bienvenida: te va a preguntar quién eres, tu IA y dónde guardar tus notas."
