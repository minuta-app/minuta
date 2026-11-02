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
  aquí `verificar(id)` los revisa y `ruta_modelo(id)` dice dónde están (`<carpeta de datos>/modelos`, u otra carpeta con
  `"transcribir": {"modelos": "~/ana/models"}` en app.json). Para pruebas, `<ID>_MODELO_PRUEBA=<archivo>` cuenta como modelo
  descargado (nunca dentro de la app).
- **VAD** (detector de voz, Silero): si está descargado, whisper salta los silencios (menos inventos y más rápido). `vad=` acepta
  True, False o la ruta del modelo; por defecto va con segmentos y no palabra por palabra (corta la palabra justo al borde).
- **Limpieza:** se quitan las marcas ([música], (ruido)), los créditos que whisper inventa («Subtítulos realizados por la
  comunidad de Amara.org»: nadie los dice), los bucles (la misma frase 3 veces seguidas) y, si se pasa la energía del audio
  (`energia(wav)`), lo que cae en silencio. Las frases cortas que whisper inventa en silencio pero que la gente también dice
  («Gracias», «Thank you», «Gracias por ver») solo se quitan si caen en silencio o casi (con la energía) o si son lo único que
  hay en toda la transcripción (sin la energía): nunca se pierde un «gracias» dicho en una reunión.

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
#: Coincidencia EXACTA con el segmento entero (normalizado): «Gracias, Ana» nunca es un invento. Como la gente también las dice,
#: solo se quitan si caen en silencio o casi (con la energía) o si no hay nada más en toda la transcripción.
ALUCINACIONES = {
    "thank you", "thanks for watching", "thank you for watching", "thank you very much", "bye", "you",
    "gracias", "muchas gracias", "gracias por ver", "gracias por ver el video", "suscribete", "suscribete al canal",
    "obrigado", "merci", "danke",
}
#: Créditos de subtítulos: nadie los dice, se quitan siempre. Exactos o como palabras completas dentro del segmento (`CREDITOS_EN`).
CREDITOS = {
    "subtitulos realizados por la comunidad de amara org", "subtitulos por la comunidad de amara org", "amara org",
    "subtitulado por",
}
CREDITOS_EN = re.compile(r"(?:^| )(?:amara org|subtitulos realizados por)(?: |$)")
UMBRAL_SILENCIO = 0.004   # energía (RMS normalizado) bajo la cual un tramo es silencio
UMBRAL_INVENTO = 0.012    # una frase de ALUCINACIONES con menos energía que esto es ruido o música de fondo, no alguien hablando
CUADRO = 0.1              # segundos por cuadro de energía
TIEMPO = 4 * 3600         # lo más que puede tardar una transcripción


class ErrorTranscribir(RuntimeError):
    """Algo que la persona puede arreglar. str(e) es la frase en español (clave de traducción) y `codigo` dice cuál. Con detalle
    (lo último que dijo el transcriptor), `frase` ya lo trae puesto y `plantilla` + `valores` sirven para traducir:
    Tp(e.plantilla, e.valores) o `e.como_dict()` para responder a la interfaz."""
    FRASES = {
        "sin_modelo": "Falta el modelo de transcripción: descárgalo en Ajustes.",
        "sin_transcriptor": "No encontré el transcriptor.",
        "fallo": "La transcripción falló.",
        "ruta": "No puedo transcribir un archivo en una carpeta con saltos de línea en el nombre.",
    }
    CON_DETALLE = {"fallo": "La transcripción falló: {detalle}"}

    def __init__(self, codigo, detalle=""):
        super().__init__(self.FRASES[codigo])
        self.codigo, self.detalle = codigo, " ".join(str(detalle or "")[-300:].split())
        self.plantilla = self.CON_DETALLE[codigo] if self.detalle and codigo in self.CON_DETALLE else self.FRASES[codigo]
        self.valores = {"detalle": self.detalle} if "{detalle}" in self.plantilla else {}
        self.frase = self.plantilla.replace("{detalle}", self.detalle)

    def como_dict(self):
        """{ok: false, codigo, plantilla, valores, error}: lo que un script responde a la interfaz."""
        return {"ok": False, "codigo": self.codigo, "plantilla": self.plantilla, "valores": self.valores, "error": self.frase}


