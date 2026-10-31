#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
"""Pieza «transcribir»: audio a texto en el computador con whisper.cpp. Solo biblioteca estándar.

    import transcribir
    segs = transcribir.transcribir("audio.wav", idioma="es", vocabulario="Ana Pérez, Banco Ejemplo")
    # [{"desde": 0.0, "hasta": 2.4, "texto": "Hola, soy Ana."}, …]   (segundos)
    pal = transcribir.transcribir("audio.wav", palabras=True)        # [{"t": "Hola,", "i": 0.0, "f": 0.4}, …]

- **El transcriptor:** `<id>-transcribir` (el binario de la app de Mac, whisper.cpp con Metal y las mismas opciones que
  `whisper-cli`) o `whisper-cli` (Windows y Linux). Se busca en `<ID>_PROGRAMAS` / `<ID>_HERRAMIENTAS` (lo pone el host), en
  `bin/` de la app y en el sistema.
- **El vocabulario** (nombres, marcas: lo que escribió la persona) **nunca va como argumento**: cualquier programa del computador ve
  los argumentos. `<id>-transcribir` lo lee con `--prompt-archivo`; `whisper-cli` (v1.7.4+) con su archivo de argumentos oficial
  `whisper-cli @archivo` (una opción por línea). Va en una sola línea (un salto de línea no puede colar otra opción), en un temporal
  0600 fuera de las carpetas de la persona, que se borra siempre al terminar.
- **Modelos** (`MODELOS`): los mismos en todas las apps, con su tamaño y su SHA-256 fijos. Los descarga el host (verificados);
  aquí `verificar(id)` los revisa y `ruta_modelo(id)` dice dónde están (`<carpeta de datos>/modelos`).
- **VAD** (detector de voz, Silero): si está descargado, whisper salta los silencios (menos inventos y más rápido).
- **Limpieza:** se quitan las marcas ([música], (ruido)), las frases que whisper inventa en silencio («Gracias por ver»,
  «Subtítulos realizados por la comunidad de Amara.org»…), los bucles (la misma frase 3 veces seguidas) y, si se pasa la energía
  del audio (`energia(wav)`), lo que cae en silencio.

Uso: transcribir.py modelos <salida.json>                       → {ok, modelos: [{id, archivo, bytes, sha256, url, descargado}]}
     transcribir.py verificar <entrada {id}> <salida.json>      → {ok, id, valido}
"""
import array
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import unicodedata
import wave

import nucleo

HF = "https://huggingface.co/"
#: id → modelo. Los mismos archivos y huellas en todas las apps de la familia.
MODELOS = {
    "turbo": {"archivo": "ggml-large-v3-turbo-q5_0.bin", "bytes": 574_041_195,
              "sha256": "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2", "repo": "ggerganov/whisper.cpp",
              "nombre": "Preciso", "detalle": "El mejor resultado; recomendado con 8 GB de RAM o más."},
    "small": {"archivo": "ggml-small-q5_1.bin", "bytes": 190_085_487,
              "sha256": "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb", "repo": "ggerganov/whisper.cpp",
              "nombre": "Liviano", "detalle": "Más rápido y pequeño; para equipos con poca memoria."},
    "vad": {"archivo": "ggml-silero-v5.1.2.bin", "bytes": 885_098,
            "sha256": "29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf", "repo": "ggml-org/whisper-vad",
            "nombre": "Detector de voz", "detalle": "Salta los silencios: menos inventos y más rápido."},
}
SR = 16000
#: Lo que whisper inventa cuando hay silencio, ruido o música (créditos de los videos con que se entrenó). Ya normalizado.
ALUCINACIONES = {
    "thank you", "thanks for watching", "thank you for watching", "thank you very much", "bye", "you",
    "gracias", "muchas gracias", "gracias por ver", "gracias por ver el video", "suscribete", "suscribete al canal",
    "subtitulos realizados por la comunidad de amara org", "subtitulos por la comunidad de amara org", "amara org",
    "subtitulado por", "obrigado", "merci", "danke",
}
UMBRAL_SILENCIO = 0.004   # energía (RMS normalizado) bajo la cual un tramo es silencio
CUADRO = 0.1              # segundos por cuadro de energía
TIEMPO = 4 * 3600         # lo más que puede tardar una transcripción


class ErrorTranscribir(RuntimeError):
    """Algo que la persona puede arreglar: el mensaje es la frase en español (clave de traducción) y `codigo` dice cuál."""
    FRASES = {
        "sin_modelo": "Falta el modelo de transcripción: descárgalo en Ajustes.",
        "sin_transcriptor": "No encontré el transcriptor.",
        "fallo": "La transcripción falló.",
        "ruta": "No puedo transcribir un archivo en una carpeta con saltos de línea en el nombre.",
    }

    def __init__(self, codigo, detalle=""):
        super().__init__(self.FRASES[codigo])
        self.codigo, self.plantilla, self.detalle = codigo, self.FRASES[codigo], detalle[-300:]


