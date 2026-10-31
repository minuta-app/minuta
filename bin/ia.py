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
- Los errores salen como código + valores, para que la interfaz los traduzca (`ERRORES` trae el texto en español).

Uso: ia.py probar <entrada.json {"ia": "claude"}> <salida.json>   → {ia, ok, error?, codigo?}
     ia.py lista <salida.json>                                     → {ias: [{id, nombre, instalada}], elegida}
"""
import os
import re
import shutil
import subprocess
import tempfile

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
}




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


# ── Correr ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def ejecutar(prompt, *, ia=None, timeout=600, archivos=(), leer=None, no_leer=(), modelo=None):
    """Corre la IA y devuelve un CompletedProcess (stdout = respuesta).

    archivos: material que la IA puede leer (se copian a la carpeta temporal como material-N.ext).
    leer: una carpeta que la IA puede LEER entera (revisión a fondo), nunca lo de `no_leer`. Se ignora si la IA no sabe leer.
    modelo: nombre de modelo para el CLI, si la app deja elegirlo.
    """
    ia = ia or elegida()
    cmd0 = comando(ia)
    if not cmd0:
        raise FileNotFoundError(IAS[ia][0][0])
    if leer and not (os.path.isdir(leer) and puede_leer(ia)):
        leer = None
    entorno = _entorno()
    with tempfile.TemporaryDirectory(prefix=f"{nucleo.app()['id']}-ia-") as tmp:
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
        # La IA SIEMPRE corre en la carpeta temporal: si corriera dentro de la carpeta que revisa, su CLI cargaría la configuración
        # de ese repo (AGENTS.md, GEMINI.md, .claude/settings.json con hooks que ejecutan comandos). La carpeta solo se agrega
        # para leer, y se le dice dónde está en el pedido (por la entrada estándar, nunca como argumento).
        carpeta = tmp
        if leer:
            prompt = f"La carpeta que puedes leer (solo leer) está en: {leer}\n\n" + prompt

        if ia == "codex":
            salida = os.path.join(tmp, "respuesta.txt")
            cmd = [cmd0, "exec", "--skip-git-repo-check", "-s", "read-only", "-C", carpeta, "-o", salida]
            cmd += [x for c in copias if c.endswith(IMAGENES) for x in ("-i", c)]
            cmd += (["-m", modelo] if modelo else []) + ["-"]
            r = subprocess.run(cmd, input=prompt, text=True, encoding="utf-8", capture_output=True, timeout=timeout, cwd=carpeta, env=entorno)
            texto = open(salida, encoding="utf-8").read() if os.path.exists(salida) else ""
            return subprocess.CompletedProcess(cmd, r.returncode, texto, r.stderr)

        if ia == "gemini" and _es_agy(cmd0):
            # Antigravity no lee la entrada estándar: el pedido va SIEMPRE en un archivo; en -p solo va una frase fija.
            with open(os.path.join(tmp, "instrucciones.md"), "w", encoding="utf-8") as f:
                f.write(prompt)
            cmd = [cmd0, "--output-format", "text", "--sandbox", "--add-dir", tmp, *(["--add-dir", leer] if leer else []),
                   *(["--model", modelo] if modelo else []), "-p", INSTRUCCION_ARCHIVO]
            return subprocess.run(cmd, stdin=subprocess.DEVNULL, text=True, encoding="utf-8", capture_output=True, timeout=timeout,
                                  cwd=carpeta, env=entorno)

        if ia == "gemini":
            cmd = [cmd0, "-p", "Responde a las instrucciones de arriba. Entrega solo el resultado pedido.", "-o", "text",
                   *(["-m", modelo] if modelo else [])]
            return subprocess.run(cmd, input=prompt, text=True, encoding="utf-8", capture_output=True, timeout=timeout, cwd=tmp, env=entorno)

        # Claude Code: sin servidores MCP de la persona y sin su memoria. Sin material ni carpeta: ninguna herramienta. Con material o
        # carpeta: solo leer, y nunca lo que escribe, ejecuta o sale a internet, ni los secretos.
        # Las protecciones obligatorias: si el CLI dice que no las conoce, no se corre (se pide actualizarlo).
        for obligatoria in ("--strict-mcp-config", "--disallowedTools"):
            if not _soporta(cmd0, obligatoria) and _conoce_ayuda(cmd0):
                raise VersionVieja(obligatoria)
        cmd = [cmd0, "-p", "--output-format", "text", "--strict-mcp-config"]
        if leer or copias:
            for d in [leer] if leer else []:
                cmd += ["--add-dir", d]
            cmd += ["--allowedTools", "Read,Glob,Grep", "--disallowedTools", ",".join(PROHIBIDO + _sin_secretos(no_leer))]
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
        return subprocess.run(cmd, input=prompt, text=True, encoding="utf-8", capture_output=True, timeout=timeout, cwd=carpeta,
                              env={**entorno, **SIN_MEMORIA_CLAUDE})


def preguntar(prompt, **opciones):
    """Devuelve (texto, error). error es None o {"codigo", "plantilla", "valores"}: la interfaz hace Tp(plantilla, valores) (la
    plantilla es la frase en español, clave de traducción) y no necesita copiar ERRORES; frase(error) la da en español."""
    ia = opciones.get("ia") or elegida()
    valores = {"ia": nombre(ia), "detalle": "", "app": nucleo.app()["nombre"]}
    error = lambda codigo: {"codigo": codigo, "plantilla": ERRORES[codigo], "valores": valores}  # noqa: E731
    try:
        r = ejecutar(prompt, **opciones)
    except FileNotFoundError:
        return "", error("no_instalada")
    except subprocess.TimeoutExpired:
        return "", error("demora")
    except VersionVieja:
        return "", error("actualizar")
    if r.returncode != 0 or not (r.stdout or "").strip():
        valores["detalle"] = ((r.stderr or "").strip().splitlines()[-1:] or [""])[0][:300]
        return "", error("sin_respuesta" if valores["detalle"] else "sin_respuesta_corta")
    return r.stdout, None


def frase(error):
    """El error en español, para scripts y registros (la interfaz traduce con el código)."""
    if not error:
        return ""
    texto = ERRORES[error["codigo"]]
    for k, v in error.get("valores", {}).items():
        texto = texto.replace("{" + k + "}", str(v))
    return texto.strip()


def probar(ia):
    if ia not in IAS:
        return {"ia": ia, "ok": False, "codigo": "desconocida", "plantilla": ERRORES["desconocida"], "valores": {},
                "error": ERRORES["desconocida"]}
    _, error = preguntar("Responde solo con la palabra: listo", ia=ia, timeout=120)
    if error:
        return {"ia": ia, "ok": False, "codigo": error["codigo"], "plantilla": error["plantilla"], "valores": error["valores"],
                "error": frase(error)}
    return {"ia": ia, "ok": True}


if __name__ == "__main__":
    nucleo.script({
        "probar": lambda d: probar(d.get("ia") if isinstance(d.get("ia"), str) else elegida()),
        "lista": lambda d: {"ias": lista(), "elegida": elegida()},
    }, __doc__)
