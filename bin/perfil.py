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

#: IA del usuario, con su propia cuenta: "claude" (Claude Code), "codex" (ChatGPT) o "gemini" (Gemini CLI).
IAS = {"claude": ("claude", "Claude"), "codex": ("codex", "ChatGPT (Codex)"), "gemini": ("gemini", "Gemini")}
IA = (P.get("ia") or "claude").strip().lower()
if IA not in IAS:
    IA = "claude"
NOMBRE_IA = IAS[IA][1]
#: Ruta del CLI elegido (se mantiene el nombre CLAUDE por compatibilidad con scripts antiguos).
CLAUDE = shutil.which(IAS[IA][0]) or IAS[IA][0]


def ejecutar_ia(prompt, timeout=600, cwd=None):
    """Le pasa el prompt a la IA del usuario y devuelve un CompletedProcess (stdout = respuesta en texto).
    Corre en una carpeta temporal vacía: la IA solo ve el texto que le damos, no archivos del computador."""
    modelo = os.environ.get("MINUTA_MODELO") if IA == "claude" else None
    with tempfile.TemporaryDirectory(prefix="minuta-ia-") as tmp:
        donde = cwd if (cwd and IA == "claude") else tmp
        if IA == "codex":
            salida = os.path.join(tmp, "respuesta.txt")
            # Solo lectura y sin repositorio: Codex responde con texto y no toca nada.
            cmd = [CLAUDE, "exec", "--skip-git-repo-check", "-s", "read-only", "-C", tmp, "-o", salida, "-"]
            r = subprocess.run(cmd, input=prompt, text=True, encoding="utf-8", capture_output=True, timeout=timeout, cwd=tmp)
            texto = ""
            if os.path.exists(salida):
                with open(salida, encoding="utf-8") as f:
                    texto = f.read()
            return subprocess.CompletedProcess(cmd, r.returncode, texto or "", r.stderr)
        if IA == "gemini":
            cmd = [CLAUDE, "-p", "Responde a las instrucciones de arriba. Entrega solo el resultado pedido.", "-o", "text"]
        else:
            cmd = [CLAUDE, "-p", "--output-format", "text"] + (["--model", modelo] if modelo else [])
        return subprocess.run(cmd, input=prompt, text=True, encoding="utf-8", capture_output=True, timeout=timeout, cwd=donde)


def es_usuario(nombre):
    """¿Este nombre (de un responsable o hablante) es el propio usuario?"""
    n = (nombre or "").strip().lower()
    if not n:
        return False
    propios = {"yo", P["nombre"].strip().lower(), P["nombre_completo"].strip().lower()} - {""}
    return n in propios or any(n.startswith(p + " ") for p in propios if p != "yo")