# ───────────── Modelos ─────────────

def carpeta_modelos():
    return nucleo.carpeta_privada(os.path.join(nucleo.carpeta_datos(), "modelos"))


def ruta_modelo(id_):
    return os.path.join(carpeta_modelos(), MODELOS[id_]["archivo"])


def url_modelo(id_):
    m = MODELOS[id_]
    return f"{HF}{m['repo']}/resolve/main/{m['archivo']}"


def verificar(id_):
    """True si el modelo está y es el de siempre (tamaño y SHA-256). Lee el archivo entero: llamarlo una vez al descargar."""
    m, ruta = MODELOS.get(id_), None
    if not m:
        return False
    ruta = ruta_modelo(id_)
    try:
        if os.path.getsize(ruta) != m["bytes"]:
            return False
        h = hashlib.sha256()
        with open(ruta, "rb") as f:
            for trozo in iter(lambda: f.read(1024 * 1024), b""):
                h.update(trozo)
        return h.hexdigest() == m["sha256"]
    except OSError:
        return False


def modelos():
    return [{"id": k, **{c: v[c] for c in ("archivo", "bytes", "sha256", "nombre", "detalle")}, "url": url_modelo(k),
             "descargado": os.path.isfile(ruta_modelo(k)) and os.path.getsize(ruta_modelo(k)) == v["bytes"]}
            for k, v in MODELOS.items()]


def modelo_elegido(preferido=None):
    """La ruta del modelo de voz: el preferido si está descargado; si no, el que haya (turbo primero); None si no hay ninguno."""
    for k in ([preferido] if preferido in ("turbo", "small") else []) + ["turbo", "small"]:
        r = ruta_modelo(k)
        if os.path.isfile(r) and os.path.getsize(r) == MODELOS[k]["bytes"]:
            return r
    return None


# ───────────── El transcriptor ─────────────

def herramienta(*nombres):
    """El primer ejecutable que exista: el que trae la app (<ID>_PROGRAMAS o <ID>_HERRAMIENTAS), el de bin/ o el del sistema."""
    dirs = [d for d in (nucleo.entorno("PROGRAMAS"), nucleo.entorno("HERRAMIENTAS"), os.path.join(nucleo.recursos(), "bin")) if d]
    for nombre in nombres:
        for d in dirs:
            for ruta in (os.path.join(d, nombre), os.path.join(d, nombre + ".exe")):
                if os.path.isfile(ruta) and os.access(ruta, os.X_OK):
                    return ruta
        if shutil.which(nombre):
            return shutil.which(nombre)
    return None


def transcriptor():
    return herramienta(nucleo.app()["id"] + "-transcribir", "whisper-cli")


def _privado(contenido, sufijo):
    """Un temporal que solo puede leer la persona (0600, así lo crea mkstemp), fuera de sus carpetas. Quien lo pide lo borra."""
    fd, ruta = tempfile.mkstemp(prefix=nucleo.app()["id"] + "-", suffix=sufijo)
    with os.fdopen(fd, "wb") as f:
        f.write(contenido)
    return ruta


def _linea(texto):
    """Una ruta u opción para el archivo de argumentos de whisper-cli, codificada como la leería de argv: en Windows, whisper-cli
    abre archivos con la página de códigos del sistema (no UTF-8)."""
    return texto.encode("mbcs", "replace") if os.name == "nt" else os.fsencode(texto)


def comando(binario, opciones, vocabulario=""):
    """(comando, temporales que hay que borrar). El vocabulario nunca va como argumento (ver arriba)."""
    prompt = " ".join(str(vocabulario or "").split())[:2000]
    if not prompt:
        return [binario] + opciones, []
    if os.path.basename(binario).lower().split(".")[0].endswith("-transcribir"):
        archivo = _privado(prompt.encode("utf-8"), ".vocabulario.txt")
        return [binario] + opciones + ["--prompt-archivo", archivo], [archivo]
    # whisper-cli: las rutas como las abre el sistema y el prompt en UTF-8 (lo que espera el tokenizador de whisper). Una ruta con un
    # salto de línea partiría su línea en dos: no se transcribe así.
    lineas = [_linea(x) for x in opciones] + [b"--prompt", prompt.encode("utf-8")]
    if any(b"\n" in x or b"\r" in x for x in lineas):
        raise ErrorTranscribir("ruta")
    archivo = _privado(b"\n".join(lineas) + b"\n", ".argumentos.txt")
    return [binario, "@" + archivo], [archivo]


def hilos():
    return str(max(2, min(8, (os.cpu_count() or 4) - 1)))


