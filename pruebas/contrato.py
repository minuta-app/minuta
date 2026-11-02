#!/usr/bin/env python3
"""Contrato entre la interfaz (ui/app.js) y sus dos anfitriones: la app de Mac (Swift) y la de Windows/Linux (Electron).

Uso: python3 pruebas/contrato.py   (desde la raíz del repo)
Cada acción se atiende de una de tres formas (las del enchufe de Pieza):
  · declarada en acciones.json (lo arma pieza.py con app.json → «acciones» y las piezas): solo corre un script; la corren
    Declaradas (app/Sources/Minuta/Pieza.swift, con las reglas de la pieza «host-mac») y el host de Electron (host.js);
  · del host (pieza «host-escritorio»: listo, config, abrirEnlace, copiar);
  · registrada, lo nativo propio de Minuta: un caso en VisorWeb.swift/BarraMenu.swift y una entrada en ACCIONES de main.js
    (que se registra en el host con host.acciones.registrar).
Revisa que:
  1. cada acción que la interfaz manda con host.enviar("…") la atienda la app de Mac y la de Electron;
  2. cada acción del panel de la barra de menú (data-pn="…") la atienda BarraMenu.swift y ACCIONES;
  3. cada función que Swift o Electron llaman en la interfaz (window.Minuta.…), o que responde una acción declarada, exista;
  4. acciones.json esté al día con app.json, sus scripts existan en bin/ y nada que escribe la persona vaya como argumento;
  5. los puentes hablen la forma común de la pieza «host-ui» ({accion, datos}), solo atiendan el marco principal con una página de
     ui/ y lleven lo que no es suyo a las declaradas.
Si una acción es de un solo sistema a propósito, va en EXCEPCIONES con el motivo.
"""
import json
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
    errores = []
    # Las declaradas (acciones.json): las atienden los dos hosts sin código propio.
    app_json = json.loads(leer("app.json"))
    acciones_json = json.loads(leer("acciones.json")).get("acciones") or {}
    declaradas = set(acciones_json) - set(app_json.get("sin_acciones") or [])
    for n, d in (app_json.get("acciones") or {}).items():
        propia = {k: v for k, v in d.items() if k != "scriptDeLaApp"}
        if propia != {k: v for k, v in acciones_json.get(n, {}).items() if k != "pieza"}:
            errores.append(f"acciones.json no está al día con app.json en «{n}»: python3 <pieza>/herramientas/pieza.py acciones .")
    for n in app_json.get("sin_acciones") or []:
        if n in acciones_json:
            errores.append(f"acciones.json trae «{n}», que app.json → «sin_acciones» deja fuera")
    for n, d in acciones_json.items():
        if not os.path.exists(os.path.join(RAIZ, "bin", d.get("script", ""))):
            errores.append(f"la acción declarada «{n}» usa bin/{d.get('script')}, que no existe")
        for a in d.get("args") or []:
            if a.startswith("$") and (d.get("datos") or {}).get(a[1:], {}).get("tipo") not in ("enum", "entero"):
                errores.append(f"«{n}»: {a} va como argumento y no es enum ni entero (lo que escribe la persona va en el archivo de entrada)")

    ventana_mac, panel_mac = casos_swift(leer("app/Sources/Minuta/VisorWeb.swift")), casos_swift(leer("app/Sources/Minuta/BarraMenu.swift"))
    main_js = leer("escritorio/src/main.js")
    i = main_js.index("const ACCIONES")
    propias_electron = set(re.findall(r"^  ([A-Za-z]+)(?:: |\()", main_js[i:main_js.index("\n};", i)], re.M))
    host_js = leer("escritorio/src/host.js")
    del_host = set(re.findall(r'internas\.set\("(\w+)"', host_js))
    electron = propias_electron | del_host | declaradas
    # Mac: lo que no es un caso de VisorWeb/BarraMenu va a las declaradas (el `default` de cada puente).
    ventana_mac |= declaradas
    panel_mac |= declaradas
    for a in sorted(propias_electron & declaradas):
        errores.append(f"«{a}» está declarada en acciones.json y también en ACCIONES de main.js: la registrada taparía la declarada")

    acciones = set(re.findall(r'host\.enviar\(\s*"([A-Za-z]+)"', ui)) | set(re.findall(r'data-av="([A-Za-z]+)"', ui))
    del_panel = set(re.findall(r'data-pn="([A-Za-z]+)"', ui))
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

    obj = ui[ui.index("host.responder({"):]
    funciones = set(re.findall(r"^    (?:async )?([A-Za-z_]+)\s*(?:\(|:)", obj, re.M))
    llamadas = {}
    for ruta in ["app/Sources/Minuta/VisorWeb.swift", "app/Sources/Minuta/BarraMenu.swift", "app/Sources/Minuta/MinutaApp.swift",
                 "app/Sources/Minuta/Bienvenida.swift", "escritorio/src/main.js"]:
        t = leer(ruta)
        for f in set(re.findall(r'llamarFuncion\((?:[^,"]+,\s*)?"([A-Za-z]+)"', t)) | set(re.findall(r"window\.Minuta\.([A-Za-z]+)", t)):
            llamadas.setdefault(f, ruta)
    for n, d in acciones_json.items():
        if n in declaradas and d.get("responde"):
            llamadas.setdefault(d["responde"], f"acciones.json («{n}»)")
    for f, ruta in sorted(llamadas.items()):
        if f not in funciones:
            errores.append(f"{ruta} llama window.Minuta.{f}, que no existe en ui/app.js")

    # La forma del mensaje (pieza «host-ui»): nada de campos sueltos al lado de `accion`.
    if re.search(r"crearHost\(\{[^}]*plano", ui) or 'nombre: "minuta"' not in ui:
        errores.append("ui/app.js: el puente es PiezaHost.crearHost({nombre: \"minuta\", …}) sin «plano»")
    for ruta in ["app/Sources/Minuta/VisorWeb.swift", "app/Sources/Minuta/BarraMenu.swift"]:
        t = leer(ruta)
        if 'let datos = cuerpo["datos"] as? [String: Any] ?? [:]' not in t:
            errores.append(f"{ruta}: el mensaje es {{accion, datos}}: los datos se leen de cuerpo[\"datos\"]")
        if "isMainFrame" not in t or "Temas.esDeLaInterfaz(mensaje.frameInfo.request.url)" not in t:
            errores.append(f"{ruta}: el puente solo atiende el marco principal con una página de ui/ (Temas.esDeLaInterfaz)")
        if not re.search(r"default:\s*\n(\s*//.*\n)*\s*Declaradas\.correr\(accion, datos\)", t):
            errores.append(f"{ruta}: lo que no es un caso propio va a las acciones declaradas (default: Declaradas.correr)")
    if "host.acciones.registrar(nombre, (d) => fn(d, ventana))" not in main_js or "msg.datos" not in main_js:
        errores.append("escritorio/src/main.js: las acciones propias se registran en el host (reciben los datos de {accion, datos})")
    if "e.senderFrame !== e.sender.mainFrame" not in main_js or "startsWith(host.ORIGEN)" not in main_js:
        errores.append("escritorio/src/main.js: el puente del panel solo atiende su marco principal con la página minuta://ui/")
    if "exposeInMainWorld(`${id}Escritorio`" not in leer("escritorio/src/preload.js") or "--pieza-host=" not in main_js:
        errores.append("escritorio/src/preload.js (pieza «host-escritorio»): el canal es window.minutaEscritorio (lo busca host-ui)")
    ia = (acciones_json.get("probarIA") or {}).get("datos", {}).get("ia", {})
    if ia.get("tipo") != "enum" or 'host.enviar("probarIA", { ia:' not in ui:
        errores.append("probarIA va con {ia} (pieza «host-ui»): declarada por la pieza «ia» con ia enum")

    if errores:
        print("✗ El contrato entre la interfaz y las apps no calza:")
        print("\n".join("  - " + e for e in errores))
        sys.exit(1)
    print(f"✓ Contrato al día: {len(acciones)} acciones, {len(del_panel)} del panel y {len(llamadas)} funciones de la interfaz.")


if __name__ == "__main__":
    main()
