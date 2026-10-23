#!/usr/bin/env python3
"""Ejemplo: tus compromisos abiertos de todas las reuniones, en una lista (o en CSV para tu planilla o gestor de tareas).

Uso:
  python3 compromisos_abiertos.py ~/ruta/a/tus/notas            # lista en la terminal
  python3 compromisos_abiertos.py ~/ruta/a/tus/notas --csv > compromisos.csv
  python3 compromisos_abiertos.py ~/ruta/a/tus/notas --de Ana   # solo los de una persona

Lee las notas de Minuta (Markdown, ver "Formato de las notas" en el README): cada compromiso es una línea
"- [ ] responsable — qué — cuándo (AAAA-MM-DD)" bajo "### Próximos pasos". Solo usa la biblioteca estándar de Python.
Es un punto de partida: cópialo y adáptalo (mandarlos a Todoist, Notion, Slack, un calendario…).
"""
import csv
import os
import re
import sys

LINEA = re.compile(r"^\s*- \[ \] (?P<quien>[^—]+?) — (?P<que>.+?)(?: — (?P<cuando>[^(]*?))?(?: \((?P<fecha>\d{4}-\d{2}-\d{2})\))?\s*$")


def compromisos(carpeta):
    for nombre in sorted(os.listdir(carpeta)):
        if not nombre.endswith(".md"):
            continue
        with open(os.path.join(carpeta, nombre), encoding="utf-8") as f:
            texto = f.read()
        titulo = next((l[2:].strip() for l in texto.splitlines() if l.startswith("# ")), nombre)
        reunion = re.search(r"^fecha:\s*(\S+)", texto, re.M)
        pasos = texto.split("### Próximos pasos", 1)
        if len(pasos) < 2:
            continue
        for linea in pasos[1].split("\n## ", 1)[0].splitlines():
            m = LINEA.match(linea)
            if m:
                yield {"responsable": m["quien"].strip(), "que": m["que"].strip(), "cuando": (m["cuando"] or "").strip(),
                       "fecha": m["fecha"] or "", "reunion": titulo, "fecha_reunion": reunion[1] if reunion else ""}


def main():
    args = [a for a in sys.argv[1:]]
    if not args or args[0].startswith("-"):
        sys.exit(__doc__)
    carpeta = os.path.expanduser(args[0])
    quien = args[args.index("--de") + 1].lower() if "--de" in args else ""
    lista = [c for c in compromisos(carpeta) if not quien or c["responsable"].lower().startswith(quien)]
    lista.sort(key=lambda c: c["fecha"] or "9999")
    if "--csv" in args:
        w = csv.DictWriter(sys.stdout, fieldnames=list(lista[0]) if lista else ["responsable", "que", "cuando", "fecha", "reunion", "fecha_reunion"])
        w.writeheader()
        w.writerows(lista)
        return
    for c in lista:
        print(f"{c['fecha'] or '   sin fecha':>12}  {c['responsable']:<18} {c['que']}  ·  {c['reunion']}")
    print(f"\n{len(lista)} compromisos abiertos")


if __name__ == "__main__":
    main()