# ───────────── Modelos ─────────────

def carpeta_modelos():
    """`<carpeta de datos>/modelos`, o la de app.json → "transcribir": {"modelos": "~/ana/models"} (con ~, absoluta o relativa
    a la carpeta de datos; nunca con ..), para una app que siempre los tuvo en otra parte."""
    propia = (nucleo.app().get("transcribir") or {}).get("modelos") if isinstance(nucleo.app().get("transcribir"), dict) else None
    if propia is None:
        return nucleo.carpeta_privada(os.path.join(nucleo.carpeta_datos(), "modelos"))
    if not isinstance(propia, str) or not propia.strip() or ".." in propia.replace("\\", "/").split("/") or "\n" in propia:
        raise RuntimeError("app.json: «transcribir.modelos» es una carpeta (~/…, absoluta o relativa a la de datos), sin «..».")
    ruta = os.path.expanduser(propia)
    return nucleo.carpeta_privada(ruta if os.path.isabs(ruta) else os.path.join(nucleo.carpeta_datos(), ruta))


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


def modelo_prueba():
    """`<ID>_MODELO_PRUEBA=<archivo>`: un modelo falso para las pruebas de la app (cualquier tamaño). Nunca dentro de la app: si
    el host puso `<ID>_RECURSOS`, se ignora."""
    r = nucleo.entorno("MODELO_PRUEBA", "")
    return r if r and not nucleo.entorno("RECURSOS") and os.path.isfile(r) else None


def modelo_elegido(preferido=None):
    """La ruta del modelo de voz: el preferido si está descargado; si no, el que haya (turbo primero); None si no hay ninguno."""
    if modelo_prueba():
        return modelo_prueba()
    for k in ([preferido] if preferido in ("turbo", "small") else []) + ["turbo", "small"]:
        r = ruta_modelo(k)
        if os.path.isfile(r) and os.path.getsize(r) == MODELOS[k]["bytes"]:
            return r
    return None


# ───────────── El transcriptor ─────────────

def herramienta(*nombres):
    """El primer ejecutable que exista. Primero las carpetas de la app (<ID>_PROGRAMAS, <ID>_HERRAMIENTAS, bin/) con TODOS los
    nombres, y recién después el sistema: un whisper-cli instalado aparte nunca gana sobre el binario que trae la app."""
    dirs = [d for d in (nucleo.entorno("PROGRAMAS"), nucleo.entorno("HERRAMIENTAS"), os.path.join(nucleo.recursos(), "bin")) if d]
    for d in dirs:
        for nombre in nombres:
            for ruta in (os.path.join(d, nombre), os.path.join(d, nombre + ".exe")):
                if os.path.isfile(ruta) and os.access(ruta, os.X_OK):
                    return ruta
    for nombre in nombres:
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


def ruta_vad(vad=None):
    """El modelo del detector de voz que se usa: `vad` si es una ruta a un archivo, el descargado si `vad` es True o None; si no,
    None (sin VAD)."""
    if isinstance(vad, str):
        return vad if os.path.isfile(vad) else None
    if vad is False:
        return None
    r = ruta_modelo("vad")
    return r if os.path.isfile(r) else None


def transcribir(wav, *, idioma="auto", modelo=None, vocabulario="", palabras=False, vad=None, energia_=None, tiempo=TIEMPO,
                partir=None):
    """Transcribe un WAV de 16 kHz mono. Devuelve los segmentos ya limpios ({desde, hasta, texto} en segundos) o, con
    palabras=True, una palabra por elemento ({t, i, f}). `modelo`: ruta, o None para el elegido. `vad`: True, False o la ruta
    del modelo; None (por defecto) = con segmentos sí, palabra por palabra no. `partir(segmentos) -> segmentos` corre antes de
    limpiar (p. ej. partir por silencios: así cada parte se filtra sola). Lanza ErrorTranscribir."""
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
        vm = ruta_vad(vad if vad is not None else (False if palabras else True))
        if vm:
            opciones += ["--vad", "-vm", vm]
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
        return palabras_de(datos, energia_)
    segs = segmentos_de(datos)
    return limpiar(partir(segs) if partir else segs, energia_)


