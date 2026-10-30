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
import shutil
import subprocess
import tempfile

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


def _preparar_path():
    """La app no siempre hereda el PATH de la terminal: agrega donde suelen quedar los instaladores (Mac, Linux y Windows).
    También sirve para que los CLI instalados con npm encuentren `node`."""
    extra = [os.path.join(HOME, ".local", "bin"), os.path.join(HOME, ".claude", "local"), os.path.join(HOME, ".npm-global", "bin"),
             os.path.join(HOME, ".volta", "bin"), os.path.join(HOME, ".bun", "bin"), "/opt/homebrew/bin", "/usr/local/bin"]
    extra.append(os.path.join(HOME, ".codex", "bin"))
    nvm = os.path.join(HOME, ".nvm", "versions", "node")
    if os.path.isdir(nvm):
        extra += [os.path.join(nvm, v, "bin") for v in sorted(os.listdir(nvm), reverse=True)]
    if os.name == "nt":
        extra += [os.path.join(os.environ.get("APPDATA", ""), "npm"), os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "claude")]
    os.environ["PATH"] = os.pathsep.join([os.environ.get("PATH", "")] + [d for d in extra if os.path.isdir(d)])


_preparar_path()

#: IA del usuario, con su propia cuenta: "claude" (Claude Code), "codex" (ChatGPT) o "gemini".
#: Gemini: primero Antigravity CLI (`agy`, el reemplazo de Google para cuentas personales desde junio de 2026)
#: y, si no está, el Gemini CLI antiguo (`gemini`, que hoy solo sirve con una clave de API de pago).
IAS = {"claude": (("claude",), "Claude"), "codex": (("codex",), "ChatGPT (Codex)"), "gemini": (("agy", "gemini"), "Gemini")}
IA = (P.get("ia") or "claude").strip().lower()
if IA not in IAS:
    IA = "claude"
NOMBRE_IA = IAS[IA][1]
#: Ruta del CLI elegido (se mantiene el nombre CLAUDE por compatibilidad con scripts antiguos).
CLAUDE = next((r for r in map(shutil.which, IAS[IA][0]) if r), IAS[IA][0][0])
#: Antigravity CLI no lee la entrada estándar (el pedido va en un archivo: ver ejecutar_ia).
ES_AGY = os.path.basename(CLAUDE).lower().split(".")[0] in ("agy", "antigravity")


#: Claude Code sin herramientas ni servidores MCP: solo lee el texto que le damos y responde con texto. Así, aunque una
#: transcripción traiga instrucciones escondidas (lo que dijo alguien en la reunión, un correo leído en voz alta…), la IA no
#: puede ejecutar comandos, leer o cambiar archivos, ni usar otras cuentas conectadas (correo, calendario…).
CLAUDE_SOLO_TEXTO = ["--strict-mcp-config", "--tools", ""]  # --tools al final: acepta varios valores
#: Claude Code carga la memoria de la persona (CLAUDE.md, memoria automática) aunque corra sin herramientas: esto la apaga.
SIN_MEMORIA_CLAUDE = {"CLAUDE_CODE_DISABLE_CLAUDE_MDS": "1", "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1"}
#: Frase fija para Antigravity: el pedido va en instrucciones.md, nunca como argumento (cualquier programa ve los argumentos).
INSTRUCCION_ARCHIVO = ("Lee el archivo instrucciones.md de esta carpeta y haz exactamente lo que pide. "
                       "Entrega solo el resultado pedido, sin comentarios. No modifiques ni crees archivos.")
#: Si el CLI no conoce una protección, no se corre sin ella: se responde este error (código 3).
IA_DESACTUALIZADA = "Actualiza {ia} para usarla con Minuta: tu versión no permite correrla sin herramientas."
_ayuda = {}


def _soporta(cmd, opcion):
    """Si el CLI conoce una opción. Se pregunta `--help` una vez por comando; nunca se reintenta quitando protecciones.
    Si el CLI no está instalado, sale FileNotFoundError como antes (los scripts ya lo explican)."""
    if cmd not in _ayuda:
        try:
            r = subprocess.run([cmd, "--help"], stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8",
                               errors="replace", timeout=20, env=_entorno())
            _ayuda[cmd] = (r.stdout or "") + (r.stderr or "")
        except FileNotFoundError:
            raise
        except (OSError, subprocess.SubprocessError):
            _ayuda[cmd] = ""
    return re.search(re.escape(opcion) + r"(?![\w-])", _ayuda[cmd]) is not None


