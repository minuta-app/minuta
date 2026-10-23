#!/usr/bin/env python3
"""Ordena los nombres de las personas en las notas ya guardadas (sin IA, sin cambiar el contenido).

Uso: limpiar_notas.py [--probar]

Antes, la IA a veces dejaba comentarios en los nombres ("Ana (la separación de voces le atribuyó…)") y la lista de
participantes se rompía en las comas. Esto deja solo el nombre en `participantes` (como lista JSON) y en quién habla
en la transcripción. Con --probar solo muestra lo que cambiaría. Guarda una copia de cada nota en ~/minuta/respaldos/.
"""
import json
import os
import sys
from datetime import datetime

from perfil import BASE, CARPETA_NOTAS, limpiar_nombre, es_usuario
from corregir import partes, leer_participantes, escribir_participantes, limpiar_etiquetas


def main():
    probar = "--probar" in sys.argv
    cambiadas = 0
    respaldos = os.path.join(BASE, "respaldos", f"antes de limpiar nombres {datetime.now():%Y-%m-%d %H%M%S}")
    for raiz, _, archivos in os.walk(CARPETA_NOTAS):
        if "/." in raiz:
            continue
        for a in sorted(archivos):
            if not a.endswith(".md"):
                continue
            ruta = os.path.join(raiz, a)
            with open(ruta, encoding="utf-8") as f:
                texto = f.read()
            fm, contenido, resto = partes(texto)
            if "participantes:" not in fm:
                continue
            antes = leer_participantes(fm)
            nombres, vistos = [], set()
            for p in antes:
                n = limpiar_nombre(p)
                if n and not es_usuario(n) and n.lower() not in vistos:
                    nombres.append(n)
                    vistos.add(n.lower())
            nuevo = escribir_participantes(fm, nombres) + contenido + "\n\n" + limpiar_etiquetas(resto).lstrip("\n")
            if nuevo.rstrip() == texto.rstrip():
                continue
            cambiadas += 1
            print(f"· {a}: {antes} → {nombres}")
            if probar:
                continue
            os.makedirs(respaldos, exist_ok=True)
            with open(os.path.join(respaldos, a), "w", encoding="utf-8") as f:
                f.write(texto)
            with open(ruta, "w", encoding="utf-8") as f:
                f.write(nuevo if nuevo.endswith("\n") else nuevo + "\n")
    print(f"{cambiadas} notas {'cambiarían' if probar else 'ordenadas'}." + (f" Copia en {respaldos}" if cambiadas and not probar else ""))


if __name__ == "__main__":
    main()
