# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
"""Pieza «núcleo»: lo que todo script de una app necesita. Solo biblioteca estándar (Mac, Windows y Linux).

La app se describe en `app.json` (en la raíz de los recursos de la app):

    {"nombre": "Esquema", "id": "esquema", "datos": "sistema",
     "config": {"idioma_ui": ["es", "en"], "ia": ["claude", "codex", "gemini"], "tema": ["sistema", "claro", "oscuro"]}}

- `id` da el prefijo de las variables de entorno (`ESQUEMA_DATOS`, `ESQUEMA_RECURSOS`) y de los temporales.
- `datos`: "sistema" (Application Support / %APPDATA% / ~/.config) o "visible" (~/<Nombre>/.<id>/).
- `config`: claves permitidas y sus valores. Una lista = valores posibles; "bool", "texto" o "numero" = tipo. Lo demás se descarta.

Contrato con los hosts (Swift, Electron, móvil): los datos de la persona llegan en un JSON de entrada, nunca como argumento; el último
argumento es siempre el JSON de salida. `script()` implementa ese contrato para cualquier script.
"""
import json
import os
import re
import sys
import tempfile

VERSION = "0.6.0"
MAXIMO_ENTRADA = 5 * 1024 * 1024
_app = None
_privadas = set()


def _id_de(carpeta):
    d = leer_json(os.path.join(carpeta, "app.json"), {})
    return d.get("id") if isinstance(d, dict) and isinstance(d.get("id"), str) else None


def recursos():
    """Carpeta raíz de la app (donde están app.json, bin/, ui/). Primero la de este archivo (subiendo hasta 4 niveles): así otra
    app no puede hacerse pasar por esta con su variable. Si el script vive fuera (desarrollo), vale <ID>_RECURSOS solo cuando el
    prefijo de la variable es el id de ese app.json."""
    aqui = os.path.dirname(os.path.abspath(__file__))
    for _ in range(4):
        if os.path.isfile(os.path.join(aqui, "app.json")):
            return aqui
        aqui = os.path.dirname(aqui)
    for clave, valor in sorted(os.environ.items()):
        if clave.endswith("_RECURSOS") and valor and _id_de(valor) and clave == _id_de(valor).upper() + "_RECURSOS":
            return valor
    raise RuntimeError("No encontré app.json: la app debe tener uno en su raíz (ver piezas/nucleo/README.md).")


def app():
    """La descripción de la app (app.json), validada una sola vez por proceso."""
    global _app
    if _app is None:
        d = leer_json(os.path.join(recursos(), "app.json"), {})
        if not (isinstance(d.get("id"), str) and re.fullmatch(r"[a-z][a-z0-9]{0,30}", d["id"])):
            raise RuntimeError("app.json: «id» debe ser minúsculas y letras/números (ej. «esquema»).")
        d.setdefault("nombre", d["id"].capitalize())
        d.setdefault("datos", "sistema")
        d.setdefault("config", {})
        _app = d
    return _app


def prefijo():
    return app()["id"].upper() + "_"


def entorno(nombre, defecto=None):
    return os.environ.get(prefijo() + nombre, defecto)


def carpeta_datos():
    """Dónde guarda la app su configuración y datos internos (nunca dentro de la carpeta de la persona)."""
    if entorno("DATOS"):
        return carpeta_privada(entorno("DATOS"))
    a, casa = app(), os.path.expanduser("~")
    if isinstance(a["datos"], dict):
        # {"carpeta": "~/minuta"}: una carpeta propia, que puede ser también el checkout de la app (Minuta). Se usa tal cual: sin
        # crearla ni cambiarle permisos (la app sabe cómo la cuida). Solo dentro de la casa de la persona.
        ruta = os.path.realpath(os.path.expanduser(str(a["datos"].get("carpeta", ""))))
        if not ruta.startswith(os.path.realpath(casa) + os.sep):
            raise RuntimeError("app.json: «datos.carpeta» tiene que estar dentro de la carpeta de la persona (~/…).")
        return ruta
    if a["datos"] == "visible":
        visible = entorno("CARPETA") or os.path.join(casa, a["nombre"])  # <ID>_CARPETA: mueve todo en las pruebas
        if not os.path.isdir(visible):
            carpeta_privada(visible)  # recién creada, también solo para la persona (una que ya existía no se toca)
        ruta = os.path.join(visible, "." + a["id"])
    elif sys.platform == "darwin":
        ruta = os.path.join(casa, "Library", "Application Support", a["nombre"])
    elif os.name == "nt":
        ruta = os.path.join(os.environ.get("APPDATA") or casa, a["nombre"])
    else:
        ruta = os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.join(casa, ".config"), a["id"])
    return carpeta_privada(ruta)


def carpeta_privada(ruta):
    """Crea la carpeta solo para la persona (0700). El chmod va una vez por proceso y no en Windows."""
    os.makedirs(ruta, exist_ok=True)
    if ruta not in _privadas and os.name != "nt":
        try:
            os.chmod(ruta, 0o700)
        except OSError:
            pass
        _privadas.add(ruta)
    return ruta


