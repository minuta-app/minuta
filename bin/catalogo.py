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

- Cada tipo vive en el catálogo en `<carpeta>/<categoria>/<id>.json` (la categoría ES la carpeta; `carpeta` es el id del tipo si
  no se dice otra) o, con `"categoria": false`, en `<carpeta>/<id>.json` (un catálogo plano). Su índice va en `indice` (por
  defecto `<carpeta>/index.json`): {"formato": 1, "<clave>": [{…el contenido entero…, "ruta", "sha256", "tamano"}]}; `clave` es
  el id del tipo si no se dice otra (también se acepta una lista sola).
- `validador` es un módulo de bin/ que pone la app: `<funcion>(obj) -> [problemas]` (vacío = sirve; `funcion` es «validar» si no
  se dice otra) y, si quiere, `CATEGORIAS` (tupla), los campos que se guardan (`campos`: el nombre de una constante del módulo,
  «CAMPOS» si no se dice otra, o la lista misma) y `FORMATO` (del índice, 1 si no lo dice). Se valida el objeto ENTERO (un campo
  de más que el validador no acepta se rechaza) y recién después se recorta a sus campos. Solo datos: nunca se ejecuta nada de
  afuera.
- Ids: minúsculas, números y guiones; con `"mayusculas": true` también mayúsculas (`pt-BR`), sin repetir aunque cambie una
  mayúscula (hay discos que no las distinguen).
- Lo incluido en la app está en `<recursos>/<incluidos>/[<categoria>/]<id>.json`; lo descargado, en
  `<carpeta de datos>/<local>/<id>.json` (nunca en la carpeta de la persona; `incluidos` y `local` son el id del tipo si no se
  dice otra) y gana sobre lo incluido con el mismo id. Cada uno trae `origen`: «incluido» o «descargado».
- La huella es **obligatoria** y el id se busca **solo** en el último índice validado (queda en `<datos>/catalogo/<tipo>.json`):
  instalar compara id, tamaño y SHA-256 con ese índice, no con lo que mande la interfaz. La última lista validada también queda
  (`<tipo>.lista.json`) para mostrar la galería sin conexión (`ultima`).

Uso (lo de la persona va en un JSON de entrada; el último argumento es el JSON de salida):
  catalogo.py indice   <entrada {tipo, archivo}> <salida>          el índice que bajó el host, validado → {ok, tipo, <tipo>: […]}
  catalogo.py ultima   <entrada {tipo}> <salida>                   la última lista validada (sin conexión) → {ok, tipo, <tipo>, fecha}
  catalogo.py instalar <entrada {tipo, archivo, id, sha256}> <salida> → {ok, tipo, id, item, <singular>?}
  catalogo.py listar   <entrada {tipo}> <salida>                   incluidos + descargados → {ok, tipo, <tipo>: […]}
  catalogo.py quitar   <entrada {tipo, id}> <salida>                borra uno descargado → {ok, tipo, id}
  catalogo.py generar  <tipo> <raiz del catálogo> <salida.json> [--validador=<archivo.py|módulo>] [--opciones=<json del tipo>]
                       arma el índice del repo del catálogo (sale con 1 si hay problemas). En el repo del catálogo no hace
                       falta nucleo.py ni app.json: con --validador (y --opciones si el tipo no es el de siempre) basta.
  catalogo.py validar  <tipo> <archivo.json>… [--validador=…] [--opciones=…]   revisa archivos sueltos (sale con 1 si hay problemas)
