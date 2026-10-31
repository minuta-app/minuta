#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
"""Pieza «catálogo»: contenido de la comunidad (plantillas, efectos, temas…) que la app descarga de un repo de solo datos.
Solo biblioteca estándar. Aquí se VALIDA y se GUARDA; la descarga la hace el host (mac/Catalogo.swift, escritorio/catalogo.js):
dominio fijo, sin redirecciones, tamaño máximo y SHA-256 del índice validado.

La app lo describe en app.json (nada de la app va en este archivo):

    "catalogo": {"repo": "ana-app/ana-catalogo", "rama": "main",
                 "tipos": {"plantillas": {"validador": "plantilla_formato", "indice": "index.json",
                                          "max_bytes": 102400, "max_indice": 1048576, "max_en_indice": 1000,
                                          "singular": "plantilla", "origen": true}}}

- Cada tipo vive en el catálogo en `<tipo>/<categoria>/<id>.json` (la categoría ES la carpeta) y su índice en `indice`
  (por defecto `<tipo>/index.json`): {"formato": 1, "<tipo>": [{…el contenido entero…, "ruta", "sha256", "tamano"}]}.
- `validador` es un módulo de bin/ que pone la app: `validar(obj) -> [problemas]` (vacío = sirve) y, si quiere, `CATEGORIAS`
  (tupla), `CAMPOS` (claves que se guardan), `FORMATO` (del índice, 1 si no lo dice). Solo datos: nunca se ejecuta nada de afuera.
- Lo incluido en la app está en `<recursos>/<tipo>/<categoria>/<id>.json`; lo descargado, en `<carpeta de datos>/<tipo>/<id>.json`
  (nunca en la carpeta de la persona) y gana sobre lo incluido con el mismo id. Cada uno trae `origen`: «incluido» o «descargado».
- La huella es **obligatoria** y el id se busca **solo** en el último índice validado (queda en `<datos>/catalogo/<tipo>.json`):
  instalar compara id, tamaño y SHA-256 con ese índice, no con lo que mande la interfaz.

Uso (lo de la persona va en un JSON de entrada; el último argumento es el JSON de salida):
  catalogo.py indice   <entrada {tipo, archivo}> <salida>          el índice que bajó el host, validado → {ok, tipo, <tipo>: […]}
  catalogo.py instalar <entrada {tipo, archivo, id, sha256}> <salida> → {ok, tipo, id, item, <singular>?}
  catalogo.py listar   <entrada {tipo}> <salida>                   incluidos + descargados → {ok, tipo, <tipo>: […]}
  catalogo.py quitar   <entrada {tipo, id}> <salida>                borra uno descargado → {ok, tipo, id}
  catalogo.py generar  <tipo> <raiz del catálogo> <salida.json>     arma el índice del repo del catálogo (sale con 1 si hay problemas)
  catalogo.py validar  <tipo> <archivo.json>…                        revisa archivos sueltos (sale con 1 si hay problemas)
"""
import glob
import hashlib
import importlib
import json
import os
import re
import sys

import nucleo

ID = r"[a-z0-9]+(?:-[a-z0-9]+)*"
EXTRA = ("ruta", "sha256", "tamano", "archivo", "bytes", "origen")
#: Frases en español (claves de traducción). La interfaz hace Tp(plantilla) con el código que llega.
ERRORES = {
    "sin_conexion": "No pude conectarme. Revisa tu conexión.",
    "indice": "No pude leer el catálogo.",
    "no_valido": "Eso no es válido.",
    "danado": "Llegó dañado. Intenta de nuevo.",
    "no_esta": "Ya no está en el catálogo. Vuelve a abrirlo.",
}


class ErrorCatalogo(ValueError):
    def __init__(self, codigo):
        super().__init__(ERRORES[codigo])
        self.codigo = codigo


def _error(codigo, **extra):
    return {"ok": False, "codigo": codigo, "plantilla": ERRORES[codigo], "error": ERRORES[codigo], **extra}


# ───────────── Configuración (app.json) ─────────────

