#!/usr/bin/env python3
"""Formato de un paquete de idioma de Minuta (solo textos). El MISMO archivo vive en `minuta-catalogo/herramientas/`. Lo usa la
pieza «catálogo» (`bin/catalogo.py`, tipo `idiomas` en app.json).

En el catálogo cada idioma vive en `idiomas/<categoria>/<codigo>.json` (hoy, `comunidad`); `id` es el mismo `codigo`.
Uso: idioma_formato.py <archivo.json>…   (sale con 1 si alguno no sirve)
"""
import json
import re
import sys

FORMATO = 1
CATEGORIAS = ("comunidad",)
CAMPOS = ("id", "categoria", "codigo", "nombre", "bandera", "textos", "palabras")
MAXIMO_TEXTOS = 5000


def _pares(v):
    return isinstance(v, dict) and all(isinstance(k, str) and isinstance(x, str) and len(k) <= 2000 and len(x) <= 2000
                                       for k, x in v.items())


def validar(d):
    """[problemas] (vacío = sirve). Las traducciones son solo texto: la interfaz las vuelve a validar (pieza «i18n»)."""
    if not isinstance(d, dict):
        return ["no es un objeto JSON"]
    errores = []
    # Por ahora solo dos letras: el archivo se guarda como <id>.json y la app lo busca por su código.
    if not isinstance(d.get("codigo"), str) or not re.fullmatch(r"[a-z]{2}", d["codigo"]) or d["codigo"] == "es":
        errores.append("codigo: dos letras minúsculas (el español es el idioma del código)")
    elif d.get("id") != d["codigo"]:
        errores.append("id: debe ser igual a codigo")
    extra = set(d) - set(CAMPOS)
    if extra:
        errores.append(f"claves no permitidas: {sorted(extra)}")
    if not isinstance(d.get("nombre"), str) or not 0 < len(d["nombre"]) <= 40:
        errores.append("falta «nombre» (como se llama el idioma en su idioma)")
    if "bandera" in d and (not isinstance(d["bandera"], str) or len(d["bandera"]) > 16):
        errores.append("bandera: un emoji")
    if not _pares(d.get("textos")) or not d["textos"] or len(d["textos"]) > MAXIMO_TEXTOS:
        errores.append("textos: un objeto «texto en español» → «traducción»")
    if "palabras" in d and not _pares(d["palabras"]):
        errores.append("palabras: un objeto «palabra» → «traducción»")
    return errores


if __name__ == "__main__":
    malos = 0
    for ruta in sys.argv[1:]:
        try:
            with open(ruta, encoding="utf-8") as f:
                p = validar(json.load(f))
        except (OSError, ValueError) as e:
            p = [f"no es JSON ({e})"]
        print(("✗ " if p else "✓ ") + ruta + (": " + "; ".join(p) if p else ""))
        malos += bool(p)
    sys.exit(1 if malos else 0)
