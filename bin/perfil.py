"""Perfil del usuario de Minuta (~/minuta/perfil.json). Todo lo personal vive aquí, no en el código.

Ejemplo de perfil.json (ver perfil.ejemplo.json en la raíz del repo):
{
  "nombre": "Ana",
  "nombre_completo": "Ana Pérez",
  "descripcion": "Product Manager en una startup",
  "pais": "Chile",
  "gentilicio": "chilena",
  "idioma": "español de Chile",
  "carpeta_notas": "~/Documents/Minuta/Reuniones",
  "idioma_audio": "es",
  "idioma_ui": "es"
}
"""
import json
import os
import re
import subprocess

import ia  # pieza «ia» (Pieza): la IA de la persona
import nucleo  # pieza «nucleo» (Pieza): app.json y dónde está el código de la app

HOME = os.path.expanduser("~")
BASE = os.path.join(HOME, "minuta")
ARCHIVO = os.path.join(BASE, "perfil.json")
#: Código de la app (bin/, ui/, universos/): dentro de Minuta.app o el checkout de desarrollo. Es la carpeta del app.json que
#: está junto a bin/ (nucleo.recursos); MINUTA_RECURSOS solo vale si el script vive fuera de ella. Los datos NO son de la pieza:
#: viven en ~/minuta (BASE), como siempre.
RECURSOS = nucleo.recursos()

POR_DEFECTO = {
    "nombre": "",
    "nombre_completo": "",
    "descripcion": "",
    "pais": "",
    "gentilicio": "",
    "idioma": "español",
    "carpeta_notas": "~/Documents/Minuta/Reuniones",
    "idioma_audio": "auto",   # idioma que se habla en las reuniones (código Whisper: es, en, pt… o auto)
    "idioma_ui": "es",        # idioma de la interfaz
}


def cargar():
    datos = dict(POR_DEFECTO)
    try:
        with open(ARCHIVO, encoding="utf-8") as f:
            datos.update({k: v for k, v in json.load(f).items() if v is not None})
    except Exception:
        pass
    return datos


P = cargar()
#: Cómo se le nombra en los prompts ("Ana" o, si no lo configuró, "el usuario").
NOMBRE = P["nombre"].strip() or "el usuario"
#: Para el título de la sección de feedback: "Feedback para Ana" / "Feedback para ti".
NOMBRE_FB = P["nombre"].strip() or "ti"
#: Presentación con rol: "Ana (Product Manager en una startup)".
QUIEN = f"{NOMBRE} ({P['descripcion'].strip()})" if P["descripcion"].strip() else NOMBRE
IDIOMA = P["idioma"].strip() or "español"
PAIS = P["pais"].strip()
#: "humor chileno sano" o "humor sano".
HUMOR = f"humor {P['gentilicio'].strip()} sano" if P["gentilicio"].strip() else "humor sano"
IDIOMA_AUDIO = (P.get("idioma_audio") or "auto").strip().lower() or "auto"
CARPETA_NOTAS = os.path.expanduser(P["carpeta_notas"].strip() or POR_DEFECTO["carpeta_notas"])


#: IA del usuario, con su propia cuenta: "claude" (Claude Code), "codex" (ChatGPT) o "gemini" (Antigravity CLI `agy` o el
#: Gemini CLI antiguo). Cómo se corre cada una es de la pieza «ia» (bin/ia.py, de Pieza): sin herramientas ni MCP, sin la
#: memoria de la persona, siempre en una carpeta temporal, sin las variables MINUTA_* y el pedido nunca como argumento.
#: Aquí queda lo propio de Minuta: la IA elegida vive en perfil.json (no en la config de la pieza) y se le pasa siempre.
IAS = ia.IAS
IA = (P.get("ia") or "claude").strip().lower()
if IA not in IAS:
    IA = "claude"