def _entorno():
    """La IA no recibe las variables de la app (MINUTA_*: rutas, modos de prueba): solo lo necesario para correr."""
    return {k: v for k, v in os.environ.items() if not k.upper().startswith("MINUTA_")}


def _desactualizada(cmd):
    return subprocess.CompletedProcess(cmd, 3, "", IA_DESACTUALIZADA.replace("{ia}", NOMBRE_IA))


def ejecutar_ia(prompt, timeout=600, cwd=None):
    """Le pasa el prompt a la IA del usuario y devuelve un CompletedProcess (stdout = respuesta en texto).
    Corre siempre en una carpeta temporal vacía (`cwd` se acepta por compatibilidad y se ignora): la IA solo ve el texto
    que le damos, no archivos ni configuraciones de proyecto del computador. El pedido nunca va como argumento."""
    modelo = os.environ.get("MINUTA_MODELO") if IA == "claude" else None  # se lee antes de filtrar el entorno
    entorno = _entorno()
    with tempfile.TemporaryDirectory(prefix="minuta-ia-") as tmp:
        if IA == "codex":
            salida = os.path.join(tmp, "respuesta.txt")
            # Solo lectura y sin repositorio: Codex responde con texto y no toca nada.
            cmd = [CLAUDE, "exec", "--skip-git-repo-check", "-s", "read-only", "-C", tmp, "-o", salida, "-"]
            r = subprocess.run(cmd, input=prompt, text=True, encoding="utf-8", capture_output=True, timeout=timeout, cwd=tmp, env=entorno)
            texto = ""
            if os.path.exists(salida):
                with open(salida, encoding="utf-8") as f:
                    texto = f.read()
            return subprocess.CompletedProcess(cmd, r.returncode, texto or "", r.stderr)
        if IA == "gemini" and os.path.basename(CLAUDE).lower().split(".")[0] in ("agy", "antigravity"):
            # Antigravity no lee la entrada estándar: el pedido va SIEMPRE en un archivo; en -p solo va una frase fija.
            with open(os.path.join(tmp, "instrucciones.md"), "w", encoding="utf-8") as f:
                f.write(prompt)
            cmd = [CLAUDE, "--output-format", "text", "--sandbox", "--add-dir", tmp, "-p", INSTRUCCION_ARCHIVO]
            return subprocess.run(cmd, stdin=subprocess.DEVNULL, text=True, encoding="utf-8", capture_output=True, timeout=timeout,
                                  cwd=tmp, env=entorno)
        if IA == "gemini":
            cmd = [CLAUDE, "-p", "Responde a las instrucciones de arriba. Entrega solo el resultado pedido.", "-o", "text"]
            return subprocess.run(cmd, input=prompt, text=True, encoding="utf-8", capture_output=True, timeout=timeout, cwd=tmp, env=entorno)
        # Claude Code: sin MCP ni herramientas, o no se corre. Un CLI viejo que no conoce --tools usa --disallowedTools "*".
        cmd = [CLAUDE, "-p", "--output-format", "text"] + (["--model", modelo] if modelo else [])
        if not _soporta(CLAUDE, "--strict-mcp-config"):
            return _desactualizada(cmd)
        if _soporta(CLAUDE, "--safe-mode"):
            cmd.append("--safe-mode")
        if _soporta(CLAUDE, "--tools"):
            cmd += CLAUDE_SOLO_TEXTO
        elif _soporta(CLAUDE, "--disallowedTools"):
            cmd += ["--strict-mcp-config", "--disallowedTools", "*"]
        else:
            return _desactualizada(cmd)
        return subprocess.run(cmd, input=prompt, text=True, encoding="utf-8", capture_output=True, timeout=timeout, cwd=tmp,
                              env={**entorno, **SIN_MEMORIA_CLAUDE})


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