def config():
    """La sección «catalogo» de app.json, validada: {repo, rama, base, tipos: {id: {…}}}."""
    c = nucleo.app().get("catalogo")
    if not isinstance(c, dict) or not re.fullmatch(r"[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}", str(c.get("repo", ""))):
        raise RuntimeError("app.json: «catalogo.repo» debe ser «dueño/repo».")
    rama = c.get("rama", "main")
    if not isinstance(rama, str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,60}", rama) or ".." in rama:
        raise RuntimeError("app.json: «catalogo.rama» no es válida.")
    tipos = {}
    for tid, t in (c.get("tipos") or {}).items():
        if not re.fullmatch(r"[a-z][a-z0-9-]{0,30}", tid) or not isinstance(t, dict):
            raise RuntimeError(f"app.json: tipo de catálogo raro «{tid}».")
        if not re.fullmatch(r"[a-z_][a-z0-9_]{0,40}", str(t.get("validador", ""))):
            raise RuntimeError(f"app.json: «catalogo.tipos.{tid}.validador» es el nombre de un módulo de bin/.")
        indice = t.get("indice", f"{tid}/index.json")
        if not isinstance(indice, str) or not re.fullmatch(r"(?:[a-z0-9-]+/)?[a-z0-9-]+\.json", indice):
            raise RuntimeError(f"app.json: «catalogo.tipos.{tid}.indice» no es válido.")
        def numero(clave, defecto, tope):
            v = t.get(clave, defecto)
            return v if isinstance(v, int) and not isinstance(v, bool) and 0 < v <= tope else defecto
        singular = t.get("singular")
        tipos[tid] = {"id": tid, "validador": t["validador"], "indice": indice,
                      "max_bytes": numero("max_bytes", 100 * 1024, 5 * 1024 * 1024),
                      "max_indice": numero("max_indice", 1024 * 1024, 20 * 1024 * 1024),
                      "max_en_indice": numero("max_en_indice", 1000, 10000),
                      "singular": singular if isinstance(singular, str) and re.fullmatch(r"[a-z]{1,30}", singular) else None,
                      "origen": t.get("origen", True) is not False}
    return {"repo": c["repo"], "rama": rama, "base": f"https://raw.githubusercontent.com/{c['repo']}/{rama}/", "tipos": tipos}


def tipo(tid):
    t = config()["tipos"].get(tid) if isinstance(tid, str) else None
    if not t:
        raise ErrorCatalogo("no_valido")
    return t


def _formato(t):
    """El módulo que valida el formato de este tipo (lo pone la app en bin/)."""
    m = importlib.import_module(t["validador"])
    if not callable(getattr(m, "validar", None)):
        raise RuntimeError(f"{t['validador']}.py tiene que tener validar(obj) -> [problemas].")
    return m


def _patron(t):
    return re.compile(rf"{re.escape(t['id'])}/({ID})/({ID})\.json")


def _valido(t, m, obj):
    """El objeto (solo sus campos) si pasa el validador de la app y tiene id y categoría con forma de carpeta; si no, None."""
    if not isinstance(obj, dict):
        return None
    campos = getattr(m, "CAMPOS", None)
    obj = {k: v for k, v in obj.items() if (k in campos if campos else k not in EXTRA)}
    if not isinstance(obj.get("id"), str) or not re.fullmatch(ID, obj["id"]) or len(obj["id"]) > 60:
        return None
    if not isinstance(obj.get("categoria"), str) or not re.fullmatch(ID, obj["categoria"]):
        return None
    categorias = getattr(m, "CATEGORIAS", None)
    if categorias and obj["categoria"] not in categorias:
        return None
    try:
        return None if m.validar(obj) else obj
    except Exception:  # noqa: BLE001 — un validador que se cae con algo raro: no sirve
        return None


# ───────────── El índice que bajó el host ─────────────