def transcribir(wav, *, idioma="auto", modelo=None, vocabulario="", palabras=False, vad=True, energia_=None, tiempo=TIEMPO):
    """Transcribe un WAV de 16 kHz mono. Devuelve los segmentos ya limpios ({desde, hasta, texto} en segundos) o, con
    palabras=True, una palabra por elemento ({t, i, f}). `modelo`: ruta, o None para el elegido. Lanza ErrorTranscribir."""
    if not isinstance(idioma, str) or not re.fullmatch(r"auto|[a-z]{2,3}", idioma):
        idioma = "auto"
    modelo = modelo or modelo_elegido()
    if not modelo or not os.path.isfile(modelo):
        raise ErrorTranscribir("sin_modelo")
    binario = transcriptor()
    if not binario:
        raise ErrorTranscribir("sin_transcriptor")
    with tempfile.TemporaryDirectory(prefix=nucleo.app()["id"] + "-voz-") as tmp:
        salida = os.path.join(tmp, "transcripcion")
        opciones = ["-m", modelo, "-l", idioma, "-t", hilos(), "-f", wav, "-oj", "-of", salida, "-np"]
        opciones += ["-ml", "1", "-sow"] if palabras else ["-sns", "-mc", "64"]
        if vad and os.path.isfile(ruta_modelo("vad")):
            opciones += ["--vad", "-vm", ruta_modelo("vad")]
        cmd, temporales = comando(binario, opciones, vocabulario)
        try:
            r = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8", errors="replace",
                               timeout=tiempo)
        except subprocess.TimeoutExpired:
            raise ErrorTranscribir("fallo", "tiempo") from None
        finally:
            for x in temporales:
                try:
                    os.remove(x)
                except OSError:
                    pass
        datos = nucleo.leer_json(salida + ".json", None, maximo=200 * 1024 * 1024)
        if r.returncode != 0 or not isinstance(datos, dict):
            raise ErrorTranscribir("fallo", r.stderr or "")
    if palabras:
        return palabras_de(datos)
    return limpiar(segmentos_de(datos), energia_)


# ───────────── Leer y limpiar lo que dice whisper ─────────────

def normalizar(texto):
    t = unicodedata.normalize("NFKD", str(texto).lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^a-z0-9ñ ]+", " ", t).split())


def es_alucinacion(texto):
    t = normalizar(texto)
    return t in ALUCINACIONES or "amara org" in t


def _marca(texto):
    return re.fullmatch(r"\s*[\[(♪*].*[\])♪*]\s*", texto) is not None


def segmentos_de(datos):
    r = []
    for s in datos.get("transcription", []) if isinstance(datos, dict) else []:
        try:
            texto, desde, hasta = str(s.get("text") or "").strip(), s["offsets"]["from"] / 1000, s["offsets"]["to"] / 1000
        except (KeyError, TypeError, AttributeError):
            continue
        if texto and not _marca(texto):
            r.append({"desde": round(desde, 3), "hasta": round(hasta, 3), "texto": texto})
    return r


def palabras_de(datos):
    """Con -ml 1 -sow cada segmento es una palabra. La puntuación suelta va pegada a la anterior; marcas e inventos se descartan."""
    r = []
    for s in segmentos_de(datos):
        t, i, f = s["texto"], s["desde"], s["hasta"]
        if r and not re.match(r"^[\wáéíóúñü¿¡]", t, re.I):
            r[-1]["t"] += t
            r[-1]["f"] = max(r[-1]["f"], f)
            continue
        if f > i:
            r.append({"t": t, "i": i, "f": f})
    return [] if es_alucinacion(" ".join(w["t"] for w in r)) else r


def limpiar(segs, energia_=None):
    """Sin inventos, sin lo que cae en silencio (si se pasa la energía) y sin bucles: la misma frase más de 2 veces seguidas."""
    buenos = [s for s in segs if not es_alucinacion(s["texto"])
              and not (energia_ is not None and rms(energia_, s["desde"], s["hasta"]) < UMBRAL_SILENCIO)]
    final = []
    for s in buenos:
        if len(final) >= 2 and normalizar(s["texto"]) == normalizar(final[-1]["texto"]) == normalizar(final[-2]["texto"]):
            continue
        final.append(s)
    return final


def energia(wav):
    """La energía (RMS normalizado, 0 a 1) de cada cuadro de 100 ms de un WAV de 16 bits."""
    with wave.open(wav, "rb") as w:
        if w.getsampwidth() != 2:
            return []
        datos = array.array("h")
        datos.frombytes(w.readframes(w.getnframes()))
        n = int(w.getframerate() * CUADRO) * w.getnchannels()
    r = []
    for i in range(0, len(datos), n):
        tramo = datos[i:i + n:4]
        r.append(math.sqrt(sum(x * x for x in tramo) / len(tramo)) / 32768.0 if tramo else 0.0)
    return r


def rms(energia_, desde, hasta):
    a, b = max(0, int(desde / CUADRO)), min(len(energia_), int(math.ceil(hasta / CUADRO)))
    if b <= a:
        return 0.0
    return math.sqrt(sum(e * e for e in energia_[a:b]) / (b - a))


if __name__ == "__main__":
    nucleo.script({"modelos": lambda d: {"ok": True, "modelos": modelos()},
                   "verificar": lambda d: {"ok": True, "id": d.get("id"), "valido": verificar(d.get("id"))}}, __doc__)
