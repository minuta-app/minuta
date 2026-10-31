#!/usr/bin/env python3
"""Formato de un universo de Minuta (solo datos). El MISMO archivo vive en `minuta-catalogo/herramientas/`: la app y el catálogo
validan igual. Lo usa la pieza «catálogo» (`bin/catalogo.py`, tipo `temas` en app.json) para el índice, para instalar lo que se
descarga y para armar el índice del repo del catálogo.

En el catálogo cada universo vive en `temas/<categoria>/<id>.json`: `categoria` es la carpeta (la primera de `categorias`, sin
tildes ni espacios). Uso: universo_formato.py <archivo.json>…   (sale con 1 si alguno no sirve)
"""
import json
import re
import sys
import unicodedata

FORMATO = 1
APARTADOS = ("claridad", "escucha", "preguntas", "cierre")
#: Categorías para ordenar y buscar en la galería (la app las traduce). Un universo tiene de 1 a 4.
NOMBRES_CATEGORIAS = ("Películas", "Series", "Anime", "Animación", "Superhéroes", "Fantasía", "Ciencia ficción", "Clásicos",
                      "Aventura", "Comedia", "Videojuegos", "Autos", "Deportes", "Música", "Libros")


def slug(nombre):
    t = unicodedata.normalize("NFKD", nombre).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


#: Las carpetas del catálogo (la pieza exige que `categoria` sea una de estas).
CATEGORIAS = tuple(slug(c) for c in NOMBRES_CATEGORIAS)
#: Lo único que se guarda de un universo (lo demás se descarta).
CAMPOS = ("id", "categoria", "nombre", "emoji", "xp", "personaje_por_defecto", "elogios", "apartados", "rangos", "logros",
          "iconos_logros", "iconos_apartados", "iconos_rangos", "estilo", "idioma", "autor", "descripcion", "categorias")
#: Lo que la app de Mac necesita para leer el estilo (TemaJuego.Estilo): sin uno de estos, el universo no se puede usar.
ESTILO = {"modo": str, "fondo": str, "fondo2": str, "panel": str, "texto": str, "suave": str, "linea": str, "acento": str,
          "acento_texto": str, "acento2": str, "fuente": str, "peso": int, "mayusculas": bool, "cursiva": bool, "patron": str,
          "radio": int}
COLORES = ("fondo", "fondo2", "panel", "texto", "suave", "linea", "acento", "acento_texto", "acento2")
COLOR = re.compile(r"#[0-9a-fA-F]{3,8}|(rgb|hsl)a?\([\d\s.,%/+-]{1,60}\)|[a-zA-Z]{3,20}")
FUENTE = re.compile(r"[\w _-]{1,40}")


def textos(v):
    """Todos los textos de un universo (valores y claves), para revisarlos de una vez."""
    if isinstance(v, str):
        yield v
    elif isinstance(v, list):
        for x in v:
            yield from textos(x)
    elif isinstance(v, dict):
        for k, x in v.items():
            yield str(k)
            yield from textos(x)


def _texto(v, maximo=400):
    return isinstance(v, str) and 0 < len(v.strip()) <= maximo


def validar_estilo(e):
    errores = []
    for k, tipo in ESTILO.items():
        v = e.get(k)
        if not isinstance(v, tipo) or (tipo is int and isinstance(v, bool)):
            errores.append(f"estilo.{k}: falta o no es {tipo.__name__}")
    for k in COLORES:
        if isinstance(e.get(k), str) and not COLOR.fullmatch(e[k].strip()):
            errores.append(f"estilo.{k}: debe ser un color (#rrggbb o rgba(...))")
    if isinstance(e.get("fuente"), str) and not FUENTE.fullmatch(e["fuente"]):
        errores.append("estilo.fuente: solo letras, números, espacios y guiones")
    if e.get("modo") not in ("claro", "oscuro"):
        errores.append("estilo.modo: «claro» u «oscuro»")
    if isinstance(e.get("patron"), str) and not re.fullmatch(r"[a-z]{1,20}", e["patron"]):
        errores.append("estilo.patron: solo letras minúsculas")
    return errores


def validar(d):
    """[problemas] (vacío = sirve). Solo datos: ningún texto puede traer HTML ni algo parecido a código."""
    if not isinstance(d, dict):
        return ["no es un objeto JSON"]
    errores = []
    if not isinstance(d.get("id"), str) or not re.fullmatch(r"[a-z0-9]{2,40}", d["id"]):
        errores.append("id inválido (de 2 a 40 letras a-z y números)")
    extra = set(d) - set(CAMPOS)
    if extra:
        errores.append(f"claves no permitidas: {sorted(extra)}")
    for k in ("nombre", "emoji", "xp", "personaje_por_defecto"):
        if not _texto(d.get(k)):
            errores.append(f"falta «{k}»")
    if not isinstance(d.get("elogios"), list) or not d["elogios"] or not all(_texto(x) for x in d["elogios"]):
        errores.append("elogios: una lista de frases")
    rangos = d.get("rangos")
    if not isinstance(rangos, list) or len(rangos) != 10 or not all(
            isinstance(r, dict) and _texto(r.get("nombre")) and isinstance(r.get("frase"), str) for r in rangos):
        errores.append("debe tener 10 rangos con nombre y frase")
    apartados = d.get("apartados") if isinstance(d.get("apartados"), dict) else {}
    for a in APARTADOS:
        lista = apartados.get(a)
        if not isinstance(lista, list) or len(lista) != 10 or not all(
                isinstance(x, dict) and all(isinstance(x.get(k), str) for k in ("nombre", "referencia", "frase")) for x in lista):
            errores.append(f"apartado {a}: deben ser 10 arquetipos con nombre, referencia y frase")
    logros = d.get("logros")
    if not isinstance(logros, dict) or not all(
            isinstance(v, dict) and isinstance(v.get("nombre"), str) and isinstance(v.get("descripcion"), str) for v in logros.values()):
        errores.append("logros: cada uno con nombre y descripción")
    cats = d.get("categorias")
    if not isinstance(cats, list) or not 1 <= len(cats) <= 4 or any(c not in NOMBRES_CATEGORIAS for c in cats):
        errores.append(f"categorias: entre 1 y 4 de {list(NOMBRES_CATEGORIAS)}")
    elif d.get("categoria") != slug(cats[0]):
        errores.append(f"categoria: debe ser «{slug(cats[0])}» (la primera de categorias, que es también su carpeta)")
    if not isinstance(d.get("estilo"), dict):
        errores.append("falta «estilo»")
    else:
        errores += validar_estilo(d["estilo"])
    for k in ("idioma", "autor", "descripcion"):
        if k in d and not isinstance(d[k], str):
            errores.append(f"{k}: debe ser texto")
    raros = sorted({c for t in textos(d) for c in t if c in "<>`\\" or (ord(c) < 32 and c not in "\n\t")})
    if raros:
        errores.append(f"caracteres no permitidos en los textos: {' '.join(repr(c) for c in raros)}")
    if re.search(r"javascript:|data:|vbscript:|on\w+\s*=|url\s*\(|expression\s*\(", json.dumps(d, ensure_ascii=False), re.I):
        errores.append("contiene algo parecido a código")
    return errores


if __name__ == "__main__":
    malos = 0
    for ruta in sys.argv[1:]:
        try:
            with open(ruta, encoding="utf-8") as f:
                p = validar(json.load(f))
        except (OSError, ValueError) as e:
            p = [f"no es JSON ({e})"]
        print(("✗ " if p else "✓ ") + ruta + (": " + "; ".join(p) if p else ""))
        malos += bool(p)
    sys.exit(1 if malos else 0)
