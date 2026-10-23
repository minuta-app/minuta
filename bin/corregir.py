#!/usr/bin/env python3
"""Corrige una nota con la IA del usuario a partir de una instrucción en palabras.

Uso: corregir.py <nota.md> <instruccion.txt> <salida.json>

Ejemplo de instrucción: "Ana no es la PO, es la Scrum Master; la Persona 2 es Matías y él es el PO".
La IA reescribe el contenido de la nota (temas, próximos pasos, personas, feedback) aplicando SOLO esa corrección,
cambia quién habla en la transcripción si corresponde y devuelve lo que conviene recordar para las próximas reuniones
(queda en personas_conocidas.json). Antes de escribir se guarda una copia de la nota en ~/minuta/respaldos/.
"""
import json
import os
import re
import sys
from datetime import datetime

from perfil import BASE, NOMBRE, NOMBRE_IA, ejecutar_ia, limpiar_nombre, agregar_hechos, es_usuario

MARCADORES = ["### Próximos pasos", "## Personas", "## Feedback para", "**Veredicto:**", "**Puntajes:**"]


def partes(texto):
    """(frontmatter, contenido de la nota, resto: métricas y transcripción)."""
    fm, cuerpo = "", texto
    if texto.startswith("---\n"):
        i = texto.find("\n---\n", 4)
        if i > 0:
            fm, cuerpo = texto[:i + 5], texto[i + 5:]
    corte = min([i for i in (cuerpo.find("\n## Métricas"), cuerpo.find("\n## Transcripción")) if i >= 0] or [len(cuerpo)])
    return fm, cuerpo[:corte].strip("\n"), cuerpo[corte:]


def leer_participantes(fm):
    m = re.search(r"^participantes:\s*(.*)$", fm, re.M)
    if not m:
        return []
    bruto = m.group(1).strip()
    try:
        lista = json.loads(bruto)
    except ValueError:  # formato antiguo: ["a", "b"] con comillas sin escapar
        lista = re.findall(r'"(.*?)"(?=\s*,\s*"|\s*\]$)', bruto) or bruto.strip("[]").split(",")
    return [str(x) for x in lista]


def escribir_participantes(fm, nombres):
    linea = "participantes: " + json.dumps(nombres, ensure_ascii=False)
    if re.search(r"^participantes:.*$", fm, re.M):
        return re.sub(r"^participantes:.*$", lambda _: linea, fm, count=1, flags=re.M)
    return fm.replace("\n---\n", f"\n{linea}\n---\n", 1) if fm else fm


def limpiar_etiquetas(texto):
    """Quién habla en la transcripción: 'Ana (PO, dice que…):' → 'Ana:' (notas viejas guardaban comentarios de la IA)."""
    def limpiar(m):
        nombre = limpiar_nombre(m.group(2))
        return m.group(1) + (nombre or m.group(2).split("(")[0].strip() or "?") + ":"
    return re.sub(r"(^>\s*\[[\d:]+\]\s*)([^:\n]*\([^\n]*?\)[^:\n]*):", limpiar, texto, flags=re.M)


def prompt_para(instruccion, contenido, participantes, transcripcion):
    return f"""Eres el asistente de notas de {NOMBRE}. {NOMBRE} revisó una nota de reunión y te pide esta corrección:

«{instruccion}»

Aplica la corrección en TODO el contenido de la nota donde corresponda: temas, responsables de los próximos pasos,
la sección de Personas (nombres y roles) y el feedback. No cambies nada más: misma estructura, mismos marcadores en
español (### Próximos pasos, ## Personas, ## Feedback para…, **Veredicto:**, **Puntajes:**, 🔧, ✅, → Prueba:), mismas
casillas "- [ ]" y "- [x]" tal como están, mismo idioma. No inventes datos que no estén en la nota, la transcripción o la corrección.
Si la corrección dice quién es quién (por ejemplo "la Persona 2 es Matías" o "el que aparece como Jaime es Matías"),
inclúyelo en RENOMBRAR para corregir también la transcripción.

Participantes registrados: {", ".join(participantes) or "(ninguno)"}

Responde EXACTAMENTE en este formato (las tres primeras líneas en una sola línea cada una):
RENOMBRAR: <nombre o etiqueta actual> => <nombre correcto>; ...   (o "ninguno")
RECORDAR: <dato sobre una persona que sirve para próximas reuniones> | <otro dato> ...   (o "ninguno"; p. ej. "Ana es la Scrum Master")
CAMBIOS: <una frase corta que diga qué corregiste>
===NOTA===
<la nota completa corregida, desde la línea "# Título" inclusive>

=== NOTA ACTUAL ===
{contenido}

=== TRANSCRIPCIÓN (solo para contexto, no la devuelvas) ===
{transcripcion[:45000]}
"""


