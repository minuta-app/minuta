#!/usr/bin/env python3
"""Redacta con Claude el mensaje de resumen que el usuario enviará a OTRAS personas.

Uso: redactar.py <nota.md> <indicaciones.txt> <salida.json>  →  {"texto": "...", "asunto": "..."}
     redactar.py --guardar <nota.md>   (al terminar una reunión, en segundo plano: lo deja listo en ~/minuta/mensajes/)
El mensaje queda guardado en ~/minuta/mensajes/<nota>.json y solo se vuelve a redactar si el usuario lo pide.
Las notas de Minuta están escritas PARA el usuario (feedback, opiniones, perfiles de personas, reacciones):
aquí solo se le pasa a Claude la parte de notas, y se le prohíbe incluir cualquier cosa interna.
"""
import json
import os
import re
import subprocess
import sys
import time

from perfil import NOMBRE, QUIEN, IDIOMA, CLAUDE

HOME = os.path.expanduser("~")


def solo_notas(texto):
    """Quita frontmatter, feedback, personas, métricas y transcripción: nada de eso debe salir de Minuta."""
    if texto.startswith("---\n"):
        fin = texto.find("\n---\n", 4)
        if fin > 0:
            texto = texto[fin + 5:]
    corte = re.search(r"\n## (Personas|Feedback para|Métricas|Transcripción)", texto)
    return texto[:corte.start()] if corte else texto


MENSAJES = os.path.join(HOME, "minuta", "mensajes")


def guardado(nota):
    return os.path.join(MENSAJES, os.path.basename(nota)[:-3] + ".json")


def redactar(nota, extra=""):
    notas = solo_notas(open(nota, encoding="utf-8").read())[:8000]
    prompt = f"""Redacta el mensaje de resumen que {QUIEN} enviará a los participantes de una reunión.
Abajo van SUS notas privadas: están escritas para él y pueden traer comentarios internos. Tu trabajo es convertirlas en un mensaje
apropiado para enviar a OTRAS personas.

NUNCA incluyas (aunque aparezca en las notas):
- Opiniones, juicios o descripciones de cómo se comportó alguien ("se notó molesto", "no tenía claro", "fue evasivo").
- Reacciones o frases textuales de {NOMBRE} ("Reacción de {NOMBRE}: …", "Qué raro"), ni comentarios sobre su desempeño o consejos para él.
- Especulaciones, rumores, críticas a personas, equipos o proveedores, ni temas sensibles o internos que no corresponda compartir.
- Menciones a grabaciones, transcripciones, IA, Minuta o "según mis notas".
- Datos que no estén en las notas. Si algo es ambiguo o delicado, omítelo.

SÍ incluye, en tono profesional y cercano ({IDIOMA}), breve (máx. ~170 palabras) y fácil de escanear:
saludo, una frase de contexto, "Acuerdos" (solo decisiones), "Próximos pasos" (responsable — qué — fecha si se dijo) y, si aplica,
"Quedó pendiente" redactado de forma neutral. Escribe en primera persona como {NOMBRE} (sus tareas van como "Yo — …", nunca "{NOMBRE} — …"). Nunca uses etiquetas como "Persona 1" o "Hablante 2": si no sabes el nombre del responsable, redacta la tarea sin responsable. Cierre corto firmado "{NOMBRE}". Viñetas con "• ". Sin markdown ni negritas.
{f"Indicaciones de {NOMBRE} para este mensaje: {extra}" if extra else ""}

Devuelve SOLO JSON: {{"asunto": "<asunto corto y claro>", "texto": "<cuerpo del mensaje>"}}

NOTAS PRIVADAS DE {NOMBRE.upper()}:
{notas}"""
    r = subprocess.run([CLAUDE, "-p", "--output-format", "text"], input=prompt, text=True, capture_output=True, timeout=300,
                       cwd=os.path.join(HOME, "minuta"))
    s = r.stdout.strip()
    if r.returncode != 0 or not s:
        raise SystemExit(f"claude -p falló: {r.stderr.strip()[:300]}")
    i, j = s.find("{"), s.rfind("}")
    try:
        d = json.loads(s[i:j + 1], strict=False)
    except Exception:
        d = {"texto": s, "asunto": ""}
    r = {"texto": str(d.get("texto", "")).strip(), "asunto": str(d.get("asunto", "")).strip()}
    if not r["texto"]:
        raise SystemExit("Claude devolvió un mensaje vacío")
    r["fecha"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    os.makedirs(MENSAJES, exist_ok=True)
    tmp = guardado(nota) + ".tmp"
    json.dump(r, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    os.replace(tmp, guardado(nota))
    return r


def main():
    if sys.argv[1] == "--guardar":  # tras procesar una reunión: una sola vez
        nota = sys.argv[2]
        if os.path.exists(guardado(nota)):
            return
        os.makedirs(MENSAJES, exist_ok=True)
        marca = guardado(nota) + ".redactando"
        open(marca, "w").close()
        try:
            redactar(nota)
        finally:
            os.path.exists(marca) and os.remove(marca)
        return
    nota, indicaciones, salida = sys.argv[1], sys.argv[2], sys.argv[3]
    pedido = open(indicaciones, encoding="utf-8").read().strip() if os.path.exists(indicaciones) else ""
    try:
        pedido = json.loads(pedido)
    except Exception:
        pedido = {"indicaciones": pedido}
    extra = str(pedido.get("indicaciones") or "").strip()
    forzar = bool(extra or pedido.get("forzar"))
    marca = guardado(nota) + ".redactando"
    # Si se está redactando en segundo plano (reunión recién terminada), espera ese en vez de pedir otro.
    while not forzar and os.path.exists(marca) and time.time() - os.path.getmtime(marca) < 360 and not os.path.exists(guardado(nota)):
        time.sleep(1.5)
    r = json.load(open(guardado(nota), encoding="utf-8")) if not forzar and os.path.exists(guardado(nota)) else redactar(nota, extra)
    json.dump(r, open(salida, "w", encoding="utf-8"), ensure_ascii=False)


if __name__ == "__main__":
    main()
