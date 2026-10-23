#!/usr/bin/env python3
"""Pone nombre e ícono propio, en la voz de cada universo, a los logros que aún no lo tienen.

Uso: logros.py [id_universo ...]   (sin argumentos: todos los universos)
Usa claude -p (plan Max). Solo agrega lo que falta; no toca nombres existentes.
"""
import json
import os
import subprocess
import sys

HOME = os.path.expanduser("~")
TEMAS = os.path.join(HOME, "minuta", "temas")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from perfil import ejecutar_ia, NOMBRE_IA  # noqa: E402

LOGROS = {
    "primera_reunion": "Completaste tu primera reunión.",
    "reuniones_10": "Completaste 10 reuniones.",
    "reuniones_50": "Completaste 50 reuniones.",
    "habito_1": "Cumpliste por primera vez el hábito que te dejó Minuta.",
    "habito_racha_3": "Cumpliste tu hábito 3 reuniones seguidas.",
    "habito_10": "Cumpliste 10 hábitos en total.",
    "cierre_racha_3": "3 reuniones seguidas con cierre de 8 o más.",
    "muletillas_racha_3": "3 reuniones seguidas con menos de 3 muletillas cada 10 minutos.",
    "habla_racha_5": "5 reuniones seguidas con tu tiempo de habla en rango.",
    "monologo_racha_5": "5 reuniones seguidas sin hablar más de 60 segundos de corrido.",
    "preguntas_racha_3": "3 reuniones seguidas con al menos 1 pregunta cada 10 minutos.",
    "cero_interrupciones_5": "5 reuniones seguidas sin interrumpir a nadie.",
    "preguntas_10_en_una": "Hiciste 10 o más preguntas en una sola reunión.",
    "escucha_activa": "Hablaste 35% o menos en una reunión de 15+ minutos.",
    "sin_muletillas": "Reunión de 15+ minutos sin ninguna muletilla.",
    "express": "Reunión de 15 minutos o menos con cierre de 8 o más.",
    "todo_verde": "Una reunión con todas tus métricas de cómo hablaste en rango.",
    "equilibrio": "Los 4 apartados en 8 o más en una misma reunión.",
    "reunion_9": "Promedio de 9 o más en una reunión.",
    "puntaje_perfecto": "Sacaste un 10 en algún apartado.",
    "remontada": "Después de una reunión bajo 6, la siguiente sobre 8.",
    "mejora_cierre": "Tu cierre promedio subió 2+ puntos vs. tus 5 reuniones anteriores.",
    "mejora_debil": "Tu apartado más débil subió 2+ puntos en promedio en las siguientes 5 reuniones.",
    "semana_8": "Una semana con 3+ reuniones y promedio de 8 o más.",
}


def completar(ruta):
    with open(ruta, encoding="utf-8") as f:
        t = json.load(f)
    faltan = [k for k in LOGROS if k not in t.get("logros", {})]
    if not faltan:
        return f"{t['id']}: nada que agregar"
    ejemplos = {k: v["nombre"] for k, v in list(t.get("logros", {}).items())[:6]}
    pedido = "\n".join(f"- {k}: {LOGROS[k]}" for k in faltan)
    prompt = f"""Universo: «{t['nombre']}». Regla de personajes: {t.get('personaje_por_defecto', '')}.
Ejemplos de nombres de logros ya existentes en este universo (mismo tono): {json.dumps(ejemplos, ensure_ascii=False)}

Inventa un nombre ingenioso y corto (máx. 5 palabras), en español, con referencias reales de este universo, para cada logro.
La descripción debe explicar el criterio con la misma claridad (puedes darle un toque del universo, sin cambiar el criterio).
Elige 1 emoji por logro. Devuelve SOLO un objeto JSON: {{"<id>": {{"nombre": "...", "descripcion": "...", "icono": "..."}}}}
Logros:
{pedido}"""
    r = ejecutar_ia(prompt, timeout=600)
    salida = r.stdout.strip()
    i, j = salida.find("{"), salida.rfind("}")
    if r.returncode != 0 or i < 0:
        return f"{t['id']}: ERROR {r.stderr.strip()[:200]}"
    nuevos = json.loads(salida[i:j + 1])
    t.setdefault("logros", {})
    t.setdefault("iconos_logros", {})
    agregados = 0
    for k in faltan:
        d = nuevos.get(k)
        if not isinstance(d, dict) or not d.get("nombre"):
            continue
        t["logros"][k] = {"nombre": str(d["nombre"]), "descripcion": str(d.get("descripcion") or LOGROS[k])}
        if d.get("icono"):
            t["iconos_logros"][k] = str(d["icono"])
        agregados += 1
    tmp = ruta + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(t, f, ensure_ascii=False, indent=1)
    os.replace(tmp, ruta)
    return f"{t['id']}: {agregados}/{len(faltan)} logros nuevos"


def main():
    ids = sys.argv[1:]
    archivos = sorted(f for f in os.listdir(TEMAS) if f.endswith(".json") and not f.startswith("_"))
    for f in archivos:
        if ids and f[:-5] not in ids:
            continue
        try:
            print(completar(os.path.join(TEMAS, f)), flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"{f}: ERROR {e}", flush=True)


if __name__ == "__main__":
    main()
