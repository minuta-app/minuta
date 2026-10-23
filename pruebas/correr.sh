#!/bin/bash
# Corre en tu computador las mismas revisiones que GitHub (.github/workflows/revisar.yml), salvo compilar Swift.
# Uso: bash pruebas/correr.sh   (la prueba de la interfaz necesita Playwright; si no está, se salta con un aviso)
set -e
cd "$(dirname "$0")/.."
echo "· Sintaxis"
node --check ui/app.js
for f in escritorio/src/*.js; do node --check "$f"; done
python3 -m py_compile bin/*.py pruebas/*.py
echo "· Privacidad"
if [ -s .terminos-privados ]; then bash herramientas/revisar_privacidad.sh --todo; else bash herramientas/revisar_privacidad.sh --generico; fi
echo "· Contrato"
python3 pruebas/contrato.py
echo "· Python"
python3 pruebas/test_python.py 2>&1 | tail -3
python3 pruebas/evaluar_ia.py
echo "· Interfaz"
if [ -n "${PLAYWRIGHT:-}" ] || node -e "require.resolve('playwright')" 2>/dev/null; then node pruebas/interfaz.mjs
else echo "  (sin Playwright: instala con 'npm i -g playwright && npx playwright install chromium' o usa PLAYWRIGHT=/ruta/a/playwright)"; fi