# ── Archivos ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def leer_json(ruta, defecto=None, maximo=None):
    try:
        if maximo and os.path.getsize(ruta) > maximo:
            return defecto
        with open(ruta, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return defecto


#: Permisos para escribir_atomico: lo interno de la app es privado (0600, lo de siempre); un DOCUMENTO de la persona (un .md
#: que ella abre con otros programas) se crea como cualquier archivo suyo.
PRIVADO, DOCUMENTO = 0o600, 0o644


def escribir_atomico(ruta, texto, modo=None):
    """Escribe sin dejar nunca un archivo a medias: temporal en la misma carpeta + reemplazo. Conserva los permisos de antes y no
    deja temporales huérfanos si algo falla. Un archivo nuevo queda PRIVADO salvo que se pida modo=DOCUMENTO."""
    carpeta = os.path.dirname(os.path.abspath(ruta))
    os.makedirs(carpeta, exist_ok=True)
    if modo is None and app().get("privado"):
        modo = PRIVADO  # app.json "privado": true (p. ej. datos de niños): todo queda 0600, siempre
    if modo is None:
        try:
            modo = os.stat(ruta).st_mode & 0o777
        except OSError:
            modo = 0o600
    fd, tmp = tempfile.mkstemp(prefix=f".{app()['id']}-", dir=carpeta)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(texto)
        if os.name != "nt":
            os.chmod(tmp, modo)
        os.replace(tmp, ruta)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def escribir_json(ruta, valor, indent=1):
    escribir_atomico(ruta, json.dumps(valor, ensure_ascii=False, indent=indent) + "\n")


def ruta_en(base, relativa):
    """La ruta absoluta de `relativa` dentro de `base`, o None si se sale (.., absolutas, enlaces hacia afuera)."""
    if not isinstance(relativa, str) or not relativa or "\0" in relativa or os.path.isabs(relativa):
        return None
    base = os.path.realpath(base)
    ruta = os.path.realpath(os.path.join(base, relativa))
    return ruta if ruta == base or ruta.startswith(base + os.sep) else None


# ── Configuración ────────────────────────────────────────────────────────────────────────────────────────────────────────────

def _valida(regla, valor):
    if isinstance(regla, dict):  # {"tipo": "texto" | [valores], "max"?: caracteres, "interfaz"?: false}
        if regla.get("tipo") == "texto" and isinstance(regla.get("max"), int) and 0 < regla["max"] <= MAXIMO_ENTRADA:
            return isinstance(valor, str) and len(valor) <= regla["max"]
        return _valida(regla.get("tipo"), valor)
    if isinstance(regla, list):
        return valor in regla
    return {"bool": isinstance(valor, bool), "texto": isinstance(valor, str) and len(valor) <= 2000,
            "numero": isinstance(valor, (int, float)) and not isinstance(valor, bool)}.get(regla, False)


def limpiar_config(datos):
    """Solo las claves que declara app.json, con valores válidos. Lo desconocido se descarta en silencio."""
    reglas = app()["config"]
    return {k: v for k, v in (datos or {}).items() if k in reglas and _valida(reglas[k], v)}


def config():
    return limpiar_config(leer_json(os.path.join(carpeta_datos(), "config.json"), {}))


def guardar_config(cambios, desde_interfaz=True):
    """Mezcla los cambios válidos con la config actual y la guarda. Devuelve la config resultante.

    Lo que llega de la interfaz nunca cambia una clave marcada `"interfaz": false` en app.json (p. ej. una carpeta que solo
    elige el selector del sistema): para esas, el host llama con desde_interfaz=False."""
    reglas = app()["config"]
    cambios = {k: v for k, v in limpiar_config(cambios).items()
               if not (desde_interfaz and isinstance(reglas.get(k), dict) and reglas[k].get("interfaz") is False)}
    # Se escribe sobre lo que hay en el archivo: las claves que este script no conoce (las escribe el host u otra versión) se
    # conservan tal cual; config() igual las filtra al leer.
    ruta = os.path.join(carpeta_datos(), "config.json")
    crudo = leer_json(ruta, {})
    crudo = crudo if isinstance(crudo, dict) else {}
    escribir_json(ruta, {**crudo, **cambios})
    return {**config(), **cambios}


# ── Contrato de los scripts ──────────────────────────────────────────────────────────────────────────────────────────────────

def responder(salida, datos):
    escribir_json(salida, datos, indent=None)


def leer_entrada(ruta):
    if os.path.getsize(ruta) > MAXIMO_ENTRADA:
        raise ValueError("La entrada es demasiado grande.")
    with open(ruta, encoding="utf-8") as f:
        return json.load(f)


def script(acciones, uso):
    """Despacha `script.py <accion> [entrada.json] <salida.json>`. Cada acción recibe el dict de entrada (o {}) y devuelve un dict.
    Un error se responde como {"ok": false, "error": "..."} en la salida, nunca como traza en la pantalla de la persona."""
    args = sys.argv[1:]
    if len(args) < 2 or args[0] not in acciones:
        print(uso, file=sys.stderr)
        sys.exit(2)
    accion, salida = args[0], args[-1]
    try:
        entrada = leer_entrada(args[1]) if len(args) == 3 else {}
        respuesta = acciones[accion](entrada if isinstance(entrada, dict) else {})
    except Exception as e:  # noqa: BLE001 — la persona ve un mensaje, no una traza
        respuesta = {"ok": False, "error": str(e) or e.__class__.__name__}
    responder(salida, respuesta)
