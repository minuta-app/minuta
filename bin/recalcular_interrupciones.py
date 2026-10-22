#!/usr/bin/env python3
"""Recalcula las interrupciones de reuniones ya procesadas con la definición nueva (procesar.interrupciones_de).

Uso: recalcular_interrupciones.py [--aplicar]
Sin --aplicar solo muestra antes → después. Con --aplicar actualiza el frontmatter, la tabla de Métricas
y agrega la lista "Dónde cortaste a alguien" en cada nota.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import procesar as P  # noqa: E402


def segmentos(carpeta, archivo, quien, meta, audio):
    js = os.path.join(carpeta, archivo + ".json")
    if not os.path.exists(js):
        return []
    datos = json.load(open(js, encoding="utf-8"))
    segs = []
    for s in datos.get("transcription", []):
        texto = P.corregir(s.get("text", "").strip())
        if texto:
            segs.append({"ini": s["offsets"]["from"] / 1000, "fin": s["offsets"]["to"] / 1000, "texto": texto})
    muestras = None
    caf = os.path.join(carpeta, archivo + ".caf")
    if os.path.exists(caf) and os.path.getsize(caf) > 10000:
        with tempfile.TemporaryDirectory() as tmp:
            wav = os.path.join(tmp, "a.wav")
            P.a_wav(caf, wav)
            muestras = P.leer_muestras(wav)
    segs = P.limpiar(segs, muestras, quien)
    if quien == "Ellos":
        hj = os.path.join(carpeta, "hablantes.json")
        if os.path.exists(hj):
            segs = P.asignar_hablantes(segs, json.load(open(hj, encoding="utf-8")))
    primer = meta.get(f"{archivo}_primer_buffer") or meta["inicio"]
    desfase = max(0.0, primer - meta["inicio"])
    for s in segs:
        s["ini"] += desfase
        s["fin"] += desfase
    if muestras is not None:
        audio[archivo] = (muestras, desfase)
    return segs


def nombres_desde_nota(carpeta, texto_nota):
    """'Persona N' → nombre que le puso Claude, alineando la transcripción cruda con la de la nota."""
    txt = os.path.join(carpeta, "transcripcion.txt")
    if not os.path.exists(txt):
        return {}
    crudo = {m[0]: m[1] for m in re.findall(r"^\[(\d\d:\d\d:\d\d)\] ([^:]+):", open(txt, encoding="utf-8").read(), re.M)}
    nota = {m[0]: m[1] for m in re.findall(r"^> \[(\d\d:\d\d:\d\d)\] ([^:]+):", texto_nota, re.M)}
    mapa = {}
    for t, q in crudo.items():
        if q.startswith("Persona") and t in nota and nota[t] != q:
            mapa[q] = nota[t]
    return mapa


def main():
    aplicar = "--aplicar" in sys.argv
    raiz = os.path.join(P.BASE, "grabaciones")
    for d in sorted(os.listdir(raiz)):
        carpeta = os.path.join(raiz, d)
        nota_txt = os.path.join(carpeta, "nota.txt")
        if not os.path.exists(nota_txt) or not os.path.exists(os.path.join(carpeta, "meta.json")):
            continue
        ruta = open(nota_txt, encoding="utf-8").read().strip()
        if not os.path.exists(ruta):
            continue
        meta = json.load(open(os.path.join(carpeta, "meta.json"), encoding="utf-8"))
        audio = {}
        yo = segmentos(carpeta, "yo", "Yo", meta, audio)
        ellos = segmentos(carpeta, "ellos", "Ellos", meta, audio)
        if not yo:
            continue
        yo = P.quitar_eco(yo, ellos)
        texto = open(ruta, encoding="utf-8").read()
        antes = re.search(r"^interrupciones_yo:\s*(\d+)", texto, re.M)
        cortes = P.interrupciones_de(yo, ellos, audio)
        mapa = nombres_desde_nota(carpeta, texto)
        for c in cortes:
            c["a"] = mapa.get(c["a"], c["a"])
        cortes = [c for c in cortes if not P.es_yo(c["a"])]
        print(f"{os.path.basename(ruta)[:70]:70}  {antes.group(1) if antes else '?':>4} → {len(cortes)}{'' if len(audio) == 2 else '  (sin audio)'}")
        if "--detalle" in sys.argv:
            for c in cortes:
                print(f"     [{c['t']}] a {c['a']}: «{c['cita']}»")
        if not aplicar:
            continue
        nuevo = re.sub(r"^interrupciones_yo:.*$", f"interrupciones_yo: {len(cortes)}", texto, count=1, flags=re.M)
        nuevo = re.sub(r"^\| Veces que (entraste mientras otro hablaba|cortaste a alguien) \|.*$",
                       f"| Veces que cortaste a alguien | {len(cortes)} |", nuevo, count=1, flags=re.M)
        nuevo = re.sub(r"\n\n> \[!info\]- Dónde cortaste a alguien\n(?:>.*\n?)*", "\n", nuevo)
        bloque = P.detalle_interrupciones({"interrupciones_detalle": cortes})
        if bloque and "\n\n## Transcripción" in nuevo:
            i = nuevo.index("\n\n## Transcripción")
            nuevo = nuevo[:i].rstrip("\n") + bloque + nuevo[i:]
        if nuevo != texto:
            open(ruta, "w", encoding="utf-8").write(nuevo)


if __name__ == "__main__":
    main()
