#!/usr/bin/env python3
"""Minuta: resumen semanal de feedback. Junta las métricas y el feedback de los últimos 7 días
y le pide a Claude una evaluación de tendencias. Escribe Reuniones/Semanal/<año>-S<nn>.md"""
import datetime as dt
import json
import os
import re
import subprocess

from perfil import QUIEN, IDIOMA, CARPETA_NOTAS

HOME = os.path.expanduser("~")
BASE = os.path.join(HOME, "minuta")
HISTORIAL = os.path.join(BASE, "historial.jsonl")
SALIDA = os.path.join(CARPETA_NOTAS, "Semanal")
os.environ["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + os.environ.get("PATH", "")


def feedback_de(ruta):
    try:
        with open(ruta, encoding="utf-8") as f:
            texto = f.read()
    except OSError:
        return ""
    m = re.search(r"## Feedback para[^\n]*\n(.*?)(?=\n## )", texto, re.S)
    return m.group(1).strip() if m else ""


def main():
    hoy = dt.datetime.now()
    desde = hoy - dt.timedelta(days=7)
    reuniones = []
    if os.path.exists(HISTORIAL):
        with open(HISTORIAL, encoding="utf-8") as f:
            for linea in f:
                r = json.loads(linea)
                if dt.datetime.fromisoformat(r["fecha"]) >= desde:
                    reuniones.append(r)
    if not reuniones:
        raise SystemExit("No hay reuniones en los últimos 7 días.")

    bloques = []
    for r in reuniones:
        metricas = {k: r[k] for k in ("duracion_min", "habla_yo_pct", "palabras_por_min_yo", "monologo_max_seg",
                                      "preguntas_yo", "interrupciones_yo", "muletillas") if k in r}
        bloques.append(f"### {r['fecha'][:16]} · {r.get('tipo')} · {r['titulo']}\nMétricas: "
                       f"{json.dumps(metricas, ensure_ascii=False)}\nFeedback:\n{feedback_de(r['nota'])}")

    prompt = f"""Eres el coach de comunicación de {QUIEN}.
Abajo están sus reuniones de los últimos 7 días con métricas medidas y el feedback de cada una.
Escribe en {IDIOMA}, en markdown, con esta estructura:

## La semana en números
<tabla corta: reuniones, horas totales, % de habla promedio, preguntas promedio, interrupciones totales>

## Patrones que se repiten
- <2 a 4 patrones (buenos o malos) que aparecen en varias reuniones, con ejemplos>

## Comparación por tipo de reunión
<compara los tipos de reunión entre sí, si aplica>

## Foco para la próxima semana
<UN solo hábito, concreto y medible, y cómo saber si lo logró>

REUNIONES:
{chr(10).join(bloques)}
"""
    r = subprocess.run(["claude", "-p", "--output-format", "text"], input=prompt, text=True,
                       capture_output=True, cwd=BASE, timeout=900)
    if r.returncode != 0 or not r.stdout.strip():
        raise SystemExit(f"claude -p falló: {r.stderr[:500]}")

    os.makedirs(SALIDA, exist_ok=True)
    anio, semana, _ = hoy.isocalendar()
    ruta = os.path.join(SALIDA, f"{anio}-S{semana:02d}.md")
    enlaces = "\n".join(f"- [[{os.path.splitext(os.path.basename(x['nota']))[0]}]]" for x in reuniones)
    with open(ruta, "w", encoding="utf-8") as f:
        f.write(f"---\nsemana: {anio}-S{semana:02d}\ngenerado: {hoy:%Y-%m-%d %H:%M}\ntags: [minuta, feedback-semanal]\n---\n"
                f"# Feedback semanal {anio}-S{semana:02d}\n\n{r.stdout.strip()}\n\n## Reuniones de la semana\n{enlaces}\n")
    with open(os.path.join(BASE, "ultimo-semanal.txt"), "w", encoding="utf-8") as f:
        f.write(ruta)
    print("Listo:", ruta)


if __name__ == "__main__":
    main()