def validar_indice(t, d):
    """Del índice, solo las entradas válidas: [{…contenido, ruta, sha256, tamano}]. Acepta también «archivo»/«bytes» (el nombre
    que usaban algunos catálogos). Lo demás se descarta en silencio."""
    m = _formato(t)
    if not isinstance(d, dict) or ("formato" in d and d["formato"] != getattr(m, "FORMATO", 1)):
        return []
    lista = d.get(t["id"])
    r, vistos, patron = [], set(), _patron(t)
    for x in lista if isinstance(lista, list) else []:
        if not isinstance(x, dict):
            continue
        obj = _valido(t, m, x)
        ruta = x.get("ruta", x.get("archivo"))
        tamano = x.get("tamano", x.get("bytes"))
        g = patron.fullmatch(ruta) if isinstance(ruta, str) else None
        if (not obj or not g or g.group(1) != obj["categoria"] or g.group(2) != obj["id"] or obj["id"] in vistos
                or not isinstance(x.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", x["sha256"])
                or not isinstance(tamano, int) or isinstance(tamano, bool) or not 0 < tamano <= t["max_bytes"]):
            continue
        vistos.add(obj["id"])
        r.append({**obj, "ruta": ruta, "sha256": x["sha256"], "tamano": tamano})
        if len(r) >= t["max_en_indice"]:
            break
    return r


def _ultimo(t):
    return os.path.join(nucleo.carpeta_privada(os.path.join(nucleo.carpeta_datos(), "catalogo")), t["id"] + ".json")


def leer_indice(d):
    t = tipo(d.get("tipo"))
    archivo = d.get("archivo")
    try:
        if not isinstance(archivo, str) or os.path.getsize(archivo) > t["max_indice"]:
            return _error("indice", tipo=t["id"])
        with open(archivo, "rb") as f:
            crudo = json.loads(f.read(t["max_indice"] + 1).decode("utf-8"))
    except (OSError, UnicodeDecodeError, ValueError):
        return _error("indice", tipo=t["id"])
    lista = validar_indice(t, crudo)
    # Lo que se puede instalar después: solo esto (id → ruta, tamaño, huella).
    nucleo.escribir_json(_ultimo(t), {x["id"]: {"ruta": x["ruta"], "sha256": x["sha256"], "tamano": x["tamano"]} for x in lista})
    return {"ok": True, "tipo": t["id"], t["id"]: lista}


def instalar(d):
    """Lo que bajó el host: id, tamaño y huella contra el último índice validado; se vuelve a validar y se guarda en la carpeta de
    datos de la app (0600)."""
    t = tipo(d.get("tipo"))
    ident, huella, archivo = d.get("id"), d.get("sha256"), d.get("archivo")
    if not (isinstance(ident, str) and isinstance(huella, str) and re.fullmatch(r"[0-9a-f]{64}", huella) and isinstance(archivo, str)):
        return _error("no_valido", tipo=t["id"], id=ident if isinstance(ident, str) else "")
    conocidos = nucleo.leer_json(_ultimo(t), {}, maximo=8 * 1024 * 1024)
    e = conocidos.get(ident) if isinstance(conocidos, dict) else None
    if not isinstance(e, dict) or e.get("sha256") != huella:
        return _error("no_esta", tipo=t["id"], id=ident)
    try:
        with open(archivo, "rb") as f:
            crudo = f.read(t["max_bytes"] + 1)
    except OSError:
        return _error("danado", tipo=t["id"], id=ident)
    if len(crudo) != e.get("tamano") or hashlib.sha256(crudo).hexdigest() != huella:
        return _error("danado", tipo=t["id"], id=ident)
    try:
        obj = json.loads(crudo.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return _error("no_valido", tipo=t["id"], id=ident)
    obj = _valido(t, _formato(t), obj)
    g = _patron(t).fullmatch(e.get("ruta", ""))
    if not obj or obj["id"] != ident or not g or g.group(1) != obj["categoria"]:
        return _error("no_valido", tipo=t["id"], id=ident)
    carpeta = nucleo.carpeta_privada(os.path.join(nucleo.carpeta_datos(), t["id"]))
    nucleo.escribir_atomico(os.path.join(carpeta, ident + ".json"), json.dumps(obj, ensure_ascii=False, indent=1) + "\n", nucleo.PRIVADO)
    item = {**obj, "origen": "descargado"} if t["origen"] else obj
    return {"ok": True, "tipo": t["id"], "id": ident, "item": item, **({t["singular"]: item} if t["singular"] else {})}


# ───────────── Lo que hay en el computador ─────────────

def _leer(t, m, ruta):
    try:
        if os.path.islink(ruta) or os.path.getsize(ruta) > t["max_bytes"]:
            return None
        with open(ruta, encoding="utf-8") as f:
            return _valido(t, m, json.load(f))
    except (OSError, UnicodeDecodeError, ValueError):
        return None


def incluidos(t):
    m, r = _formato(t), {}
    for ruta in sorted(glob.glob(os.path.join(nucleo.recursos(), t["id"], "*", "*.json"))):
        obj = _leer(t, m, ruta)
        if obj and obj["categoria"] == os.path.basename(os.path.dirname(ruta)) and os.path.basename(ruta) == obj["id"] + ".json":
            r[obj["id"]] = obj
    return r


def descargados(t):
    m, r = _formato(t), {}
    for ruta in sorted(glob.glob(os.path.join(nucleo.carpeta_datos(), t["id"], "*.json"))):
        obj = _leer(t, m, ruta)
        if obj and os.path.basename(ruta) == obj["id"] + ".json":
            r[obj["id"]] = obj
    return r


def listar(tid):
    """Incluidos + descargados (estos ganan con el mismo id), ordenados por id; con `origen` si el tipo lo pide."""
    t = tipo(tid)
    todos = {k: (v, "incluido") for k, v in incluidos(t).items()}
    todos.update({k: (v, "descargado") for k, v in descargados(t).items()})
    return [({**v, "origen": o} if t["origen"] else v) for _, (v, o) in sorted(todos.items())]


def quitar(d):
    t = tipo(d.get("tipo"))
    ident = d.get("id")
    if not isinstance(ident, str) or not re.fullmatch(ID, ident) or len(ident) > 60:
        return _error("no_valido", tipo=t["id"])
    try:
        os.unlink(os.path.join(nucleo.carpeta_datos(), t["id"], ident + ".json"))
    except FileNotFoundError:
        pass
    return {"ok": True, "tipo": t["id"], "id": ident}


# ───────────── El repo del catálogo (lo corre quien mantiene, o su workflow) ─────────────

def generar(raiz, t, m=None):
    """Valida <raiz>/<tipo>/<categoria>/<id>.json y devuelve (índice, problemas). Solo entra lo que pasa todas las reglas."""
    m = m or _formato(t)
    lista, problemas, vistos = [], [], {}
    base = os.path.join(raiz, t["id"])
    for ruta in sorted(glob.glob(os.path.join(base, "*", "*"))):
        rel = os.path.relpath(ruta, raiz).replace(os.sep, "/")
        g = _patron(t).fullmatch(rel)
        if not g or os.path.islink(ruta) or not os.path.isfile(ruta):
            if not rel.endswith(".md"):
                problemas.append(f"{rel}: solo archivos {t['id']}/<categoria>/<id>.json (minúsculas, números y guiones)")
            continue
        with open(ruta, "rb") as f:
            crudo = f.read(t["max_bytes"] + 1)
        if len(crudo) > t["max_bytes"]:
            problemas.append(f"{rel}: pesa más de {t['max_bytes'] // 1024} KB")
            continue
        try:
            obj = json.loads(crudo.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as e:
            problemas.append(f"{rel}: no es JSON válido en UTF-8 ({e})")
            continue
        p = (m.validar(obj) if isinstance(obj, dict) else ["no es un objeto"]) or ([] if _valido(t, m, obj) else ["id o categoría"])
        if not p and obj["id"] != g.group(2):
            p = ["el archivo tiene que llamarse como su id"]
        if not p and obj["categoria"] != g.group(1):
            p = [f"está en la carpeta {g.group(1)} y su categoria es «{obj['categoria']}»"]
        if not p and obj["id"] in vistos:
            p = [f"el id «{obj['id']}» ya está en {vistos[obj['id']]}"]
        if p:
            problemas.append(f"{rel}: " + ", ".join(map(str, p)))
            continue
        vistos[obj["id"]] = rel
        lista.append({**_valido(t, m, obj), "ruta": rel, "sha256": hashlib.sha256(crudo).hexdigest(), "tamano": len(crudo)})
    if len(lista) > t["max_en_indice"]:
        problemas.append(f"el índice no puede tener más de {t['max_en_indice']}")
    return {"formato": getattr(m, "FORMATO", 1), t["id"]: lista[:t["max_en_indice"]]}, problemas


def _desarrollo(args):
    if args[:1] == ["generar"] and len(args) == 4:
        datos, problemas = generar(args[2], tipo(args[1]))
        for p in problemas:
            print("✗ " + p)
        nucleo.escribir_json(args[3], datos)
        return 1 if problemas else 0
    if args[:1] == ["validar"] and len(args) > 2:
        t = tipo(args[1])
        m, malos = _formato(t), 0
        for ruta in args[2:]:
            try:
                with open(ruta, encoding="utf-8") as f:
                    obj = json.load(f)
                p = m.validar(obj) if isinstance(obj, dict) else ["no es un objeto"]
            except (OSError, ValueError) as err:
                p = [f"no es JSON ({err})"]
            if not p and os.path.basename(ruta) != obj["id"] + ".json":
                p = ["el archivo tiene que llamarse como su id"]
            if not p and os.path.basename(os.path.dirname(ruta)) != obj.get("categoria"):
                p = ["la carpeta tiene que ser su categoría"]
            print(("✗ " if p else "✓ ") + ruta + (": " + ", ".join(map(str, p)) if p else ""))
            malos += bool(p)
        return 1 if malos else 0
    return None


if __name__ == "__main__":
    codigo = _desarrollo(sys.argv[1:])
    if codigo is not None:
        sys.exit(codigo)

    def seguro(f):
        def g(d):
            try:
                return f(d)
            except ErrorCatalogo as e:
                return _error(e.codigo)
        return g
    nucleo.script({"indice": seguro(leer_indice), "instalar": seguro(instalar),
                   "listar": seguro(lambda d: {"ok": True, "tipo": tipo(d.get("tipo"))["id"],
                                               tipo(d.get("tipo"))["id"]: listar(d.get("tipo"))}),
                   "quitar": seguro(quitar)}, __doc__)
