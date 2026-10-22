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

HOME = os.path.expanduser("~")
BASE = os.path.join(HOME, "minuta")
ARCHIVO = os.path.join(BASE, "perfil.json")
#: Código de la app (bin/, ui/, universos/): dentro de Minuta.app o el checkout de desarrollo.
RECURSOS = os.environ.get("MINUTA_RECURSOS") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

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


def es_usuario(nombre):
    """¿Este nombre (de un responsable o hablante) es el propio usuario?"""
    n = (nombre or "").strip().lower()
    if not n:
        return False
    propios = {"yo", P["nombre"].strip().lower(), P["nombre_completo"].strip().lower()} - {""}
    return n in propios or any(n.startswith(p + " ") for p in propios if p != "yo")
