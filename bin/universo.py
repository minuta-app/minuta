#!/usr/bin/env python3
"""Crea un universo nuevo para Minuta con Claude (claude -p, plan Max).

Uso: universo.py "<nombre de la saga>" ["<indicaciones opcionales>"]
Escribe ~/minuta/temas/<id>.json y agrega su estilo a ~/minuta/temas/_estilos.json.
Imprime en la última línea: OK <id> <nombre>  ó  ERROR <mensaje>.
"""
import json
import os
import re
import subprocess
import sys
import unicodedata

from perfil import NOMBRE, QUIEN, IDIOMA, HUMOR, RECURSOS, CLAUDE

HOME = os.path.expanduser("~")
BASE = os.path.join(HOME, "minuta")
TEMAS = os.path.join(BASE, "temas")

APARTADOS = ["claridad", "escucha", "preguntas", "cierre"]
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
FUENTES = ["Avenir Next", "Avenir Next Condensed", "Futura", "Didot", "Copperplate", "Herculanum", "Papyrus", "Marker Felt", "Chalkboard SE",
           "Noteworthy", "Optima", "Gill Sans", "Baskerville", "Georgia", "American Typewriter", "Rockwell", "Impact", "Trattatello",
           "Luminari", "Bradley Hand", "Phosphate", "Chalkduster", "Menlo", "ui-rounded"]
PATRONES = ["estrellas", "pergamino", "runas", "comic", "velocidad", "ki", "nubes", "hielo", "pantano", "olas", "film", "mapa"]
KITS = {
    "consola": "chaflanes asimétricos y resplandor (ciencia ficción, tecnología, espacio)",
    "comic": "rectángulo con tinta negra gruesa y sombra dura (cómics, superhéroes, pop)",
    "pergamino": "papel con bordes rasgados y quemados (fantasía medieval, mapas, aventura antigua)",
    "redondo": "curvas grandes con contorno negro grueso (dibujos animados, comedia)",
    "deco": "esquinas escalonadas art déco con marquesina de ampolletas (cine clásico, glamour, años 20-50, casinos)",
    "metal": "marco de hierro forjado con remaches (guerra, épica oscura, industrial, western)",
    "neon": "cortes diagonales con luz de neón (carreras, cyberpunk, años 80, música electrónica)",
    "madera": "cartel de madera hecho a mano, chueco (cuentos, granja, bosque, humor rústico)",
    "plastico": "juguete de plástico brillante de colores (infantil, videojuegos retro, juguetes)",
}


def slug(texto):
    t = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", t)[:24] or "universo"


def ejemplo():
    # El ejemplo sale del universo incluido con la app (con su estilo dentro).
    with open(os.path.join(RECURSOS, "universos", "starwars.json"), encoding="utf-8") as f:
        t = json.load(f)
    e = dict(t.get("estilo") or {})
    corto = {
        "nombre": t["nombre"], "emoji": t["emoji"], "xp": t["xp"], "personaje_por_defecto": t["personaje_por_defecto"],
        "elogios": t["elogios"],
        "apartados": {k: t["apartados"][k][:2] + ["… (10 en total, del peor al mejor)"] for k in APARTADOS[:1]},
        "rangos": t["rangos"][:2] + ["… (10 en total)"],
        "logros": dict(list(t["logros"].items())[:2]),
        "iconos_apartados": t["iconos_apartados"], "iconos_rangos": t["iconos_rangos"],
        "iconos_logros": dict(list(t["iconos_logros"].items())[:2]),
        "estilo": {**e, "kit": "consola", "ventana": {"titulo": "Terminal de misión", "derecha": "COM-LINK ESTABLE",
                   "grabar": "Iniciar transmisión", "parar": "Cortar transmisión", "procesando": "Descifrando la transmisión…"}},
    }
    return json.dumps(corto, ensure_ascii=False, indent=1)