NOMBRE_IA = ia.nombre(IA)
#: Ruta del CLI elegido (se mantiene el nombre CLAUDE por compatibilidad con scripts antiguos).
CLAUDE = ia.comando(IA) or IAS[IA][0][0]
ES_AGY = ia._es_agy(CLAUDE)
#: Si el CLI no conoce una protección, no se corre sin ella: se responde este error (código 3).
IA_DESACTUALIZADA = "Actualiza {ia} para usarla con Minuta: tu versión no permite correrla sin herramientas."


def _desactualizada(cmd):
    return subprocess.CompletedProcess(cmd, 3, "", IA_DESACTUALIZADA.replace("{ia}", ia.nombre(IA)))


def ejecutar_ia(prompt, timeout=600, cwd=None):
    """Le pasa el prompt a la IA del usuario (pieza «ia») y devuelve un CompletedProcess (stdout = respuesta en texto).
    Corre siempre en una carpeta temporal vacía (`cwd` se acepta por compatibilidad y se ignora). Si no está instalada sale
    FileNotFoundError, como antes. Con Claude, MINUTA_MODELO elige el modelo. Si el CLI no conoce una protección obligatoria
    (`--strict-mcp-config`, `--disallowedTools`), la pieza no lo corre (ia.VersionVieja) y aquí se responde el código 3 de siempre
    («Actualiza…»), que los scripts muestran tal cual: nunca se corre sin protecciones."""
    modelo = os.environ.get("MINUTA_MODELO") if IA == "claude" else None
    try:
        return ia.ejecutar(prompt, ia=IA, timeout=timeout, modelo=modelo)
    except ia.VersionVieja:
        return _desactualizada([CLAUDE])


def es_usuario(nombre):
    """¿Este nombre (de un responsable o hablante) es el propio usuario?"""
    n = (nombre or "").strip().lower()
    if not n:
        return False
    propios = {"yo", P["nombre"].strip().lower(), P["nombre_completo"].strip().lower()} - {""}
    return n in propios or any(n.startswith(p + " ") for p in propios if p != "yo")


_NO_NOMBRE = re.compile(r"^(\?+|yo|ellos|equipo|persona\s*\d+|desconocid\w*|no identificad\w*|sin identificar|varios|todos)$", re.I)


def limpiar_nombre(texto):
    """Deja solo el nombre de una persona: 'Christian (la separación de voces le atribuyó…)' → 'Christian'.
    Devuelve '' si no hay un nombre claro ('?', descripciones largas, 'Persona 2'…). La IA a veces agrega comentarios."""
    t = (texto or "").strip()
    base = t.split("(", 1)[0].strip() or re.sub(r"[()]", "", t)
    base = re.split(r"\s+[—–-]\s+|[,;:]|\s+/\s+", base, maxsplit=1)[0]
    base = re.sub(r"[\"“”«»]", "", base).strip(" \t'‘’.?¿!¡*_`")
    if not base or _NO_NOMBRE.match(base) or len(base) > 40 or len(base.split()) > 4 or re.search(r"\d", base):
        return ""
    return base


#: Datos sobre personas que el usuario corrigió ("Orlando es Scrum Master"): se usan en las próximas notas.
HECHOS = os.path.join(BASE, "personas_conocidas.json")


def hechos():
    try:
        with open(HECHOS, encoding="utf-8") as f:
            return [h for h in json.load(f) if isinstance(h, dict) and h.get("texto")]
    except (OSError, ValueError):
        return []


def agregar_hechos(nuevos):
    lista = hechos()
    vistos = {h["texto"].strip().lower() for h in lista}
    from datetime import date
    for t in nuevos:
        t = (t or "").strip().lstrip("-• ").strip()
        if t and t.lower() not in vistos:
            lista.append({"texto": t, "fecha": date.today().isoformat()})
            vistos.add(t.lower())
    with open(HECHOS, "w", encoding="utf-8") as f:
        json.dump(lista[-60:], f, ensure_ascii=False, indent=2)
