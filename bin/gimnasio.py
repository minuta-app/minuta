#!/usr/bin/env python3
"""Gimnasio de Minuta: ensayo de reuniones con Claude haciendo de contraparte, y evaluación final.

Uso: gimnasio.py <turno|evaluar> <entrada.json> <salida.json>  (acción declarada «gimnasio» en app.json: la corre el host)
entrada: {modo, entrada: {escenario, dificultad, contexto, foco, historial: [{quien: "yo"|"otro", texto}]}}  (lo que manda la
         interfaz; también sirve el objeto de adentro solo)
salida:  {"ok": true, "datos": …} o {"ok": false, "error": "…"}, con datos:
turno   → {"nombre": "...", "texto": "..."}  (siguiente intervención de la contraparte)
evaluar → {"veredicto", "puntajes": {claridad, escucha, preguntas, cierre}, "costo": [{cita, texto, prueba}], "bien": [{cita, texto}], "habito"}
"""
import json
import os
import subprocess
import sys

from perfil import NOMBRE, QUIEN, IDIOMA, PAIS, ejecutar_ia, NOMBRE_IA

HOME = os.path.expanduser("~")

DIFICULTAD = {
    "amable": "Eres colaborativo y receptivo, aunque haces preguntas razonables.",
    "realista": "Eres como una persona real ocupada: tienes dudas, objeciones concretas y no regalas el sí.",
    "dificil": "Eres escéptico y exigente: interrumpes si te aburren, objetas el precio o el plazo, y solo cedes ante argumentos concretos.",
}


def claude(prompt):
    r = ejecutar_ia(prompt, timeout=300)
    if r.returncode != 0 or not r.stdout.strip():
        raise SystemExit(f"{NOMBRE_IA} falló: {r.stderr.strip()[:300]}")
    s = r.stdout.strip()
    i, j = s.find("{"), s.rfind("}")
    if i < 0:
        raise SystemExit("Claude no devolvió JSON")
    return json.loads(s[i:j + 1])


def historial_txt(h):
    return "\n".join(f"{NOMBRE.upper() if x['quien'] == 'yo' else 'TÚ'}: {x['texto']}" for x in h) or "(aún no habla nadie)"


def main():
    modo, entrada, salida = sys.argv[1], sys.argv[2], sys.argv[3]
    if modo not in ("turno", "evaluar"):
        raise SystemExit("modo desconocido")
    e = json.load(open(entrada, encoding="utf-8"))
    if isinstance(e, dict) and isinstance(e.get("entrada"), dict):
        e = e["entrada"]
    if not isinstance(e, dict):
        raise SystemExit("entrada rara")
    base = f"""ESCENARIO DEL ENSAYO: {e.get('escenario', '')}
CONTEXTO REAL (de reuniones anteriores de {NOMBRE}, úsalo para ser creíble): {e.get('contexto') or '(sin contexto)'}
"""
    if modo == "turno":
        prompt = f"""Estás en un ensayo de práctica para que {QUIEN} mejore cómo se comunica en reuniones.
Haces el papel de la CONTRAPARTE de la reunión (nunca de {NOMBRE}). {DIFICULTAD.get(e.get('dificultad'), DIFICULTAD['realista'])}
{base}
Reglas: habla como una persona real{(' de ' + PAIS) if PAIS else ''}, en {IDIOMA}, en 1 a 3 frases cortas (es oral, se va a leer en voz alta). Una sola intervención.
Si {NOMBRE} todavía no habló, abre tú la reunión de forma natural según el escenario. No des feedback ni salgas del personaje.
Si {NOMBRE} cerró bien la reunión (acuerdo, responsable y fecha), despídete brevemente.

CONVERSACIÓN HASTA AHORA:
{historial_txt(e.get('historial', []))}

Devuelve SOLO JSON: {{"nombre": "<nombre y rol corto de tu personaje, siempre el mismo>", "texto": "<tu intervención>"}}"""
    else:
        prompt = f"""Eres el coach de comunicación de {NOMBRE}. Evalúa SOLO las intervenciones de {NOMBRE.upper()} en este ensayo.
{base}
Su foco actual de mejora: {e.get('foco') or '(sin foco)'}

CONVERSACIÓN:
{historial_txt(e.get('historial', []))}

Sé exigente y concreto (10 excepcional, 7 correcto, 5 o menos problema claro). Cita textual de lo que escribió {NOMBRE}. Responde en {IDIOMA}.
Devuelve SOLO JSON:
{{"veredicto": "<una frase de máx. 18 palabras>",
  "puntajes": {{"claridad": n, "escucha": n, "preguntas": n, "cierre": n}},
  "costo": [{{"cita": "<texto exacto de {NOMBRE}>", "texto": "<qué faltó>", "prueba": "<frase concreta que pudo decir>"}}],
  "bien": [{{"cita": "<texto exacto de {NOMBRE}>", "texto": "<por qué funcionó>"}}],
  "habito": "<una acción concreta para la próxima, máx. 12 palabras>"}}
(costo: 1 a 3 elementos; bien: 1 o 2.)"""
    r = claude(prompt)
    with open(salida, "w", encoding="utf-8") as f:
        json.dump({"ok": True, "datos": r}, f, ensure_ascii=False)
    if modo == "evaluar":
        reg = {"fecha": __import__("datetime").datetime.now().isoformat(timespec="seconds"), "escenario": e.get("escenario", ""),
               "dificultad": e.get("dificultad", ""), "puntajes": r.get("puntajes", {}), "turnos": sum(1 for x in e.get("historial", []) if isinstance(x, dict) and x.get("quien") == "yo")}
        with open(os.path.join(HOME, "minuta", "practicas.jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps(reg, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    try:
        main()
    except SystemExit as fallo:
        # Un error que se puede contar (la IA no respondió, no devolvió JSON): va a la interfaz en vez de quedar en el registro.
        if len(sys.argv) == 4 and isinstance(fallo.code, str):
            with open(sys.argv[3], "w", encoding="utf-8") as f:
                json.dump({"ok": False, "error": fallo.code}, f, ensure_ascii=False)
        raise