def responder(salida, datos):
    with open(salida, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False)


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    ruta, archivo_instr, salida = sys.argv[1:]
    with open(archivo_instr, encoding="utf-8") as f:
        instruccion = f.read().strip()
    with open(ruta, encoding="utf-8") as f:
        original = f.read()
    fm, contenido, resto = partes(original)
    participantes = leer_participantes(fm)
    transcripcion = resto.split("## Transcripción", 1)[-1] if "## Transcripción" in resto else ""
    if not instruccion or not contenido:
        return responder(salida, {"ok": False, "error": "No hay nada que corregir."})

    r = ejecutar_ia(prompt_para(instruccion, contenido, participantes, transcripcion), timeout=900)
    texto = (r.stdout or "").strip()
    if r.returncode != 0 or "===NOTA===" not in texto:
        print(f"{NOMBRE_IA} falló: {(r.stderr or texto)[-300:]}")
        return responder(salida, {"ok": False, "error": f"{NOMBRE_IA} no devolvió la nota corregida."})
    cabecera, nueva = texto.split("===NOTA===", 1)
    nueva = nueva.strip("\n")
    nueva = nueva[nueva.find("# "):] if "# " in nueva else nueva

    # Validación: que no se pierda la estructura ni el estado de los compromisos.
    faltan = [m for m in MARCADORES if m in contenido and m not in nueva]
    if not nueva.startswith("# ") or faltan or nueva.count("- [x]") != contenido.count("- [x]"):
        print("Validación:", faltan, nueva[:80])
        return responder(salida, {"ok": False, "error": "La corrección cambiaba la estructura de la nota; no la apliqué. Intenta decirlo de otra forma."})

    def campo(nombre):
        m = re.search(rf"^{nombre}:\s*(.*)$", cabecera, re.M)
        v = (m.group(1).strip() if m else "")
        return "" if v.lower().strip(". ") in ("", "ninguno", "ninguna", "none") else v

    renombres = []
    for par in campo("RENOMBRAR").split(";"):
        if "=>" in par:
            viejo, nuevo = (x.strip().strip('"“”') for x in par.split("=>", 1))
            nuevo = "Yo" if es_usuario(nuevo) else limpiar_nombre(nuevo)
            if viejo and nuevo and viejo != nuevo:
                renombres.append((viejo, nuevo))
    recordar = [x.strip() for x in campo("RECORDAR").split("|") if x.strip()]

    # Transcripción: solo cambia quién habla ("[00:01:02] Persona 2: …"). Métricas: el nombre donde aparezca.
    metricas, sep, transc = resto.partition("## Transcripción")
    for viejo, nuevo in sorted(renombres, key=lambda x: -len(x[0])):
        transc = re.sub(rf"(^>\s*\[[\d:]+\]\s*){re.escape(viejo)}:", lambda m: m.group(1) + nuevo + ":", transc, flags=re.M)
        metricas = re.sub(rf"(?<!\w){re.escape(viejo)}(?!\w)", lambda _: nuevo, metricas)
    resto = metricas + sep + transc
    resto = limpiar_etiquetas(resto)
    mapa = dict(renombres)
    nombres, vistos = [], set()
    for p in participantes + [n for _, n in renombres]:
        n = mapa.get(p, p)
        n = limpiar_nombre(mapa.get(n, n))
        if n and not es_usuario(n) and n.lower() not in vistos:
            nombres.append(n)
            vistos.add(n.lower())
    fm = escribir_participantes(fm, nombres)

    respaldos = os.path.join(BASE, "respaldos")
    os.makedirs(respaldos, exist_ok=True)
    copia = os.path.join(respaldos, f"{os.path.splitext(os.path.basename(ruta))[0]} · antes de corregir {datetime.now():%Y-%m-%d %H%M%S}.md")
    with open(copia, "w", encoding="utf-8") as f:
        f.write(original)
    with open(ruta, "w", encoding="utf-8") as f:
        f.write(fm + nueva + "\n\n" + resto.lstrip("\n"))
    if recordar:
        agregar_hechos(recordar)
    print("Corregida:", ruta, "| renombres:", len(renombres), "| recordar:", recordar)
    responder(salida, {"ok": True, "cambios": campo("CAMBIOS") or "Nota corregida.", "renombres": len(renombres),
                       "recordados": recordar, "respaldo": copia})


if __name__ == "__main__":
    main()
