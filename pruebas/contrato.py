#!/usr/bin/env python3
"""Contrato entre la interfaz (ui/app.js) y sus dos anfitriones: la app de Mac (Swift) y la de Windows/Linux (Electron).

Uso: python3 pruebas/contrato.py   (desde la raíz del repo)
Revisa que:
  1. cada acción que la interfaz manda con host.enviar("…") exista en la ventana de Mac (VisorWeb.swift) y en ACCIONES de Electron;
  2. cada acción del panel de la barra de menú (data-pn="…") exista en BarraMenu.swift y en ACCIONES;
  3. cada función que Swift o Electron llaman en la interfaz (window.Minuta.…) exista.
Si una acción es de un solo sistema a propósito, va en EXCEPCIONES con el motivo.
"""
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXCEPCIONES = {
    "calendarioICS": "solo Windows/Linux: en Mac el calendario se lee del sistema (EventKit)",
}


def leer(ruta):
    with open(os.path.join(RAIZ, ruta), encoding="utf-8") as f:
        return f.read()


def casos_swift(texto):
    return set(re.findall(r'case "([A-Za-z]+)"', texto))


def main():
    ui = leer("ui/app.js")
    ventana_mac, panel_mac = casos_swift(leer("app/Sources/Minuta/VisorWeb.swift")), casos_swift(leer("app/Sources/Minuta/BarraMenu.swift"))
    main_js = leer("escritorio/src/main.js")
    i = main_js.index("const ACCIONES")
    electron = set(re.findall(r"^  ([A-Za-z]+)(?:: |\()", main_js[i:main_js.index("\n};", i)], re.M))

    acciones = set(re.findall(r'host\.enviar\(\s*"([A-Za-z]+)"', ui)) | set(re.findall(r'data-av="([A-Za-z]+)"', ui))
    del_panel = set(re.findall(r'data-pn="([A-Za-z]+)"', ui))
    errores = []
    for a in sorted(acciones):
        if a in EXCEPCIONES:
            continue
        if a not in ventana_mac and a not in panel_mac:
            errores.append(f"«{a}»: la interfaz la usa pero no está en VisorWeb.swift ni BarraMenu.swift")
        if a not in electron:
            errores.append(f"«{a}»: la interfaz la usa pero no está en ACCIONES de escritorio/src/main.js")
    for a in sorted(del_panel):
        if a not in panel_mac:
            errores.append(f"«{a}» (panel): falta en BarraMenu.swift")
        if a not in electron:
            errores.append(f"«{a}» (panel): falta en ACCIONES de escritorio/src/main.js")

    obj = ui[ui.index("window.Minuta = {"):]
    funciones = set(re.findall(r"^    (?:async )?([A-Za-z_]+)\s*(?:\(|:)", obj, re.M))
    llamadas = {}
    for ruta in ["app/Sources/Minuta/VisorWeb.swift", "app/Sources/Minuta/BarraMenu.swift", "app/Sources/Minuta/MinutaApp.swift",
                 "app/Sources/Minuta/Bienvenida.swift", "escritorio/src/main.js"]:
        t = leer(ruta)
        for f in set(re.findall(r'llamarFuncion\((?:[^,"]+,\s*)?"([A-Za-z]+)"', t)) | set(re.findall(r"window\.Minuta\.([A-Za-z]+)", t)):
            llamadas.setdefault(f, ruta)
    for f, ruta in sorted(llamadas.items()):
        if f not in funciones:
            errores.append(f"{ruta} llama window.Minuta.{f}, que no existe en ui/app.js")

    if errores:
        print("✗ El contrato entre la interfaz y las apps no calza:")
        print("\n".join("  - " + e for e in errores))
        sys.exit(1)
    print(f"✓ Contrato al día: {len(acciones)} acciones, {len(del_panel)} del panel y {len(llamadas)} funciones de la interfaz.")


if __name__ == "__main__":
    main()
