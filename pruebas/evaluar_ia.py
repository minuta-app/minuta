#!/usr/bin/env python3
"""Revisa que lo que escribe la IA para una nota tenga la estructura que la app necesita.

Uso:
  python3 pruebas/evaluar_ia.py                  # valida la respuesta de ejemplo (sin IA; corre en GitHub)
  python3 pruebas/evaluar_ia.py --real           # le pide la nota a TU IA con transcripciones ficticias (pruebas/ia/transcripcion_*.txt)
  python3 pruebas/evaluar_ia.py --respuesta x.md # valida una respuesta guardada

Úsalo con --real antes de cambiar el prompt de bin/procesar.py: si algo deja de cumplirse, la app mostraría mal la nota
(nombres con comentarios, compromisos sin responsable, puntajes que no se leen…).
"""
import glob
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARPETA = os.path.join(RAIZ, "pruebas", "ia")


def revisar(respuesta):
    """Lista de problemas (vacía si está todo bien)."""
    sys.path.insert(0, os.path.join(RAIZ, "bin"))
    from perfil import limpiar_nombre
    p = []
    lineas = respuesta.strip().splitlines()
    if not lineas or not lineas[0].upper().startswith("TITULO:"):
        p.append("la primera línea debe ser TITULO:")
    elif len(lineas[0].split(":", 1)[1].split()) > 10:
        p.append("el título es muy largo")
    hab = next((l for l in lineas if l.upper().startswith("HABLANTES:")), "")
    for num, nombre in re.findall(r"Persona (\d+)\s*=\s*([^;]+)", hab):
        nombre = nombre.strip().rstrip(".")
        if nombre != "?" and limpiar_nombre(nombre) != nombre:
            p.append(f"HABLANTES: «{nombre}» no es solo un nombre (Persona {num})")
    for marca in ["### Próximos pasos", "## Feedback para", "**Veredicto:**", "**Puntajes:**", "**Hábito para la próxima:**"]:
        if marca not in respuesta:
            p.append(f"falta el marcador «{marca}»")
    pasos = respuesta.split("### Próximos pasos", 1)[-1].split("\n## ", 1)[0]
    for l in [l for l in pasos.splitlines() if l.strip().startswith("- [")]:
        if not re.match(r"^\s*- \[[ x]\] [^—]+ — .+", l):
            p.append(f"compromiso sin «responsable — qué»: {l.strip()[:70]}")
    punt = re.search(r"\*\*Puntajes:\*\*\s*Claridad (\d+) · Escucha (\d+) · Preguntas (\d+) · Cierre (\d+)", respuesta)
    if not punt:
        p.append("los puntajes no tienen el formato «Claridad X · Escucha X · Preguntas X · Cierre X»")
    elif not all(1 <= int(x) <= 10 for x in punt.groups()):
        p.append("puntajes fuera de 1 a 10")
    for l in re.findall(r"^\s*- \*\*([^*]+)\*\*", respuesta.split("## Personas", 1)[-1].split("\n## ", 1)[0], re.M):
        if limpiar_nombre(l) != l.strip():
            p.append(f"## Personas: «{l}» no es solo un nombre")
    return p


def main():
    args = sys.argv[1:]
    respuestas = []
    if "--respuesta" in args:
        ruta = args[args.index("--respuesta") + 1]
        respuestas.append((ruta, open(ruta, encoding="utf-8").read()))
    elif "--real" in args:
        sys.path.insert(0, os.path.join(RAIZ, "bin"))
        import procesar
        from perfil import ejecutar_ia, NOMBRE_IA
        for ruta in sorted(glob.glob(os.path.join(CARPETA, "transcripcion_*.txt"))):
            transcripcion = open(ruta, encoding="utf-8").read()
            m = {"duracion_min": 1, "habla_por_persona_min": {"Yo": 0.4, "Persona 1": 0.3, "Persona 2": 0.3}}
            meta = {"tipo": "Otra", "titulo": ""}
            print(f"· {os.path.basename(ruta)}: pidiéndole la nota a {NOMBRE_IA}…")
            r = ejecutar_ia(procesar.prompt_para(meta, m, transcripcion), timeout=600)
            respuestas.append((ruta, r.stdout or ""))
    else:
        respuestas.append(("respuesta_ejemplo.md", open(os.path.join(CARPETA, "respuesta_ejemplo.md"), encoding="utf-8").read()))
    fallas = 0
    for nombre, texto in respuestas:
        problemas = revisar(texto)
        if problemas:
            fallas += 1
            print(f"✗ {os.path.basename(nombre)}:\n  - " + "\n  - ".join(problemas))
        else:
            print(f"✓ {os.path.basename(nombre)}: estructura correcta")
    sys.exit(1 if fallas else 0)


if __name__ == "__main__":
    main()
