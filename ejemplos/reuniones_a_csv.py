#!/usr/bin/env python3
"""Ejemplo: todas tus reuniones en una planilla (CSV), una fila por reunión.

Uso:
  python3 reuniones_a_csv.py ~/ruta/a/tus/notas > reuniones.csv
  python3 reuniones_a_csv.py ~/ruta/a/tus/notas --tipo Clientes > clientes.csv   # solo un tipo de reunión

Lee las notas de Minuta (Markdown, ver "Formato de las notas" en el README): fecha, hora, tipo, duración, % de habla y
participantes salen del frontmatter; el título de la línea "# …" y los puntajes de "**Puntajes:** Claridad 6 · Escucha 7 · …".
Solo usa la biblioteca estándar de Python. Es un punto de partida: cópialo y adáptalo (gráficos en tu planilla, un tablero…).
"""
import csv
import json
import os
import re
import sys

APARTADOS = ["claridad", "escucha", "preguntas", "cierre"]
COLUMNAS = ["fecha", "hora", "tipo", "titulo", "duracion_min", "habla_yo_pct", "participantes"] + APARTADOS + ["archivo"]


def frontmatter(texto):
    if not texto.startswith("---\n"):
        return {}
    datos = {}
    for linea in texto[4:].split("\n---", 1)[0].splitlines():
        clave, _, valor = linea.partition(":")
        if valor:
            datos[clave.strip()] = valor.strip()
    return datos


def participantes(valor):
    try:
        lista = json.loads(valor or "[]")
    except ValueError:
        return valor or ""
    return "; ".join(str(n) for n in lista) if isinstance(lista, list) else str(lista)


def reuniones(carpeta):
    for nombre in sorted(os.listdir(carpeta)):
        if not nombre.endswith(".md"):
            continue
        with open(os.path.join(carpeta, nombre), encoding="utf-8") as f:
            texto = f.read()
        datos = frontmatter(texto)
        if not datos.get("fecha"):
            continue  # no es una nota de Minuta
        fila = {c: datos.get(c, "") for c in COLUMNAS}
        fila["titulo"] = next((l[2:].strip() for l in texto.splitlines() if l.startswith("# ")), nombre[:-3])
        fila["participantes"] = participantes(datos.get("participantes"))
        fila["archivo"] = nombre
        puntajes = re.search(r"\*\*Puntajes:\*\*(.*)", texto)
        if puntajes:
            for apartado, valor in re.findall(r"(\w+)\s+(\d+(?:[.,]\d+)?)", puntajes[1]):
                if apartado.lower() in APARTADOS:
                    fila[apartado.lower()] = valor
        yield fila


def main():
    args = sys.argv[1:]
    if not args or args[0].startswith("-"):
        sys.exit(__doc__)
    carpeta = os.path.expanduser(args[0])
    tipo = args[args.index("--tipo") + 1].lower() if "--tipo" in args else ""
    lista = [r for r in reuniones(carpeta) if not tipo or r["tipo"].lower() == tipo]
    lista.sort(key=lambda r: (r["fecha"], r["hora"]))
    w = csv.DictWriter(sys.stdout, fieldnames=COLUMNAS)
    w.writeheader()
    w.writerows(lista)
    print(f"{len(lista)} reuniones", file=sys.stderr)


if __name__ == "__main__":
    main()