"""
import glob
import hashlib
import importlib
import importlib.util
import json
import os
import re
import sys
import time

try:
    import nucleo
except ImportError:  # en el repo del catálogo (generar, validar) no hay nucleo.py ni app.json
    nucleo = None

ID = r"[a-z0-9]+(?:-[a-z0-9]+)*"
ID_MAYUSCULAS = r"[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*"
CARPETA = r"[a-z][a-z0-9-]{0,30}"
NOMBRE_PY = r"[A-Za-z_][A-Za-z0-9_]{0,40}"
EXTRA = ("ruta", "sha256", "tamano", "archivo", "bytes", "origen")
#: Frases en español (claves de traducción). La interfaz hace Tp(r.frase) con lo que llega (no «plantilla»: un tipo con
#: singular «plantilla» devuelve ahí el objeto descargado).
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
    return {"ok": False, "codigo": codigo, "frase": ERRORES[codigo], "error": ERRORES[codigo], **extra}


# ───────────── Configuración (app.json) ─────────────

def armar_tipo(tid, t):
    """Un tipo de catálogo validado (lo de app.json → catalogo.tipos.<tid>, o --opciones en el repo del catálogo)."""
    if not isinstance(tid, str) or not re.fullmatch(CARPETA, tid) or not isinstance(t, dict):
        raise RuntimeError(f"app.json: tipo de catálogo raro «{tid}».")
    donde = f"app.json: «catalogo.tipos.{tid}"
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,40}", str(t.get("validador", ""))):
        raise RuntimeError(f"{donde}.validador» es el nombre de un módulo de bin/.")
    carpetas = {}
    for k in ("carpeta", "local", "incluidos", "clave"):
        v = t.get(k, tid)
        if not isinstance(v, str) or not re.fullmatch(CARPETA, v):
            raise RuntimeError(f"{donde}.{k}» es un nombre de carpeta (minúsculas, números y guiones).")
        carpetas[k] = v
    indice = t.get("indice", f"{carpetas['carpeta']}/index.json")
    if not isinstance(indice, str) or not re.fullmatch(r"(?:[a-z0-9-]+/)?[a-z0-9-]+\.json", indice):
        raise RuntimeError(f"{donde}.indice» no es válido.")
    funcion = t.get("funcion", "validar")
    if not isinstance(funcion, str) or not re.fullmatch(NOMBRE_PY, funcion):
        raise RuntimeError(f"{donde}.funcion» es el nombre de una función del validador.")
    campos = t.get("campos", "CAMPOS")
    if not (isinstance(campos, str) and re.fullmatch(NOMBRE_PY, campos)) and not (
            isinstance(campos, list) and campos and all(isinstance(x, str) and re.fullmatch(r"\w{1,60}", x) for x in campos)):
        raise RuntimeError(f"{donde}.campos» es el nombre de una constante del validador o la lista de campos.")
    for k in ("categoria", "mayusculas", "origen"):
        if k in t and not isinstance(t[k], bool):
            raise RuntimeError(f"{donde}.{k}» es true o false.")

    def numero(clave, defecto, tope):
        v = t.get(clave, defecto)
        return v if isinstance(v, int) and not isinstance(v, bool) and 0 < v <= tope else defecto
    singular = t.get("singular")
    return {"id": tid, "validador": t["validador"], "indice": indice, **carpetas, "funcion": funcion, "campos": campos,
            "categoria": t.get("categoria", True), "id_re": ID_MAYUSCULAS if t.get("mayusculas") else ID,
            "max_bytes": numero("max_bytes", 100 * 1024, 5 * 1024 * 1024),
            "max_indice": numero("max_indice", 1024 * 1024, 20 * 1024 * 1024),
            "max_en_indice": numero("max_en_indice", 1000, 10000),
            "singular": singular if isinstance(singular, str) and re.fullmatch(r"[a-z]{1,30}", singular) else None,
            "origen": t.get("origen", True) is not False}


def config():
    """La sección «catalogo» de app.json, validada: {repo, rama, base, tipos: {id: {…}}}."""
    c = nucleo.app().get("catalogo")
    if not isinstance(c, dict) or not re.fullmatch(r"[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}", str(c.get("repo", ""))):
        raise RuntimeError("app.json: «catalogo.repo» debe ser «dueño/repo» (el repo de solo datos del catálogo).")
    rama = c.get("rama", "main")
    if not isinstance(rama, str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,60}", rama) or ".." in rama:
        raise RuntimeError("app.json: «catalogo.rama» no es válida.")
    tipos = {tid: armar_tipo(tid, t) for tid, t in (c.get("tipos") or {}).items()}
    return {"repo": c["repo"], "rama": rama, "base": f"https://raw.githubusercontent.com/{c['repo']}/{rama}/", "tipos": tipos}


def tipo(tid):
    t = config()["tipos"].get(tid) if isinstance(tid, str) else None
    if not t:
        raise ErrorCatalogo("no_valido")
    return t


def _formato(t, ruta=None):
    """El módulo que valida el formato de este tipo (lo pone la app en bin/, o un archivo .py en el repo del catálogo)."""
    if ruta and ruta.endswith(".py"):
        spec = importlib.util.spec_from_file_location(os.path.basename(ruta)[:-3], ruta)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
    else:
        m = importlib.import_module(ruta or t["validador"])
    if not callable(getattr(m, t["funcion"], None)):
        raise RuntimeError(f"{t['validador']}.py tiene que tener {t['funcion']}(obj) -> [problemas].")
    return m


def _validar(t, m, obj):
    """Los problemas del validador de la app (una lista; vacía = sirve)."""
    p = getattr(m, t["funcion"])(obj)
    return list(p) if isinstance(p, (list, tuple)) else [] if not p else [str(p)]


def _campos(t, m):
    return set(t["campos"]) if isinstance(t["campos"], list) else getattr(m, t["campos"], None)


def _ruta(t, ruta):
    """(categoria o None, id) si `ruta` tiene la forma de este tipo; si no, None."""
    if not isinstance(ruta, str):
        return None
    if t["categoria"]:
        g = re.fullmatch(rf"{re.escape(t['carpeta'])}/({ID})/({t['id_re']})\.json", ruta)
        return (g.group(1), g.group(2)) if g else None
    g = re.fullmatch(rf"{re.escape(t['carpeta'])}/({t['id_re']})\.json", ruta)
    return (None, g.group(1)) if g and ruta != t["indice"] else None


def _clave(t, ident):
    """Para no repetir ids: sin distinguir mayúsculas si el tipo las acepta."""
    return ident.lower() if t["id_re"] == ID_MAYUSCULAS else ident


def _valido(t, m, obj):
    """El objeto (recortado a sus campos) si el validador de la app acepta el objeto ENTERO y tiene id (y categoría con forma de
    carpeta, si el tipo la usa); si no, None. Lo que agrega el índice (ruta, huella, tamaño) o la app (origen) no es contenido."""
    if not isinstance(obj, dict):
        return None
    obj = {k: v for k, v in obj.items() if k not in EXTRA}
    if not isinstance(obj.get("id"), str) or not re.fullmatch(t["id_re"], obj["id"]) or len(obj["id"]) > 60:
        return None
    if t["categoria"]:
        if not isinstance(obj.get("categoria"), str) or not re.fullmatch(ID, obj["categoria"]):
            return None
        categorias = getattr(m, "CATEGORIAS", None)
        if categorias and obj["categoria"] not in categorias:
            return None
    try:
        if _validar(t, m, obj):
            return None
    except Exception:  # noqa: BLE001 — un validador que se cae con algo raro: no sirve
        return None
    campos = _campos(t, m)
    return {k: v for k, v in obj.items() if k in campos} if campos else obj


# ───────────── El índice que bajó el host ─────────────

def validar_indice(t, d):
    """Del índice, solo las entradas válidas: [{…contenido, ruta, sha256, tamano}]. Acepta también «archivo»/«bytes» (el nombre
    que usaban algunos catálogos) y una lista sola en vez de {formato, <clave>: […]}. Lo demás se descarta en silencio."""
    m = _formato(t)
    if isinstance(d, list):
        lista = d
    elif isinstance(d, dict) and ("formato" not in d or d["formato"] == getattr(m, "FORMATO", 1)):
        lista = d.get(t["clave"])
    else:
        return []
    r, vistos = [], set()
    for x in lista if isinstance(lista, list) else []:
        if not isinstance(x, dict):
            continue
        obj = _valido(t, m, x)
        ruta = x.get("ruta", x.get("archivo"))
        tamano = x.get("tamano", x.get("bytes"))
        g = _ruta(t, ruta)
        if not obj or not g or (t["categoria"] and g[0] != obj["categoria"]) \
                or g[1] != obj["id"] or _clave(t, obj["id"]) in vistos \
                or not isinstance(x.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", x["sha256"]) \
                or not isinstance(tamano, int) or isinstance(tamano, bool) or not 0 < tamano <= t["max_bytes"]:
            continue
        vistos.add(_clave(t, obj["id"]))
        r.append({**obj, "ruta": ruta, "sha256": x["sha256"], "tamano": tamano})
        if len(r) >= t["max_en_indice"]:
            break
    return r


def _guardado(t, sufijo=""):
    return os.path.join(nucleo.carpeta_privada(os.path.join(nucleo.carpeta_datos(), "catalogo")), t["id"] + sufijo + ".json")


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
    nucleo.escribir_json(_guardado(t), {x["id"]: {"ruta": x["ruta"], "sha256": x["sha256"], "tamano": x["tamano"]} for x in lista})
    # Y la lista entera, para ver la galería sin conexión.
    nucleo.escribir_json(_guardado(t, ".lista"), {"fecha": time.strftime("%Y-%m-%dT%H:%M:%S"), "lista": lista}, indent=None)
    return {"ok": True, "tipo": t["id"], t["id"]: lista}


def ultima(d):
    """La última lista que se validó (para la galería sin conexión), vuelta a validar: {ok, tipo, <tipo>, fecha, guardada}."""
    t = tipo(d.get("tipo"))
    g = nucleo.leer_json(_guardado(t, ".lista"), None, maximo=t["max_indice"] * 2)
    if not isinstance(g, dict) or not isinstance(g.get("lista"), list):
        return _error("sin_conexion", tipo=t["id"])
    lista = validar_indice(t, g["lista"])
    return {"ok": True, "tipo": t["id"], t["id"]: lista, "fecha": str(g.get("fecha", ""))[:19], "guardada": True}


def instalar(d):
    """Lo que bajó el host: id, tamaño y huella contra el último índice validado; se vuelve a validar y se guarda en la carpeta de
    datos de la app (0600)."""
    t = tipo(d.get("tipo"))
    ident, huella, archivo = d.get("id"), d.get("sha256"), d.get("archivo")
    if not (isinstance(ident, str) and isinstance(huella, str) and re.fullmatch(r"[0-9a-f]{64}", huella) and isinstance(archivo, str)):
        return _error("no_valido", tipo=t["id"], id=ident if isinstance(ident, str) else "")
    conocidos = nucleo.leer_json(_guardado(t), {}, maximo=8 * 1024 * 1024)
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
    g = _ruta(t, e.get("ruta", ""))
    if not obj or obj["id"] != ident or not g or g[1] != ident or (t["categoria"] and g[0] != obj["categoria"]):
        return _error("no_valido", tipo=t["id"], id=ident)
    carpeta = nucleo.carpeta_privada(os.path.join(nucleo.carpeta_datos(), t["local"]))
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
    patron = ("*", "*.json") if t["categoria"] else ("*.json",)
    for ruta in sorted(glob.glob(os.path.join(nucleo.recursos(), t["incluidos"], *patron))):
        obj = _leer(t, m, ruta)
        if obj and os.path.basename(ruta) == obj["id"] + ".json" and (
                not t["categoria"] or obj["categoria"] == os.path.basename(os.path.dirname(ruta))):
            r[obj["id"]] = obj
    return r


def descargados(t):
    m, r = _formato(t), {}
    for ruta in sorted(glob.glob(os.path.join(nucleo.carpeta_datos(), t["local"], "*.json"))):
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
    if not isinstance(ident, str) or not re.fullmatch(t["id_re"], ident) or len(ident) > 60:
        return _error("no_valido", tipo=t["id"])
    try:
        os.unlink(os.path.join(nucleo.carpeta_datos(), t["local"], ident + ".json"))
    except FileNotFoundError:
        pass
    return {"ok": True, "tipo": t["id"], "id": ident}


# ───────────── El repo del catálogo (lo corre quien mantiene, o su workflow) ─────────────

def generar(raiz, t, m=None):
    """Valida <raiz>/<carpeta>/[<categoria>/]<id>.json y devuelve (índice, problemas). Solo entra lo que pasa todas las reglas."""
    m = m or _formato(t)
    lista, problemas, vistos = [], [], {}
    forma = f"{t['carpeta']}/<categoria>/<id>.json" if t["categoria"] else f"{t['carpeta']}/<id>.json"
    patron = ("*", "*") if t["categoria"] else ("*",)
    for ruta in sorted(glob.glob(os.path.join(raiz, t["carpeta"], *patron))):
        rel = os.path.relpath(ruta, raiz).replace(os.sep, "/")
        if rel == t["indice"] or rel.endswith(".md") or (not t["categoria"] and os.path.isdir(ruta)):
            continue
        g = _ruta(t, rel)
        if not g or os.path.islink(ruta) or not os.path.isfile(ruta):
            problemas.append(f"{rel}: solo archivos {forma} (minúsculas, números y guiones)")
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
        p = (_validar(t, m, obj) if isinstance(obj, dict) else ["no es un objeto"]) or (
            [] if _valido(t, m, obj) else ["id" + (" o categoría" if t["categoria"] else "")])
        if not p and obj["id"] != g[1]:
            p = ["el archivo tiene que llamarse como su id"]
        if not p and t["categoria"] and obj["categoria"] != g[0]:
            p = [f"está en la carpeta {g[0]} y su categoria es «{obj['categoria']}»"]
        if not p and _clave(t, obj["id"]) in vistos:
            p = [f"el id «{obj['id']}» ya está en {vistos[_clave(t, obj['id'])]}"]
        if p:
            problemas.append(f"{rel}: " + ", ".join(map(str, p)))
            continue
        vistos[_clave(t, obj["id"])] = rel
        lista.append({**_valido(t, m, obj), "ruta": rel, "sha256": hashlib.sha256(crudo).hexdigest(), "tamano": len(crudo)})
    if len(lista) > t["max_en_indice"]:
        problemas.append(f"el índice no puede tener más de {t['max_en_indice']}")
    return {"formato": getattr(m, "FORMATO", 1), t["clave"]: lista[:t["max_en_indice"]]}, problemas


def _tipo_desarrollo(tid, opciones):
    """El tipo para generar/validar: el de app.json si hay (y no se pasa --validador), o el que dicen las opciones."""
    validador = opciones.pop("--validador", None)
    extra = json.loads(opciones.pop("--opciones", "{}") or "{}")
    if not isinstance(extra, dict):
        raise SystemExit("--opciones es un objeto JSON, como en app.json → catalogo.tipos.<tipo>.")
    if nucleo is not None and not validador and not extra:
        try:
            t = tipo(tid)
            return t, _formato(t)
        except (OSError, ValueError, KeyError, ErrorCatalogo):
            pass
    if not validador:
        raise SystemExit("Sin app.json: pasa --validador=<archivo.py o módulo> (y --opciones='{…}' si hace falta).")
    nombre = os.path.basename(validador)[:-3] if validador.endswith(".py") else validador
    t = armar_tipo(tid, {"validador": nombre, **extra})
    return t, _formato(t, validador)


def _desarrollo(args):
    opciones = dict(x.split("=", 1) for x in args if x.startswith("--") and "=" in x)
    args = [x for x in args if not (x.startswith("--") and "=" in x)]
    if args[:1] == ["generar"] and len(args) == 4:
        t, m = _tipo_desarrollo(args[1], opciones)
        datos, problemas = generar(args[2], t, m)
        for p in problemas:
            print("✗ " + p)
        with open(args[3], "w", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(datos, ensure_ascii=False, indent=1) + "\n")
        return 1 if problemas else 0
    if args[:1] == ["validar"] and len(args) > 2:
        t, m = _tipo_desarrollo(args[1], opciones)
        malos = 0
        for ruta in args[2:]:
            try:
                with open(ruta, encoding="utf-8") as f:
                    obj = json.load(f)
                p = _validar(t, m, obj) if isinstance(obj, dict) else ["no es un objeto"]
            except (OSError, ValueError) as err:
                p = [f"no es JSON ({err})"]
            if not p and os.path.basename(ruta) != obj["id"] + ".json":
                p = ["el archivo tiene que llamarse como su id"]
            if not p and t["categoria"] and os.path.basename(os.path.dirname(ruta)) != obj.get("categoria"):
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
    nucleo.script({"indice": seguro(leer_indice), "instalar": seguro(instalar), "ultima": seguro(ultima),
                   "listar": seguro(lambda d: {"ok": True, "tipo": tipo(d.get("tipo"))["id"],
                                               tipo(d.get("tipo"))["id"]: listar(d.get("tipo"))}),
                   "quitar": seguro(quitar)}, __doc__)