def prompt(nombre, notas, error_previo=""):
    logros = "\n".join(f"- {k}: {v}" for k, v in LOGROS.items())
    kits = "\n".join(f"- {k}: {v}" for k, v in KITS.items())
    return f"""Eres el director creativo de "Minuta", una app personal de notas de reuniones que da feedback de comunicación a
{QUIEN} y lo gamifica con universos de películas y series. Crea el universo: «{nombre}».
{f"Indicaciones de {NOMBRE}: {notas}" if notas else ""}

Métete en la cabeza de los creadores: personajes, momentos y frases icónicas reales del universo, con humor y cariño; nada genérico.
Todo en {IDIOMA} ({HUMOR} y suave). Usa SOLO personajes y obras reales de ese universo.

Devuelve SOLO un objeto JSON válido (sin markdown, sin comentarios) con exactamente estas claves:
- "nombre": nombre corto del universo; "emoji": 1 emoji; "xp": nombre gracioso de los puntos de experiencia (ej. "midiclorianos").
- "personaje_por_defecto": regla corta de qué personajes valen (ej. "Solo personajes canónicos de las películas de …").
- "elogios": 4 frases cortas, de la mejor reunión a la peor, en la voz del universo.
- "apartados": objeto con "claridad", "escucha", "preguntas", "cierre"; cada uno una lista de EXACTAMENTE 10 arquetipos
  ordenados del PEOR (nivel 0) al MEJOR (nivel 9). Cada arquetipo: {{"nombre": personaje, "referencia": obra/episodio/película, "frase": una línea con humor que conecte al personaje con esa habilidad de comunicación}}.
  Usa 40 personajes distintos si el universo da; si no, repite pocos.
- "rangos": EXACTAMENTE 10 rangos de progreso del más bajo al más alto: {{"nombre", "frase"}}.
- "logros": objeto con EXACTAMENTE estas 24 claves; para cada una {{"nombre": título ingenioso del universo, "descripcion": explica el criterio con la misma claridad}}:
{logros}
- "iconos_logros": objeto con las mismas 24 claves → 1 emoji cada una. "iconos_apartados": {{"claridad","escucha","preguntas","cierre"}} → 1 emoji. "iconos_rangos": lista de 10 emojis.
- "estilo": {{
    "modo": "oscuro" o "claro"; colores en hex "#rrggbb" (panel y linea pueden ser rgba(...)): "fondo", "fondo2", "panel", "texto", "suave", "linea", "acento", "acento_texto", "acento2";
    con buen contraste (texto sobre fondo ≥ 7:1; acento_texto legible sobre fondo);
    "fuente": una de {json.dumps(FUENTES, ensure_ascii=False)}; "peso": 400-900; "mayusculas": bool; "cursiva": bool;
    "patron" (fondo animado): uno de {json.dumps(PATRONES)}; "radio": 0-18 (esquinas de tarjetas, 0 = recto);
    "kit" (forma de la ventana): uno de estos:
{kits}
    "textos": {{"reuniones", "ico_reuniones", "progreso", "ico_progreso", "logros", "ico_logros", "titulo_progreso", "buscar"}} (nombres de secciones en la voz del universo, íconos = 1 emoji, buscar = placeholder del buscador);
    "ventana": {{"titulo": subtítulo de la barra (2-4 palabras), "derecha": detalle corto a la derecha de la barra (≤ 22 caracteres),
                "grabar": texto del botón de grabar (≤ 26 caracteres), "parar": texto del botón de detener (≤ 22), "procesando": mensaje mientras se generan las notas (≤ 45)}}
  }}

Ejemplo abreviado (Star Wars) para el formato y el tono:
{ejemplo()}
{f"El intento anterior falló así, corrígelo: {error_previo}" if error_previo else ""}"""


def llamar_claude(texto):
    cmd = [CLAUDE, "-p", "--output-format", "text"]
    if os.environ.get("MINUTA_MODELO"):
        cmd += ["--model", os.environ["MINUTA_MODELO"]]
    r = subprocess.run(cmd, input=texto, text=True, capture_output=True, cwd=BASE, timeout=900)
    if r.returncode != 0 or not r.stdout.strip():
        raise RuntimeError(f"claude -p falló ({r.returncode}): {r.stderr.strip()[:300]}")
    salida = r.stdout.strip()
    i, j = salida.find("{"), salida.rfind("}")
    if i < 0 or j < 0:
        raise ValueError("Claude no devolvió un JSON")
    return json.loads(salida[i:j + 1])


HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def validar(u):
    for k in ["nombre", "emoji", "xp", "elogios", "apartados", "rangos", "logros", "estilo"]:
        if k not in u:
            raise ValueError(f"falta la clave '{k}'")
    for a in APARTADOS:
        lista = u["apartados"].get(a)
        if not isinstance(lista, list) or len(lista) != 10 or not all({"nombre", "referencia", "frase"} <= set(x) for x in lista):
            raise ValueError(f"'apartados.{a}' debe tener 10 arquetipos con nombre, referencia y frase")
    if len(u["rangos"]) != 10:
        raise ValueError("'rangos' debe tener 10 elementos")
    faltan = [k for k in LOGROS if k not in u["logros"]]
    if faltan:
        raise ValueError(f"faltan logros: {', '.join(faltan)}")
    e = u["estilo"]
    for k in ["fondo", "fondo2", "texto", "suave", "acento", "acento_texto", "acento2"]:
        if not HEX.match(str(e.get(k, ""))):
            raise ValueError(f"estilo.{k} debe ser un color #rrggbb")


def normalizar(u):
    e = u["estilo"]
    e["modo"] = "claro" if e.get("modo") == "claro" else "oscuro"
    e.setdefault("panel", "rgba(255,255,255,0.05)" if e["modo"] == "oscuro" else "rgba(255,255,255,0.75)")
    e.setdefault("linea", "rgba(127,127,127,0.25)")
    if e.get("fuente") not in FUENTES:
        e["fuente"] = "Avenir Next"
    if e.get("patron") not in PATRONES:
        e["patron"] = "estrellas" if e["modo"] == "oscuro" else "nubes"
    if e.get("kit") not in KITS:
        e["kit"] = "consola"
    e["radio"] = max(0, min(18, int(e.get("radio", 8))))
    e["peso"] = max(400, min(900, int(e.get("peso", 700))))
    e["mayusculas"] = bool(e.get("mayusculas"))
    e["cursiva"] = bool(e.get("cursiva"))
    e.setdefault("textos", {})
    e.setdefault("ventana", {})
    u["elogios"] = (list(u.get("elogios") or []) + ["¡Bien hecho!"] * 4)[:4]
    u["rangos"] = [{"nombre": str(r.get("nombre", "")), "frase": str(r.get("frase", ""))} for r in u["rangos"]][:10]
    u["logros"] = {k: {"nombre": str(u["logros"][k].get("nombre", k)), "descripcion": str(u["logros"][k].get("descripcion", LOGROS[k]))} for k in LOGROS}
    il = u.get("iconos_logros") or {}
    u["iconos_logros"] = {k: il.get(k) or "🏆" for k in LOGROS}
    ia = u.get("iconos_apartados") or {}
    u["iconos_apartados"] = {k: ia.get(k) or "⭐" for k in APARTADOS}
    ir = list(u.get("iconos_rangos") or [])
    u["iconos_rangos"] = (ir + ["⭐"] * 10)[:10]
    return u


def main():
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        print("ERROR falta el nombre del universo")
        sys.exit(1)
    nombre, notas = sys.argv[1].strip(), (sys.argv[2].strip() if len(sys.argv) > 2 else "")
    error = ""
    for intento in range(2):
        try:
            u = llamar_claude(prompt(nombre, notas, error))
            validar(u)
            u = normalizar(u)
            break
        except Exception as ex:  # noqa: BLE001
            error = str(ex)
            print(f"intento {intento + 1}: {error}", file=sys.stderr)
    else:
        print(f"ERROR {error}")
        sys.exit(1)

    base_id = slug(u["nombre"] or nombre)
    existentes = {f[:-5] for d in (TEMAS, os.path.join(RECURSOS, "universos")) if os.path.isdir(d) for f in os.listdir(d) if f.endswith(".json")}
    uid, n = base_id, 2
    while uid in existentes:
        uid, n = f"{base_id}{n}", n + 1
    # El estilo va dentro del mismo archivo (formato del catálogo). "pedido" e "indicaciones" quedan solo en tu Mac.
    tema = {"id": uid, "creado": True, "pedido": nombre, **({"indicaciones": notas} if notas else {}), **u}
    os.makedirs(TEMAS, exist_ok=True)
    with open(os.path.join(TEMAS, f"{uid}.json"), "w", encoding="utf-8") as f:
        json.dump(tema, f, ensure_ascii=False, indent=1)
    print(f"OK {uid} {u['nombre']}")


if __name__ == "__main__":
    main()
