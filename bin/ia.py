#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
"""Pieza «ia»: la IA de la persona (Claude Code, Codex o Gemini) con SU propia cuenta. Solo biblioteca estándar.

La app nunca llama a una IA con una cuenta propia: arma el comando del CLI que la persona ya tiene y le pasa el texto. Reúne lo mejor
de las seis apps:
- Corre en una carpeta temporal vacía, sin herramientas ni servidores MCP, sin la memoria de la persona (Esquema).
- El pedido NUNCA va como argumento del proceso (cualquier programa del computador puede ver los argumentos): va por la entrada
  estándar o en un archivo de la carpeta temporal (Alcancía).
- Material opcional (fotos, PDF): se copian a la carpeta temporal y la IA solo puede leer esas copias (Repasa).
- Revisión a fondo opcional: leer una carpeta, solo lectura y nunca los secretos (Esquema).
- Nunca se quitan protecciones para que un CLI viejo funcione: se pregunta antes qué opciones conoce (`_soporta`). Si no las conoce,
  se usa la forma segura que sí conoce o se falla con un mensaje claro.
- No recibe las variables de entorno de la app (<ID>_*).
- Los errores salen como código + plantilla + valores, para que la interfaz los traduzca (`ERRORES` trae el texto en español).
- En vivo (`preguntar_vivo`): cuenta qué archivos lee la IA mientras trabaja (Claude con stream-json, Codex con --json) y se puede
  detener. Usa el MISMO armado del comando que `ejecutar` (`_armar`): las protecciones viven en un solo lugar.
- A Claude solo se le prohíben las herramientas que su versión conoce: así no avisa «Permission deny rule … matches no known tool».

Uso: ia.py probar <entrada.json {"ia": "claude"}> <salida.json>   → {ia, ok, error?, codigo?}
     ia.py lista <salida.json>                                     → {ias: [{id, nombre, instalada}], elegida}
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time

import nucleo

CASA = os.path.expanduser("~")

#: id → (comandos posibles, nombre visible). Gemini: Antigravity CLI (`agy`) o el Gemini CLI.
IAS = {"claude": (("claude",), "Claude"), "codex": (("codex",), "ChatGPT (Codex)"), "gemini": (("agy", "gemini"), "Gemini")}
IMAGENES = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic")
#: Claude Code carga la memoria de la persona (CLAUDE.md, memoria automática) aunque corra sin herramientas, y con eso rellenaba las
#: respuestas con otros proyectos suyos. Esto lo apaga sin exigir una llave de API.
SIN_MEMORIA_CLAUDE = {"CLAUDE_CODE_DISABLE_CLAUDE_MDS": "1", "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1"}
#: Lo que nunca puede hacer la IA, ni siquiera en revisión a fondo.
PROHIBIDO = ["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch", "Task"]
#: Texto de cada error (la clave de traducción es el texto en español; {ia} y {detalle} se reemplazan en la interfaz).
ERRORES = {
    "no_instalada": "No encontré {ia} en este computador.",
    "demora": "{ia} se demoró demasiado en responder. Inténtalo de nuevo.",
    "sin_respuesta": "{ia} no respondió. {detalle}",
    "sin_respuesta_corta": "{ia} no respondió.",
    "desconocida": "No conozco esa IA.",
    "actualizar": "Actualiza {ia} para usarla con {app}: tu versión no conoce las protecciones que necesitamos.",
    "detenido": "Detuviste a {ia}.",
}
#: Herramientas que Claude Code ya no trae desde esa versión: prohibirlas solo produce el aviso «matches no known tool». Se quitan
#: de la lista SOLO si el CLI conoce --tools (entonces la IA ni siquiera carga otras herramientas que las pedidas).
RETIRADAS = {"MultiEdit": (2, 1, 0)}


#: Errores que la persona arregla en la app: a estos se les suma la «ayuda» que declara app.json.
CON_AYUDA = ("no_instalada", "actualizar")


def ayuda():
    """`"ia": {"ayuda": "Revisa en Ajustes → Tu IA."}` en app.json: dónde se elige la IA en esta app. Solo texto corto."""
    a = nucleo.app().get("ia")
    t = a.get("ayuda") if isinstance(a, dict) else None
    return t if isinstance(t, str) and 0 < len(t) <= 200 and not re.search(r"[<>{}]", t) else ""


class VersionVieja(Exception):
    """El CLI no conoce una protección obligatoria: nunca se corre sin ella; se le pide a la persona actualizarlo."""


INSTRUCCION_ARCHIVO = ("Lee el archivo instrucciones.md de esta carpeta (y el material que menciona) y haz exactamente lo que pide. "
                       "Entrega solo el resultado pedido, sin comentarios. No modifiques ni crees archivos.")
_ayuda = {}  # (ruta, mtime, tamaño) → texto de --help: si el CLI se actualiza, se vuelve a preguntar


def _preparar_path():
    """Las apps no heredan el PATH de la terminal: agrega donde suelen quedar los CLI de IA (Mac, Linux y Windows)."""
    extra = [os.path.join(CASA, ".local", "bin"), os.path.join(CASA, ".claude", "local"), os.path.join(CASA, ".npm-global", "bin"),
             os.path.join(CASA, ".volta", "bin"), os.path.join(CASA, ".bun", "bin"), os.path.join(CASA, ".codex", "bin"),
             "/opt/homebrew/bin", "/usr/local/bin"]
    nvm = os.path.join(CASA, ".nvm", "versions", "node")
    if os.path.isdir(nvm):
        extra += [os.path.join(nvm, v, "bin") for v in sorted(os.listdir(nvm), reverse=True)]
    if os.name == "nt":
        extra += [os.path.join(os.environ.get("APPDATA", ""), "npm"), os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "claude")]
    actual = os.environ.get("PATH", "").split(os.pathsep)
    os.environ["PATH"] = os.pathsep.join(actual + [d for d in extra if os.path.isdir(d) and d not in actual])


_preparar_path()


# ── Qué IA ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def comando(ia):
    return next((r for r in map(shutil.which, IAS[ia][0]) if r), None)


def lista():
    return [{"id": k, "nombre": v[1], "instalada": comando(k) is not None} for k, v in IAS.items()]


def elegida():
    ia = nucleo.config().get("ia")
    return ia if ia in IAS else "claude"


def nombre(ia=None):
    return IAS[ia or elegida()][1]


def _es_agy(cmd):
    return os.path.basename(cmd).lower().split(".")[0] in ("agy", "antigravity")


def puede_leer(ia=None):
    """Si la IA sabe leer una carpeta con permisos de solo lectura (material o revisión a fondo)."""
    ia = ia or elegida()
    if ia != "gemini":
        return True
    c = comando(ia)
    return bool(c and _es_agy(c))


def _soporta(cmd, opcion):
    """Si el CLI conoce una opción. Se pregunta una vez por versión del comando (ruta, fecha y tamaño), sin las variables de la
    app; nunca se reintenta quitando protecciones."""
    try:
        st = os.stat(cmd)
        clave = (cmd, st.st_mtime_ns, st.st_size)
    except OSError:
        clave = (cmd, 0, 0)
    if clave not in _ayuda:
        try:
            r = subprocess.run([cmd, "--help"], stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8",
                               errors="replace", timeout=20, env=_entorno())
            _ayuda[clave] = (r.stdout or "") + (r.stderr or "")
        except (OSError, subprocess.SubprocessError):
            _ayuda[clave] = ""
    return re.search(r"(?<![\w-])" + re.escape(opcion) + r"(?![\w-])", _ayuda[clave]) is not None


def _conoce_ayuda(cmd):
    """True si se pudo leer su --help (sin eso no se puede saber qué conoce: corre con todas las protecciones y que el CLI decida)."""
    return any(v for k, v in _ayuda.items() if k[0] == cmd)


def _entorno():
    """La IA no recibe las variables de la app (rutas, credenciales, modos de prueba): solo lo necesario para correr."""
    p = nucleo.prefijo().upper()
    return {k: v for k, v in os.environ.items() if not k.upper().startswith(p)}  # en Windows las variables no distinguen mayúsculas


def _sin_secretos(no_leer):
    reglas = []
    for patron in no_leer:
        p = patron.rstrip("/") + ("/**" if patron.endswith("/") else "")
        reglas += [f"Read(**/{p})", f"Read(./{p})"]
    return reglas


# ── Lo que conoce Claude ─────────────────────────────────────────────────────────────────────────────────────────────────────

_versiones = {}      # clave del comando → (X, Y, Z) o None
_desconocidas = {}   # clave del comando → herramientas que esa versión dijo no conocer (lo aprende de su propio aviso)
_AVISO_DESCONOCIDA = re.compile(r'Permission deny rule "([A-Za-z]+)" matches no known tool')


def _clave(cmd):
    try:
        st = os.stat(cmd)
        return (cmd, st.st_mtime_ns, st.st_size)
    except OSError:
        return (cmd, 0, 0)


def _version(cmd):
    """(X, Y, Z) de `<cmd> --version`, una vez por versión del comando; None si no se pudo saber."""
    clave = _clave(cmd)
    if clave not in _versiones:
        try:
            r = subprocess.run([cmd, "--version"], stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8",
                               errors="replace", timeout=20, env=_entorno())
            m = re.search(r"(\d+)\.(\d+)\.(\d+)", (r.stdout or "") + (r.stderr or ""))
            _versiones[clave] = tuple(int(x) for x in m.groups()) if m else None
        except (OSError, subprocess.SubprocessError):
            _versiones[clave] = None
    return _versiones[clave]


def _archivo_desconocidas():
    return os.path.join(nucleo.carpeta_datos(), "ia-herramientas.json")


def _prohibido(cmd):
    """Lo que nunca puede hacer Claude, sin las herramientas que su versión no conoce. Solo se quita una si el CLI conoce --tools
    (las demás herramientas ni se cargan): con un CLI sin --tools se prohíbe todo, aunque avise."""
    if not _soporta(cmd, "--tools"):
        return list(PROHIBIDO)
    v = _version(cmd)
    fuera = {h for h, desde in RETIRADAS.items() if v and v >= desde}
    clave = "%s@%s" % (os.path.basename(cmd), ".".join(map(str, v)) if v else "?")
    aprendidas = nucleo.leer_json(_archivo_desconocidas(), {}, maximo=64 * 1024)
    if isinstance(aprendidas, dict) and isinstance(aprendidas.get(clave), list):
        fuera |= {h for h in aprendidas[clave] if h in PROHIBIDO}
    fuera |= _desconocidas.get(_clave(cmd), set())
    return [h for h in PROHIBIDO if h not in fuera]


def _aprender(cmd, stderr):
    """Si Claude avisó que no conoce una herramienta prohibida, la próxima vez no se le pide (solo las de PROHIBIDO, y solo si
    conoce --tools: ver _prohibido)."""
    nuevas = {h for h in _AVISO_DESCONOCIDA.findall(stderr or "") if h in PROHIBIDO}
    if not nuevas or not cmd:
        return
    _desconocidas.setdefault(_clave(cmd), set()).update(nuevas)
    v = _version(cmd) if _soporta(cmd, "--tools") else None
    if not v:
        return
    clave = "%s@%s" % (os.path.basename(cmd), ".".join(map(str, v)))
    try:
        d = nucleo.leer_json(_archivo_desconocidas(), {}, maximo=64 * 1024)
        d = d if isinstance(d, dict) else {}
        d[clave] = sorted(set(d.get(clave) or []) | nuevas)
        nucleo.escribir_json(_archivo_desconocidas(), dict(list(d.items())[-20:]))
    except (OSError, RuntimeError):
        pass


def _sin_avisos(texto):
    """El error del CLI sin el aviso de reglas de permisos (no explica nada a la persona)."""
    return [l.strip() for l in (texto or "").splitlines() if l.strip() and "Permission deny rule" not in l]


_ayuda_exec = {}  # clave del comando → texto de `codex exec --help`


def _codex_json(cmd):
    """Si `codex exec` conoce --json (versiones viejas no): una vez por versión del comando."""
    clave = _clave(cmd)
    if clave not in _ayuda_exec:
        try:
            r = subprocess.run([cmd, "exec", "--help"], stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8",
                               errors="replace", timeout=20, env=_entorno())
            _ayuda_exec[clave] = (r.stdout or "") + (r.stderr or "")
        except (OSError, subprocess.SubprocessError):
            _ayuda_exec[clave] = ""
    return re.search(r"(?<![\w-])--json(?![\w-])", _ayuda_exec[clave]) is not None


# ── Armar el comando (un solo lugar para todas las protecciones) ─────────────────────────────────────────────────────────────

def _armar(prompt, ia, tmp, *, archivos=(), leer=None, no_leer=(), modelo=None, vivo=False):
    """Cómo correr la IA en la carpeta temporal `tmp`: {cmd, entrada, env, salida, formato, comando}. Lo usan `ejecutar` y
    `preguntar_vivo`: las protecciones se arman SOLO aquí. `formato`: "texto", "claude-json" o "codex-json" (en vivo, si el CLI
    sabe contar lo que hace). Lanza FileNotFoundError (no está) o VersionVieja (le falta una protección)."""
    cmd0 = comando(ia)
    if not cmd0:
        raise FileNotFoundError(IAS[ia][0][0])
    if leer and not (os.path.isdir(leer) and puede_leer(ia)):
        leer = None
    entorno = _entorno()
    copias = []
    for k, a in enumerate(archivos):
        destino = os.path.join(tmp, f"material-{k + 1}{os.path.splitext(a)[1].lower()}")
        try:
            shutil.copy2(a, destino)
            copias.append(destino)
        except OSError:
            pass
    if copias and not puede_leer(ia):
        copias = []
    # La IA SIEMPRE corre en la carpeta temporal: si corriera dentro de la carpeta que revisa, su CLI cargaría la configuración de
    # ese repo (AGENTS.md, GEMINI.md, .claude/settings.json con hooks que ejecutan comandos). La carpeta solo se agrega para leer, y
    # se le dice dónde está en el pedido (por la entrada estándar o en un archivo, nunca como argumento).
    if leer:
        prompt = f"La carpeta que puedes leer (solo leer) está en: {leer}\n\n" + prompt
    r = {"entrada": prompt, "env": entorno, "salida": None, "formato": "texto", "comando": cmd0}

    if ia == "codex":
        salida = os.path.join(tmp, "respuesta.txt")
        json_ = vivo and _codex_json(cmd0)
        cmd = [cmd0, "exec", "--skip-git-repo-check", "-s", "read-only", "-C", tmp, "-o", salida, *(["--json"] if json_ else [])]
        cmd += [x for c in copias if c.endswith(IMAGENES) for x in ("-i", c)]
        cmd += (["-m", modelo] if modelo else []) + ["-"]
        return {**r, "cmd": cmd, "salida": salida, "formato": "codex-json" if json_ else "texto"}

    if ia == "gemini" and _es_agy(cmd0):
        # Antigravity no lee la entrada estándar: el pedido va SIEMPRE en un archivo; en -p solo va una frase fija.
        with open(os.path.join(tmp, "instrucciones.md"), "w", encoding="utf-8") as f:
            f.write(prompt)
        cmd = [cmd0, "--output-format", "text", "--sandbox", "--add-dir", tmp, *(["--add-dir", leer] if leer else []),
               *(["--model", modelo] if modelo else []), "-p", INSTRUCCION_ARCHIVO]
        return {**r, "cmd": cmd, "entrada": None}

    if ia == "gemini":
        cmd = [cmd0, "-p", "Responde a las instrucciones de arriba. Entrega solo el resultado pedido.", "-o", "text",
               *(["-m", modelo] if modelo else [])]
        return {**r, "cmd": cmd}

    # Claude Code: sin servidores MCP de la persona y sin su memoria. Sin material ni carpeta: ninguna herramienta. Con material o
    # carpeta: solo leer, y nunca lo que escribe, ejecuta o sale a internet, ni los secretos. Las protecciones obligatorias: si el
    # CLI dice que no las conoce, no se corre (se pide actualizarlo).
    for obligatoria in ("--strict-mcp-config", "--disallowedTools"):
        if not _soporta(cmd0, obligatoria) and _conoce_ayuda(cmd0):
            raise VersionVieja(obligatoria)
    flujo = vivo and _soporta(cmd0, "stream-json")
    cmd = [cmd0, "-p", "--output-format", *(["stream-json", "--verbose"] if flujo else ["text"]), "--strict-mcp-config"]
    if leer or copias:
        if leer:
            cmd += ["--add-dir", leer]
        cmd += ["--allowedTools", "Read,Glob,Grep", "--disallowedTools", ",".join(_prohibido(cmd0) + _sin_secretos(no_leer))]
        if _soporta(cmd0, "--tools"):
            cmd += ["--tools", "Read,Glob,Grep"]  # además, las demás herramientas ni siquiera se cargan
    else:
        cmd += ["--disallowedTools", "*"]
        if _soporta(cmd0, "--tools"):
            cmd += ["--tools", ""]
    if modelo:
        cmd += ["--model", modelo]
    if _soporta(cmd0, "--safe-mode"):
        cmd.append("--safe-mode")
    if _soporta(cmd0, "--setting-sources"):
        cmd += ["--setting-sources", "user"]  # nunca la configuración (ni los hooks) de un proyecto
    return {**r, "cmd": cmd, "env": {**entorno, **SIN_MEMORIA_CLAUDE}, "formato": "claude-json" if flujo else "texto"}


# ── Correr ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def ejecutar(prompt, *, ia=None, timeout=600, archivos=(), leer=None, no_leer=(), modelo=None):
    """Corre la IA y devuelve un CompletedProcess (stdout = respuesta).

    archivos: material que la IA puede leer (se copian a la carpeta temporal como material-N.ext).
    leer: una carpeta que la IA puede LEER entera (revisión a fondo), nunca lo de `no_leer`. Se ignora si la IA no sabe leer.
    modelo: nombre de modelo para el CLI, si la app deja elegirlo.
    """
    ia = ia or elegida()
    with tempfile.TemporaryDirectory(prefix=f"{nucleo.app()['id']}-ia-") as tmp:
        c = _armar(prompt, ia, tmp, archivos=archivos, leer=leer, no_leer=no_leer, modelo=modelo)
        r = subprocess.run(c["cmd"], input=c["entrada"], stdin=subprocess.DEVNULL if c["entrada"] is None else None, text=True,
                           encoding="utf-8", capture_output=True, timeout=timeout, cwd=tmp, env=c["env"])
        if ia == "claude":
            _aprender(c["comando"], r.stderr)
        if c["salida"]:
            texto = _leer_salida(c["salida"])
            return subprocess.CompletedProcess(c["cmd"], r.returncode, texto, r.stderr)
        return r


def _leer_salida(ruta):
    """Lo que el CLI dejó en su archivo de salida (Codex -o), cerrando el archivo (sin ResourceWarning); "" si no está."""
    try:
        with open(ruta, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def _errores(ia):
    valores = {"ia": nombre(ia), "detalle": "", "app": nucleo.app()["nombre"]}

    def error(codigo, detalle=""):
        e = {"codigo": codigo, "plantilla": ERRORES[codigo], "valores": {**valores, "detalle": detalle}}
        if codigo in CON_AYUDA and ayuda():
            e["ayuda"] = ayuda()  # la frase propia de la app («Revisa en Ajustes → Tu IA.»), su clave en el en.json de la app
        return e
    return error


def preguntar(prompt, **opciones):
    """Devuelve (texto, error). error es None o {"codigo", "plantilla", "valores"}: la interfaz hace Tp(plantilla, valores) (la
    plantilla es la frase en español, clave de traducción) y no necesita copiar ERRORES; frase(error) la da en español."""
    error = _errores(opciones.get("ia") or elegida())
    try:
        r = ejecutar(prompt, **opciones)
    except FileNotFoundError:
        return "", error("no_instalada")
    except subprocess.TimeoutExpired:
        return "", error("demora")
    except VersionVieja:
        return "", error("actualizar")
    if r.returncode != 0 or not (r.stdout or "").strip():
        detalle = (_sin_avisos(r.stderr)[-1:] or [""])[0][:300]
        return "", error("sin_respuesta" if detalle else "sin_respuesta_corta", detalle)
    return r.stdout, None


# ── En vivo: lo que lee y «Detener» ──────────────────────────────────────────────────────────────────────────────────────────

def _evento_claude(linea, al_evento):
    """Una línea de `claude -p --output-format stream-json --verbose`: lo que lee (Read/Glob/Grep) va a `al_evento`; la línea final
    {"type": "result"} trae la respuesta. Devuelve (texto, es_error) si es la final; si no, None."""
    try:
        x = json.loads(linea)
    except ValueError:
        return None
    if not isinstance(x, dict):
        return None
    if x.get("type") == "result":
        return str(x.get("result") or ""), bool(x.get("is_error"))
    if x.get("type") == "assistant" and isinstance(x.get("message"), dict):
        for c in x["message"].get("content") or []:
            if isinstance(c, dict) and c.get("type") == "tool_use" and isinstance(c.get("input"), dict):
                h, e = str(c.get("name") or ""), c["input"]
                if h == "Read" and isinstance(e.get("file_path"), str):
                    al_evento({"t": "lee", "ruta": e["file_path"][:1000]})
                elif h in ("Glob", "Grep") and isinstance(e.get("pattern"), str):
                    al_evento({"t": "busca", "patron": e["pattern"][:200], **({"ruta": e["path"][:1000]} if isinstance(e.get("path"), str) else {})})
    return None


#: Comandos de lectura que Codex corre (en su sandbox de solo lectura): de ahí se deduce qué archivo mira.
_LEE_CODEX = ("cat", "sed", "head", "tail", "nl", "less", "bat", "wc")
_BUSCA_CODEX = ("rg", "grep", "find", "ls", "fd", "git")


def _evento_codex(linea, al_evento):
    """Una línea de `codex exec --json` (JSONL). Los formatos cambian entre versiones: se busca un comando en lo que venga y, si es
    de lectura, el último argumento que parece una ruta. La respuesta viene en el archivo de -o."""
    try:
        x = json.loads(linea)
    except ValueError:
        return
    if not isinstance(x, dict):
        return
    item = x.get("item") if isinstance(x.get("item"), dict) else x.get("msg") if isinstance(x.get("msg"), dict) else x
    if str(x.get("type") or item.get("type") or "") in ("item.completed", "exec_command_end"):
        return
    cmd = item.get("command")
    if isinstance(cmd, list):
        partes = [str(p) for p in cmd]
    elif isinstance(cmd, str):
        partes = cmd.split()
    else:
        return
    # «bash -lc 'cat src/a.py'» → lo de adentro
    if len(partes) >= 3 and os.path.basename(partes[0]) in ("bash", "sh", "zsh") and partes[1] in ("-lc", "-c"):
        partes = " ".join(partes[2:]).strip("'\"").split()
    if not partes:
        return
    prog = os.path.basename(partes[0])
    rutas = [p.strip("'\"") for p in partes[1:] if not p.startswith("-") and ("/" in p or "." in p)]
    if prog in _LEE_CODEX and rutas:
        al_evento({"t": "lee", "ruta": rutas[-1][:1000]})
    elif prog in _BUSCA_CODEX:
        al_evento({"t": "busca", "patron": " ".join(partes[1:])[:200]})


def detenido(error):
    """Si el error es que la persona detuvo la IA (no es una falla)."""
    return isinstance(error, dict) and error.get("codigo") == "detenido"


def preguntar_vivo(prompt, *, ia=None, timeout=600, archivos=(), leer=None, no_leer=(), modelo=None, al_evento=None, detener=None):
    """Como `preguntar`, pero cuenta lo que la IA va haciendo: `al_evento({"t": "lee" | "busca", …})` por cada archivo que lee o
    búsqueda que hace (Claude y Codex; Gemini no lo cuenta). `detener()`: si devuelve True, se corta la IA. Devuelve (texto, error)
    con error None o {codigo, plantilla, valores}; codigo "detenido" si se detuvo (ver `detenido(error)`)."""
    ia = ia or elegida()
    error = _errores(ia)
    al_evento = al_evento or (lambda e: None)
    with tempfile.TemporaryDirectory(prefix=f"{nucleo.app()['id']}-ia-") as tmp:
        try:
            c = _armar(prompt, ia, tmp, archivos=archivos, leer=leer, no_leer=no_leer, modelo=modelo, vivo=True)
            p = subprocess.Popen(c["cmd"], stdin=subprocess.PIPE if c["entrada"] is not None else subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=tmp, env=c["env"])
        except FileNotFoundError:
            return "", error("no_instalada")
        except VersionVieja:
            return "", error("actualizar")
        except OSError as ex:
            return "", error("sin_respuesta", str(ex)[:300])
        err, lineas, final = [], [], [None]

        def escribir_entrada():
            try:
                if c["entrada"] is not None:
                    p.stdin.write(c["entrada"].encode("utf-8"))
                    p.stdin.close()
            except OSError:
                pass

        def leer_salida():
            for crudo in iter(p.stdout.readline, b""):
                linea = crudo.decode("utf-8", "replace")
                if c["formato"] == "claude-json":
                    r = _evento_claude(linea, al_evento)
                    if r is not None:
                        final[0] = r
                else:
                    if c["formato"] == "codex-json":
                        _evento_codex(linea, al_evento)
                    elif len(lineas) < 200_000:
                        lineas.append(linea)

        def leer_error():
            for crudo in iter(p.stderr.readline, b""):
                if len(err) < 400:
                    err.append(crudo.decode("utf-8", "replace"))

        hilos = [threading.Thread(target=f, daemon=True) for f in (escribir_entrada, leer_salida, leer_error)]
        for h in hilos:
            h.start()
        limite = time.monotonic() + timeout
        motivo = None
        while p.poll() is None:
            if detener and detener():
                motivo = "detenido"
            elif time.monotonic() > limite:
                motivo = "demora"
            if motivo:
                p.terminate()
                try:
                    p.wait(5)
                except subprocess.TimeoutExpired:
                    p.kill()
                break
            time.sleep(0.25)
        p.wait()
        for h in hilos[1:]:
            h.join(5)
        for tubo in (p.stdin, p.stdout, p.stderr):  # cerrar las tuberías (sin ResourceWarning al terminar)
            try:
                if tubo:
                    tubo.close()
            except OSError:
                pass
        if ia == "claude":
            _aprender(c["comando"], "".join(err))
        if motivo:
            return "", error(motivo)
        if c["formato"] == "claude-json":
            texto, es_error = final[0] if final[0] else ("", True)
        elif c["salida"]:
            texto, es_error = _leer_salida(c["salida"]), False
        else:
            texto, es_error = "".join(lineas), False
        if p.returncode != 0 or es_error or not texto.strip():
            utiles = _sin_avisos("".join(err))
            detalle = (texto.strip()[:300] if es_error and texto.strip() else "") or (utiles[-1][:300] if utiles else "")
            return "", error("sin_respuesta" if detalle else "sin_respuesta_corta", detalle)
        return texto, None


def frase(error):
    """El error en español, para scripts y registros (la interfaz traduce con el código)."""
    if not error:
        return ""
    texto = error.get("plantilla") or ERRORES.get(error.get("codigo"), "")
    for k, v in (error.get("valores") or {}).items():
        texto = texto.replace("{" + k + "}", str(v))
    return (texto.strip() + " " + error.get("ayuda", "")).strip()


def probar(ia):
    if ia not in IAS:
        return {"ia": ia, "ok": False, "codigo": "desconocida", "plantilla": ERRORES["desconocida"], "valores": {},
                "error": ERRORES["desconocida"]}
    _, error = preguntar("Responde solo con la palabra: listo", ia=ia, timeout=120)
    if error:
        # Se prueba desde «Tu IA» (bienvenida o Ajustes): «Revisa en Ajustes → Tu IA» de app.json sobra ahí.
        error = {k: v for k, v in error.items() if k != "ayuda"}
        return {"ia": ia, "ok": False, **error, "error": frase(error)}
    return {"ia": ia, "ok": True}


if __name__ == "__main__":
    nucleo.script({
        "probar": lambda d: probar(d.get("ia") if isinstance(d.get("ia"), str) else elegida()),
        "lista": lambda d: {"ias": lista(), "elegida": elegida()},
    }, __doc__)