# ───────────── Leer y limpiar lo que dice whisper ─────────────

def normalizar(texto):
    t = unicodedata.normalize("NFKD", str(texto).lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^a-z0-9ñ ]+", " ", t).split())


def es_credito(texto):
    """Créditos de subtítulos que whisper inventa («… Amara.org»): nadie los dice. Palabras completas: «Tamara organizó» no."""
    t = normalizar(texto)
    return t in CREDITOS or CREDITOS_EN.search(t) is not None


def es_alucinacion(texto):
    """True si el segmento entero (normalizado) es una frase que whisper suele inventar o un crédito. Que lo sea no basta para
    quitarlo: ver `limpiar`."""
    return normalizar(texto) in ALUCINACIONES or es_credito(texto)


def inventado(seg, energia_=None, solo_inventos=False):
    """¿Se quita este segmento? Créditos, siempre. Una frase de ALUCINACIONES: con la energía, solo si cae en silencio o casi
    (bajo UMBRAL_INVENTO); sin la energía, solo si es todo lo que hay (`solo_inventos`: ningún otro segmento dice algo real)."""
    if es_credito(seg["texto"]):
        return True
    if normalizar(seg["texto"]) not in ALUCINACIONES:
        return False
    if energia_:
        return rms(energia_, seg["desde"], seg["hasta"]) < UMBRAL_INVENTO
    return solo_inventos


def _marca(texto):
    return re.fullmatch(r"\s*[\[(♪*].*[\])♪*]\s*", texto) is not None


def segmentos_de(datos):
    """Los segmentos ({desde, hasta, texto} en segundos) del JSON de whisper (`-oj`), sin marcas como [Música]."""
    r = []
    for s in datos.get("transcription", []) if isinstance(datos, dict) else []:
        try:
            texto, desde, hasta = str(s.get("text") or "").strip(), s["offsets"]["from"] / 1000, s["offsets"]["to"] / 1000
        except (KeyError, TypeError, AttributeError):
            continue
        if texto and not _marca(texto):
            r.append({"desde": round(desde, 3), "hasta": round(hasta, 3), "texto": texto})
    return r


def whisper_de(segs):
    """Lo inverso de `segmentos_de`: el formato de whisper ({"transcription": [{offsets: {from, to} en ms, text}]}) desde
    segmentos {desde, hasta, texto} en segundos. Para guardar una transcripción en el formato de siempre y releerla después."""
    r = []
    for s in segs or []:
        try:
            desde, hasta, texto = float(s["desde"]), float(s["hasta"]), str(s["texto"])
        except (KeyError, TypeError, ValueError):
            continue
        r.append({"offsets": {"from": int(round(desde * 1000)), "to": int(round(hasta * 1000))}, "text": texto})
    return {"transcription": r}


def palabras_de(datos, energia_=None):
    """Con -ml 1 -sow cada segmento es una palabra. La puntuación suelta va pegada a la anterior; marcas e inventos se descartan
    (con las mismas reglas que `limpiar`: un «Gracias.» dicho de verdad queda)."""
    r = []
    for s in segmentos_de(datos):
        t, i, f = s["texto"], s["desde"], s["hasta"]
        if r and not re.match(r"^[\wáéíóúñü¿¡]", t, re.I):
            r[-1]["t"] += t
            r[-1]["f"] = max(r[-1]["f"], f)
            continue
        if f > i:
            r.append({"t": t, "i": i, "f": f})
    if r and inventado({"texto": " ".join(w["t"] for w in r), "desde": r[0]["i"], "hasta": r[-1]["f"]}, energia_, True):
        return []
    return r


def limpiar(segs, energia_=None, partir=None):
    """Sin inventos (ver `inventado`), sin lo que cae en silencio (si se pasa la energía) y sin bucles: la misma frase más de 2
    veces seguidas. `partir(segmentos) -> segmentos` corre antes de filtrar."""
    segs = list(partir(segs) if partir else segs)
    solo = all(es_alucinacion(s["texto"]) for s in segs)
    buenos = [s for s in segs if not inventado(s, energia_, solo)
              and not (energia_ and rms(energia_, s["desde"], s["hasta"]) < UMBRAL_SILENCIO)]
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
