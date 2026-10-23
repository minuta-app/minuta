#!/usr/bin/env python3
"""Minuta: transcribe una grabación (yo.caf + ellos.caf), calcula métricas y genera
notas + feedback con Claude Code (tu suscripción Max). Uso: procesar.py <carpeta>"""
import array
import datetime as dt
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata
import wave

from perfil import NOMBRE, NOMBRE_FB, IDIOMA, IDIOMA_AUDIO, HUMOR, CARPETA_NOTAS, es_usuario, P as PERFIL, CLAUDE
PERFIL_MODELO = (PERFIL.get("modelo_whisper") or "").strip()  # noqa: E402

HOME = os.path.expanduser("~")
BASE = os.path.join(HOME, "minuta")
# Modelo de transcripción: el que se eligió en la bienvenida (si falta, el que esté descargado).
_MODELOS = {"turbo": "ggml-large-v3-turbo-q5_0.bin", "small": "ggml-small-q5_1.bin"}
_elegido = os.path.join(BASE, "models", _MODELOS.get(PERFIL_MODELO, ""))
MODELO = _elegido if PERFIL_MODELO in _MODELOS and os.path.exists(_elegido) else next(
    (os.path.join(BASE, "models", f) for f in _MODELOS.values() if os.path.exists(os.path.join(BASE, "models", f))),
    os.path.join(BASE, "models", _MODELOS["turbo"]))
VAD = os.path.join(BASE, "models", "ggml-silero-v5.1.2.bin")
VAULT = CARPETA_NOTAS
HISTORIAL = os.path.join(BASE, "historial.jsonl")
DIAS_AUDIO = 14  # se borran los audios más antiguos que esto

# Palabras propias para que Whisper las escriba bien. Edita ~/minuta/vocabulario.txt para agregar más.
VOCABULARIO = "Reunión de trabajo."
_vocab = os.path.join(BASE, "vocabulario.txt")
if os.path.exists(_vocab):
    with open(_vocab, encoding="utf-8") as _f:
        VOCABULARIO = _f.read().strip() or VOCABULARIO

SR = 16000
UMBRAL_SILENCIO = 0.004  # RMS normalizado bajo el cual un segmento se considera silencio
ALUCINACIONES = [
    "subtitulos realizados por la comunidad de amara",
    "subtitulos por la comunidad de amara",
    "gracias por ver",
    "suscribete",
    "subtitulado por",
]
MULETILLAS_EN = {
    "um / uh": r"\b(?:u+m+|u+h+|e+r+m*)\b",
    "like": r"\blike\b(?! to\b)",
    "you know": r"\byou know\b",
    "basically": r"\bbasically\b",
    "actually": r"\bactually\b",
    "kind of": r"\bkind of\b|\bsort of\b",
}
MULETILLAS = {
    "o sea": r"\bo sea\b",
    "cachai": r"\bcach[aá]i\b",
    "básicamente": r"\bb[aá]sicamente\b",
    "digamos": r"\bdigamos\b",
    "como que": r"\bcomo que\b",
    "onda": r"\bonda\b",
    "eh / em": r"\b(?:e+h+|e+m+|m+h*)\b",
}


if IDIOMA_AUDIO == "en":
    MULETILLAS = MULETILLAS_EN


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def norm(texto):
    t = unicodedata.normalize("NFKD", texto.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9ñ ]+", " ", t).split()


def herramienta(*candidatos):
    """Primer ejecutable que exista: el que trae la app (MINUTA_HERRAMIENTAS), el de bin/ o el del sistema."""
    dirs = [d for d in (os.environ.get("MINUTA_HERRAMIENTAS"), os.path.join(BASE, "bin")) if d]
    for nombre in candidatos:
        for d in dirs:
            for ruta in (os.path.join(d, nombre), os.path.join(d, nombre + ".exe")):
                if os.path.isfile(ruta) and os.access(ruta, os.X_OK):
                    return ruta
        if shutil.which(nombre):
            return shutil.which(nombre)
    return None


def es_wav_whisper(ruta):
    """¿Ya es WAV 16 kHz mono 16 bits? (lo que graba la app de Windows/Linux)."""
    try:
        with wave.open(ruta, "rb") as w:
            return w.getframerate() == SR and w.getnchannels() == 1 and w.getsampwidth() == 2
    except Exception:
        return False


def a_wav(origen, destino):
    """Convierte la grabación a WAV 16 kHz mono 16 bits (lo que necesita Whisper).
    En macOS usa afconvert (viene con el sistema); Windows y Linux ya graban en ese formato; si no, ffmpeg."""
    if es_wav_whisper(origen):
        shutil.copyfile(origen, destino)
        return
    if sys.platform == "darwin" and os.path.exists("/usr/bin/afconvert"):
        subprocess.run(["/usr/bin/afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", origen, destino], check=True)
        return
    subprocess.run(["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-i", origen,
                    "-ac", "1", "-ar", str(SR), "-c:a", "pcm_s16le", destino], check=True)


FRAME = 0.1  # segundos por cuadro de energía


def leer_muestras(ruta):
    """Devuelve la energía (RMS normalizado) de cada cuadro de 100 ms de la pista."""
    with wave.open(ruta, "rb") as w:
        datos = array.array("h")
        datos.frombytes(w.readframes(w.getnframes()))
    n = int(SR * FRAME)
    energia = []
    for i in range(0, len(datos), n):
        tramo = datos[i:i + n:4]
        energia.append(math.sqrt(sum(x * x for x in tramo) / len(tramo)) / 32768.0 if tramo else 0.0)
    return energia


def rms(energia, ini, fin):
    a, b = max(0, int(ini / FRAME)), min(len(energia), int(math.ceil(fin / FRAME)))
    if b <= a:
        return 0.0
    return math.sqrt(sum(e * e for e in energia[a:b]) / (b - a))


def regiones_voz(energia, ini, fin, pausa=1.0, minimo=0.3):
    """Tramos con voz dentro de [ini, fin], uniendo pausas menores a `pausa` segundos."""
    regiones = []
    a, b = max(0, int(ini / FRAME)), min(len(energia), int(math.ceil(fin / FRAME)))
    for i in range(a, b):
        if energia[i] >= UMBRAL_SILENCIO * 2:
            t = i * FRAME
            if regiones and t - regiones[-1][1] <= pausa:
                regiones[-1][1] = t + FRAME
            else:
                regiones.append([t, t + FRAME])
    return [r for r in regiones if r[1] - r[0] >= minimo]


def partir_por_silencios(s, energia):
    """Whisper a veces junta en un segmento frases separadas por silencios largos (mientras habla
    el otro). Lo corta donde la pista tiene silencio real y reparte el texto según la duración."""
    regiones = regiones_voz(energia, s["ini"], s["fin"])
    if not regiones:
        return [s]
    return repartir(s, regiones)


def repartir(s, regiones, etiquetas=None):
    """Reparte el texto de `s` entre `regiones` [(ini, fin)] en proporción a su duración,
    cortando de preferencia en fin de frase. `etiquetas` asigna 'quien' a cada parte."""
    if len(regiones) == 1:
        parte = {**s, "ini": regiones[0][0], "fin": regiones[0][1]}
        if etiquetas:
            parte["quien"] = etiquetas[0]
        return [parte]
    palabras = s["texto"].split()
    letras = [0]  # letras acumuladas antes de cada palabra (la duración sigue mejor a las letras)
    for w in palabras:
        letras.append(letras[-1] + len(w) + 1)
    total = sum(b - a for a, b in regiones)
    cortes, acumulado = [0], 0.0
    for a, b in regiones[:-1]:
        acumulado += b - a
        meta_letras = letras[-1] * acumulado / total
        objetivo = min(range(len(letras)), key=lambda j: abs(letras[j] - meta_letras))
        margen = max(2, len(palabras) // 6)
        candidatos = [j for j in range(max(cortes[-1] + 1, objetivo - margen), min(len(palabras), objetivo + margen + 1))
                      if palabras[j - 1][-1:] in ".?!"]
        corte = min(candidatos, key=lambda j: abs(letras[j] - meta_letras)) if candidatos else objetivo
        cortes.append(min(max(corte, cortes[-1]), len(palabras)))
    cortes.append(len(palabras))
    partes = []
    for k, ((a, b), i, j) in enumerate(zip(regiones, cortes, cortes[1:])):
        if j > i:
            parte = {**s, "ini": a, "fin": b, "texto": " ".join(palabras[i:j])}
            if etiquetas:
                parte["quien"] = etiquetas[k]
            partes.append(parte)
    return partes or [s]


def diarizar(wav, salida):
    """Separa las voces de la pista 'Ellos'. Devuelve [{hablante, ini, fin}] o [].
    En Mac: FluidAudio (minuta-diarizar). En Windows y Linux: sherpa-onnx con pyannote + 3D-Speaker (vienen con la app)."""
    binario = herramienta("minuta-diarizar")
    try:
        if binario:
            subprocess.run([binario, wav, salida], check=True, timeout=3600)
            with open(salida, encoding="utf-8") as f:
                return json.load(f)
        sherpa = herramienta("sherpa-onnx-offline-speaker-diarization")
        dir_modelos = os.path.dirname(sherpa) if sherpa else ""
        segmentacion, huella = (os.path.join(dir_modelos, f) for f in ("voces-segmentacion.onnx", "voces-huella.onnx"))
        if not sherpa or not os.path.exists(segmentacion) or not os.path.exists(huella):
            return []
        hilos = str(max(1, min(4, (os.cpu_count() or 2) - 1)))
        r = subprocess.run([sherpa, "--clustering.cluster-threshold=0.9", f"--segmentation.num-threads={hilos}", f"--embedding.num-threads={hilos}",
                            f"--segmentation.pyannote-model={segmentacion}", f"--embedding.model={huella}", wav],
                           capture_output=True, text=True, timeout=3600, check=True)
        tramos = [{"hablante": h, "ini": float(a), "fin": float(b)}
                  for a, b, h in re.findall(r"^\s*([\d.]+)\s+--\s+([\d.]+)\s+(\S+)\s*$", r.stdout, re.M)]
        with open(salida, "w", encoding="utf-8") as f:
            json.dump(tramos, f)
        return tramos
    except Exception as e:  # sin diarización seguimos con "Ellos"
        log("Diarización no disponible:", e)
        return []


def asignar_hablantes(segs, diar):
    """Asigna 'Persona N' a cada segmento de 'Ellos' según quién hablaba en ese tramo."""
    if not diar:
        return segs
    diar = sorted(diar, key=lambda d: d["ini"])
    etiqueta = {}
    for d in diar:
        etiqueta.setdefault(d["hablante"], f"Persona {len(etiqueta) + 1}")
    salida = []
    for s in segs:
        tramos = []
        for d in diar:
            a, b = max(s["ini"], d["ini"]), min(s["fin"], d["fin"])
            if b - a > 0.2:
                quien = etiqueta[d["hablante"]]
                if tramos and tramos[-1][2] == quien:
                    tramos[-1][1] = b
                else:
                    tramos.append([a, b, quien])
        if not tramos:  # sin voz detectada por el diarizador: el hablante más cercano en el tiempo
            mitad = (s["ini"] + s["fin"]) / 2
            cercano = min(diar, key=lambda d: min(abs(d["ini"] - mitad), abs(d["fin"] - mitad)))
            salida.append({**s, "quien": etiqueta[cercano["hablante"]]})
            continue
        duraciones = {}
        for a, b, q in tramos:
            duraciones[q] = duraciones.get(q, 0) + b - a
        principal, dur = max(duraciones.items(), key=lambda x: x[1])
        if len(tramos) == 1 or dur / sum(duraciones.values()) >= 0.8:
            salida.append({**s, "quien": principal})
        else:
            salida.extend(repartir(s, [(a, b) for a, b, _ in tramos], [q for _, _, q in tramos]))
    return salida


def _cargar_correcciones():
    """Correcciones que el usuario enseñó desde el visor (✎): se aplican a cada transcripción nueva."""
    try:
        with open(os.path.join(BASE, "correcciones.json"), encoding="utf-8") as f:
            reglas = json.load(f)
    except Exception:
        return []
    salida = []
    for r in reglas:
        de, a = (r.get("de") or "").strip(), (r.get("a") or "").strip()
        if not de or not a:
            continue
        patron = re.escape(de)
        if r.get("palabra", True):
            patron = rf"(?<![\w]){patron}(?![\w])"
        salida.append((re.compile(patron, 0 if r.get("mayus", True) else re.IGNORECASE), a))
    return salida


CORRECCIONES = _cargar_correcciones()


def corregir(texto):
    for rx, a in CORRECCIONES:
        texto = rx.sub(lambda _m: a, texto)
    return texto


def transcribir(wav, salida):
    motor = herramienta("minuta-transcribir", "whisper-cli")
    if not motor:
        raise SystemExit("No encontré el transcriptor (minuta-transcribir o whisper-cli).")
    hilos = str(max(2, min(8, os.cpu_count() or 4)))  # en Windows/Linux whisper corre en el procesador: usa los núcleos que hay
    cmd = [motor, "-m", MODELO, "-l", IDIOMA_AUDIO, "-t", hilos, "-f", wav,
           "-oj", "-of", salida, "-np", "-sns", "-mc", "64", "--prompt", VOCABULARIO]
    if os.path.exists(VAD):
        cmd += ["--vad", "-vm", VAD]
    subprocess.run(cmd, check=True)
    with open(salida + ".json", encoding="utf-8") as f:
        datos = json.load(f)
    segs = []
    for s in datos.get("transcription", []):
        texto = corregir(s.get("text", "").strip())
        if texto:
            segs.append({"ini": s["offsets"]["from"] / 1000, "fin": s["offsets"]["to"] / 1000, "texto": texto})
    return segs


def limpiar(segs, muestras, quien):
    if muestras is not None:
        segs = [p for s in segs for p in partir_por_silencios(s, muestras)]
    buenos = []
    for s in segs:
        plano = " ".join(norm(s["texto"]))
        if any(a in plano for a in ALUCINACIONES):
            continue
        if muestras is not None and rms(muestras, s["ini"], s["fin"]) < UMBRAL_SILENCIO:
            continue
        s["quien"] = quien
        buenos.append(s)
    # repeticiones en bucle (alucinación típica de Whisper)
    final = []
    for s in buenos:
        if len(final) >= 2 and s["texto"] == final[-1]["texto"] == final[-2]["texto"]:
            continue
        final.append(s)
    return final


def quitar_eco(yo, ellos):
    """Sin audífonos el micrófono capta a los demás: descarta segmentos de 'Yo' que repiten lo de 'Ellos'."""
    resultado = []
    for s in yo:
        palabras = set(norm(s["texto"]))
        if len(palabras) < 3:
            resultado.append(s)
            continue
        cerca = set()
        for e in ellos:
            if e["fin"] >= s["ini"] - 1.5 and e["ini"] <= s["fin"] + 1.5:
                cerca.update(norm(e["texto"]))
        if cerca and len(palabras & cerca) / len(palabras) >= 0.55:
            continue
        resultado.append(s)
    return resultado


def turnos(segs, pausa=2.0):
    out = []
    for s in segs:
        if out and out[-1]["quien"] == s["quien"] and s["ini"] - out[-1]["fin"] <= pausa:
            out[-1]["fin"] = max(out[-1]["fin"], s["fin"])
            out[-1]["texto"] += " " + s["texto"]
        else:
            out.append(dict(s))
    return out


# Respuestas cortas de acompañamiento: decirlas mientras otro habla no es interrumpir.
CONFIRMACIONES = set("""si sí ya ok okay oka claro exacto perfecto dale bueno cierto correcto obvio ah aa eh mm mmm aja ajá
ya ya po pucha oh uy ya veo de acuerdo gracias vale buena genial super súper listo entiendo entonces sipo yapo""".split())


def es_yo(nombre):
    """Etiqueta de hablante que en realidad es el usuario (eco de su voz en el audio del sistema)."""
    return es_usuario(nombre) or bool(re.search(r"\beco\b|^Yo\b|duplic", nombre or "", re.I)) or (
        NOMBRE != "el usuario" and bool(re.search(rf"\b{re.escape(NOMBRE)}\b", nombre or "", re.I)))


def interrupciones_de(yo, ellos, audio=None):
    """Interrupción = le quitas la palabra a alguien. Con el audio de cada pista (energía cada 100 ms) se cuenta solo si:
    1) dijiste algo de verdad (≥4 palabras, no solo "sí / ya / claro"),
    2) la otra persona estaba hablando justo antes de que entraras Y siguió hablando al menos medio segundo
       encima tuyo (hubo choque real; un cambio de turno normal no lo tiene),
    3) y se calló a los pocos segundos (le quitaste la palabra). Si sigue hablando encima, no cuenta.
    `audio` = {"yo": (energía, desfase), "ellos": (energía, desfase)}. Sin audio usa solo los tiempos de Whisper (más estricto).
    Devuelve la lista con hora, a quién y qué dijiste."""
    def energia(pista, t):
        e, d = audio[pista]
        i = int((t - d) / FRAME)
        return e[i] if 0 <= i < len(e) else 0.0

    def frac(pista, a, b):
        n = max(1, int(round((b - a) / FRAME)))
        ts = [a + i * FRAME for i in range(n)]
        if pista == "yo":  # tu voz y no el eco de los demás en tu micrófono: más fuerte que la de ellos en ese instante
            ok = [t for t in ts if energia("yo", t) >= UMBRAL_SILENCIO * 2 and energia("yo", t) >= 1.3 * energia("ellos", t)]
        else:
            ok = [t for t in ts if energia(pista, t) >= UMBRAL_SILENCIO * 2]
        return len(ok) / n

    turnos_ellos = turnos(sorted(ellos, key=lambda s: s["ini"]), pausa=0.8)
    usados, detalle, ultimo = set(), [], -99.0
    for s in sorted(yo, key=lambda s: s["ini"]):
        palabras = norm(s["texto"])
        if len(palabras) < 4 or sum(1 for p in palabras if p not in CONFIRMACIONES) < 3 or s["ini"] - ultimo < 5:
            continue
        for k, t in enumerate(turnos_ellos):
            if k in usados or not (t["ini"] <= s["ini"] + 0.5 and t["fin"] >= s["ini"] - 0.5):
                continue
            if audio and "yo" in audio and "ellos" in audio:
                # Momento real en que empezaste a hablar (Whisper suele marcarlo antes).
                on = next((s["ini"] + i * FRAME for i in range(-3, 25) if frac("yo", s["ini"] + i * FRAME, s["ini"] + (i + 3) * FRAME) >= 0.67), None)
                if on is None:
                    continue
                antes, encima = frac("ellos", on - 1.0, on), frac("ellos", on, on + 0.6)
                se_callo = any(frac("ellos", on + x, on + x + 0.8) <= 0.15 for x in (0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.8))
                if not (antes >= 0.6 and encima >= 0.5 and se_callo):
                    continue
            else:
                resto = t["fin"] - s["ini"]
                if len(palabras) < 6 or not (s["ini"] - t["ini"] >= 1.5 and 1.0 <= resto <= 3.0):
                    continue
            usados.add(k); ultimo = s["ini"]
            detalle.append({"t": hhmmss(s["ini"]), "a": t["quien"], "cita": " ".join(s["texto"].split()[:14])})
            break
    return detalle


def metricas(yo, ellos, todos, duracion, audio=None):
    habla_yo = sum(s["fin"] - s["ini"] for s in yo)
    habla_ellos = sum(s["fin"] - s["ini"] for s in ellos)
    texto_yo = " ".join(s["texto"] for s in yo)
    palabras_yo = len(norm(texto_yo))
    trs = turnos(todos)
    mis_turnos = [t for t in trs if t["quien"] == "Yo"]
    cortes = interrupciones_de(yo, ellos, audio)
    por_persona = {}
    for e in ellos:
        por_persona[e["quien"]] = por_persona.get(e["quien"], 0) + e["fin"] - e["ini"]
    por_persona = {k: round(v / 60, 1) for k, v in sorted(por_persona.items(), key=lambda x: -x[1])}
    plano = " ".join(norm(texto_yo))
    muletillas ={k: len(re.findall(p, plano)) for k, p in MULETILLAS.items()}
    total_habla = habla_yo + habla_ellos
    return {
        "duracion_min": round(duracion / 60, 1),
        "habla_yo_pct": round(100 * habla_yo / total_habla) if total_habla else 0,
        "habla_yo_min": round(habla_yo / 60, 1),
        "habla_ellos_min": round(habla_ellos / 60, 1),
        "palabras_por_min_yo": round(palabras_yo / (habla_yo / 60)) if habla_yo > 30 else 0,
        "turnos_yo": len(mis_turnos),
        "monologo_max_seg": round(max((t["fin"] - t["ini"] for t in mis_turnos), default=0)),
        "preguntas_yo": texto_yo.count("?"),
        "interrupciones_yo": len(cortes),
        "interrupciones_detalle": cortes,
        "muletillas": {k: v for k, v in muletillas.items() if v},
        "habla_por_persona_min": por_persona,
    }


def hhmmss(seg):
    seg = int(seg)
    return f"{seg // 3600:02d}:{(seg // 60) % 60:02d}:{seg % 60:02d}"


def categorias():
    """Categorías configurables (~/minuta/categorias.json, se editan en Preferencias del visor)."""
    try:
        with open(os.path.join(BASE, "categorias.json"), encoding="utf-8") as f:
            return {c["id"]: c for c in json.load(f)}
    except Exception:
        return {}


def nombre_categoria(tipo):
    return categorias().get(tipo, {}).get("nombre") or tipo


def enfoque_categoria(tipo):
    c = categorias().get(tipo)
    if c and c.get("enfoque", "").strip():
        return c["enfoque"].strip()
    return ENFOQUE.get(tipo, ENFOQUE["Otra"])


# Solo si no hay ~/minuta/categorias.json (las categorías se configuran en Preferencias).
ENFOQUE = {
    "Personal": "Es una reunión o conversación personal. Da feedback de comunicación general, breve y amable.",
    "Otra": "Evalúa la comunicación en general: claridad, escucha, preguntas y cierre.",
}


def universo():
    """Universo elegido en la app (~/minuta/config.json → temas/<id>.json): (nombre, qué personajes valen)."""
    try:
        with open(os.path.join(BASE, "config.json"), encoding="utf-8") as f:
            tid = json.load(f).get("tema", "cine")
        from perfil import RECURSOS
        ruta = next(p for p in (os.path.join(BASE, "temas", f"{tid}.json"), os.path.join(RECURSOS, "universos", f"{tid}.json")) if os.path.exists(p))
        with open(ruta, encoding="utf-8") as f:
            t = json.load(f)
        return t["nombre"], t.get("personaje_por_defecto", "")
    except Exception:
        return "Cine variado", "cualquier personaje de película conocida"


def habito_anterior():
    """Hábito que Claude le dejó al usuario en su reunión anterior (para evaluar si lo cumplió)."""
    try:
        notas = sorted((f for f in os.listdir(VAULT) if f.endswith(".md")), reverse=True)
    except Exception:
        return None
    for f in notas[:15]:
        try:
            with open(os.path.join(VAULT, f), encoding="utf-8") as fh:
                for linea in fh:
                    if "**Hábito para la próxima:**" in linea:
                        h = linea.split("**Hábito para la próxima:**", 1)[1].strip()
                        if h:
                            return h
        except Exception:
            continue
    return None


def prompt_para(meta, m, transcripcion):
    titulo = meta.get("titulo") or "(sin título: propón uno)"
    anterior = habito_anterior()
    ini = dt.datetime.fromtimestamp(meta.get("inicio") or dt.datetime.now().timestamp())
    dias = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
    fecha_txt = f"{dias[ini.weekday()]} {ini:%Y-%m-%d}"
    bloque_anterior = ("\n- **Hábito anterior:** \"" + anterior + "\" — <✓ Lo lograste | ✗ No lo lograste | – No aplicó> : "
                       "<evidencia breve de esta reunión, con hora si la hay>") if anterior else ""
    saga, regla_saga = universo()
    return f"""Eres el asistente de notas y coach de comunicación de {NOMBRE}. Abajo va la transcripción de una reunión.
"Yo" es {NOMBRE} (su micrófono). Los demás aparecen como "Persona 1", "Persona 2", etc., según una separación automática
de voces que puede equivocarse (a veces divide a una persona en dos o junta a dos). "Ellos" = los demás sin separar.
La transcripción es automática y puede tener errores: infiere con sentido común, no inventes datos.

Fecha de la reunión: {fecha_txt}
Título indicado: {titulo}
Evento de calendario: {meta.get('evento') or '(ninguno)'} · Invitados: {', '.join(meta.get('asistentes') or []) or '(sin datos)'}
Tipo: {nombre_categoria(meta.get('tipo', 'Otra'))}. {enfoque_categoria(meta.get('tipo', 'Otra'))}
Métricas medidas (exactas): {json.dumps(m, ensure_ascii=False)}

En las notas y el feedback usa los nombres reales en vez de "Persona N" cuando los sepas.

Responde SOLO en markdown, en {IDIOMA}, con exactamente esta estructura. Los marcadores de estructura (TITULO:, HABLANTES:,
"### Próximos pasos", "## Personas", "## Feedback para …", **Veredicto:**, **Puntajes:** Claridad · Escucha · Preguntas · Cierre,
**Hábito para la próxima:**, **Hábito anterior:**, **Personaje:**, **Decisión:**, **Pendiente:**, "→ Prueba:", 🔧 y ✅) van SIEMPRE
tal cual, en español, aunque el resto esté en otro idioma: la app los usa para leer la nota.

TITULO: <título específico de máximo 8 palabras>
HABLANTES: Persona 1 = <nombre>; Persona 2 = <nombre>; ...
(deduce cada nombre por cómo se llaman entre ellos, cómo se presentan, a quién le responde {NOMBRE} o la lista de invitados;
si no hay evidencia clara escribe "?". Si dos etiquetas son claramente la misma persona, dales el mismo nombre.
Omite la línea si no hay etiquetas "Persona N". Esta nota entre paréntesis no va en tu respuesta.)

### <Tema 1: título específico, p. ej. "Perfil del club: Play Padel (Carlos Soto)">
- <hecho concreto, con cifras y nombres>
    - <detalle que lo matiza o explica>
- <otro hecho>

### <Tema 2 …>
- …

### Próximos pasos
- [ ] <responsable> — <qué> — <cuándo, tal como se dijo> (<AAAA-MM-DD calculada desde la fecha de la reunión; omite el paréntesis si no se dijo cuándo>)
(Un compromiso por línea, con UNA sola persona responsable; si es de {NOMBRE} escribe "{NOMBRE}". Incluye compromisos de los demás, no solo de {NOMBRE}.)

## Personas
- **<Nombre de cada participante, excepto {NOMBRE}>** (<rol y empresa si se sabe>): <en una línea: qué le importa, cómo decide, objeciones o tono que mostró en ESTA reunión>
(Solo personas con evidencia en la transcripción. Omite la sección si no hay nadie además de {NOMBRE}.)

## Feedback para {NOMBRE_FB}
- **Veredicto:** <una sola frase, máximo 18 palabras, directa y honesta: qué tal estuvo y el punto principal a mejorar>
- 🔧 [hh:mm:ss] "<cita textual corta de {NOMBRE}, copiada de la transcripción>" — <qué faltó o qué salió mal, concreto> → Prueba: "<frase exacta que {NOMBRE} pudo decir en vez de eso>"
- ✅ [hh:mm:ss] "<cita textual corta de {NOMBRE}>" — <por qué funcionó>
- **Puntajes:** Claridad X · Escucha X · Preguntas X · Cierre X (de 1 a 10)
- **Hábito para la próxima:** <UNA sola acción concreta y observable en la próxima reunión, máximo 12 palabras>{bloque_anterior}
- **Personaje:** En esta reunión fuiste como **<personaje>** en *<obra o episodio>*: <por qué, en una frase con {HUMOR}, basada en algo concreto que pasó en la reunión>
  (El personaje DEBE ser del universo "{saga}" ({regla_saga}). No uses personajes de otras sagas. Este paréntesis no va en tu respuesta.)

REGLAS DEL FEEDBACK (es lo que más le importa a {NOMBRE}: debe poder actuar con él):
- 🔧 primero: de 1 a 3 viñetas, ordenadas por importancia. ✅: 1 o 2 viñetas. Cada viñeta con la hora [hh:mm:ss] y una cita
  textual real de la transcripción (corta, máximo 15 palabras). Nada genérico como "buena comunicación".
- El "→ Prueba:" es una frase concreta que {NOMBRE} podría decir tal cual la próxima vez.
- Los puntajes deben ser exigentes: 10 es excepcional, 7 es correcto, 5 o menos es un problema claro.

REGLAS DE ESTILO para las notas (todo lo que va antes del feedback), como las de un buen asistente ejecutivo:
- Entre 3 y 6 secciones "###" agrupadas por tema, con títulos que digan de qué se trata (no "Resumen", "Notas" ni "Temas varios").
  Según la reunión pueden ser: contexto o perfil del cliente, situación actual, demo y reacciones, objeciones,
  decisiones, temas clave, pendientes técnicos, etc. Usa solo las que tengan contenido.
- Viñetas telegráficas de una línea: sin frases de relleno, sin "se habló de", sin repetir lo mismo en dos secciones.
- Prioriza datos duros: números, nombres, plazos, herramientas, precios, porcentajes. Usa "~" para cifras aproximadas.
- Sub-viñetas (4 espacios) solo para matizar o justificar la viñeta de arriba.
- Registra reacciones y objeciones de los demás tal como las dijeron (citas cortas entre comillas cuando aporten).
- Las decisiones van en la sección temática que corresponda, marcadas con "**Decisión:**".
- Si algo quedó abierto, márcalo con "**Pendiente:**" dentro de su sección.

Usa las métricas: si {NOMBRE} habló mucho más que los demás en una reunión de descubrimiento, o tuvo monólogos largos, menciónalo.

TRANSCRIPCIÓN:
{transcripcion}
"""


def llamar_claude(prompt, cwd):
    cmd = [CLAUDE, "-p", "--output-format", "text"]
    modelo = os.environ.get("MINUTA_MODELO")
    if modelo:
        cmd += ["--model", modelo]
    r = subprocess.run(cmd, input=prompt, text=True, capture_output=True, cwd=cwd, timeout=1200)
    if r.returncode != 0 or not r.stdout.strip():
        raise RuntimeError(f"claude -p falló ({r.returncode}): {r.stderr.strip()[:500]}")
    return r.stdout.strip()


def nombre_archivo(texto):
    t = re.sub(r'[\\/:*?"<>|#^\[\]]+', "", texto).strip()
    return (t or "Reunión")[:80]


def tabla_metricas(m):
    filas = [
        ("Duración", f"{m['duracion_min']} min"),
        ("Tu tiempo de habla", f"{m['habla_yo_pct']}% ({m['habla_yo_min']} min vs {m['habla_ellos_min']} min de los demás)"),
        ("Velocidad", f"{m['palabras_por_min_yo']} palabras/min" if m["palabras_por_min_yo"] else "—"),
        ("Intervenciones", str(m["turnos_yo"])),
        ("Tu intervención más larga", f"{m['monologo_max_seg']} s"),
        ("Preguntas que hiciste", str(m["preguntas_yo"])),
        ("Veces que cortaste a alguien", str(m["interrupciones_yo"])),
        ("Muletillas", ", ".join(f"{k} ×{v}" for k, v in m["muletillas"].items()) or "—"),
    ]
    if m.get("habla_por_persona_min"):
        filas.append(("Tiempo de habla de los demás",
                      ", ".join(f"{k} {v} min" for k, v in m["habla_por_persona_min"].items())))
    tabla = "| Métrica | Valor |\n| --- | --- |\n" + "\n".join(f"| {a} | {b} |" for a, b in filas)
    return tabla + detalle_interrupciones(m)


def detalle_interrupciones(m):
    """Lista verificable: dónde se contó cada interrupción (se puede saltar a la transcripción)."""
    cortes = m.get("interrupciones_detalle") or []
    if not cortes:
        return ""
    lineas = "\n".join(f"> - [{c['t']}] a {c['a']}: «{c['cita']}»" for c in cortes)
    return ("\n\n> [!info]- Dónde cortaste a alguien\n> Cuenta solo cuando tomaste la palabra y la otra persona se calló a los pocos segundos."
            " Un «sí», «ya» o hablar encima sin que el otro pare no cuenta.\n" + lineas)


def borrar_audios_viejos():
    raiz = os.path.join(BASE, "grabaciones")
    limite = time.time() - DIAS_AUDIO * 86400
    for d in os.listdir(raiz):
        ruta = os.path.join(raiz, d)
        if os.path.isdir(ruta) and os.path.getmtime(ruta) < limite:
            for f in os.listdir(ruta):
                if f.endswith((".caf", ".wav")):
                    os.remove(os.path.join(ruta, f))


def main():
    carpeta = os.path.abspath(sys.argv[1])
    with open(os.path.join(carpeta, "meta.json"), encoding="utf-8") as f:
        meta = json.load(f)
    inicio = dt.datetime.fromtimestamp(meta["inicio"])
    duracion = meta["fin"] - meta["inicio"]
    log("Procesando", carpeta, f"({duracion / 60:.1f} min)")

    pistas, audio = {}, {}
    for quien, archivo in (("Yo", "yo"), ("Ellos", "ellos")):
        # Mac graba .caf; Windows y Linux, WAV listo para Whisper (<pista>.grabacion.wav).
        origen = next((os.path.join(carpeta, archivo + ext) for ext in (".caf", ".grabacion.wav")
                       if os.path.exists(os.path.join(carpeta, archivo + ext))), os.path.join(carpeta, archivo + ".caf"))
        if not os.path.exists(origen) or os.path.getsize(origen) < 10000:
            log("Sin audio para", quien)
            continue
        wav = os.path.join(carpeta, archivo + ".wav")
        a_wav(origen, wav)
        muestras = leer_muestras(wav)
        total = rms(muestras, 0, len(muestras) * FRAME)
        if total < 0.0005:
            log("Pista en silencio:", quien)
            continue
        log("Transcribiendo", quien)
        segs = transcribir(wav, os.path.join(carpeta, archivo))
        primer = meta.get(f"{archivo}_primer_buffer") or meta["inicio"]
        desfase = max(0.0, primer - meta["inicio"])
        segs = limpiar(segs, muestras, quien)
        if quien == "Ellos" and segs:
            log("Separando voces")
            diar = diarizar(wav, os.path.join(carpeta, "hablantes.json"))
            segs = asignar_hablantes(segs, diar)
        for s in segs:
            s["ini"] += desfase
            s["fin"] += desfase
        pistas[quien] = segs
        audio[archivo] = (muestras, desfase)

    yo, ellos = pistas.get("Yo", []), pistas.get("Ellos", [])
    yo = quitar_eco(yo, ellos)
    todos = sorted(yo + ellos, key=lambda s: s["ini"])
    if not todos:
        raise SystemExit("No se detectó voz en la grabación.")

    m = metricas(yo, ellos, todos, duracion, audio)
    nombres = {}
    transcripcion = "\n".join(f"[{hhmmss(t['ini'])}] {t['quien']}: {t['texto']}" for t in turnos(todos))
    with open(os.path.join(carpeta, "transcripcion.txt"), "w", encoding="utf-8") as f:
        f.write(transcripcion)

    log("Generando notas con Claude")
    titulo = meta.get("titulo") or "Reunión"
    try:
        respuesta = llamar_claude(prompt_para(meta, m, transcripcion), carpeta)
        cuerpo = []
        for linea in respuesta.splitlines():
            if linea.upper().startswith("TITULO:") and not cuerpo:
                if not meta.get("titulo"):
                    titulo = linea.split(":", 1)[1].strip() or titulo
            elif linea.upper().startswith("HABLANTES:") and not cuerpo:
                for num, nombre in re.findall(r"Persona (\d+)\s*=\s*([^;]+)", linea):
                    nombre = nombre.strip().strip(".")
                    if nombre and nombre != "?" and "desconocid" not in nombre.lower():
                        nombres[f"Persona {num}"] = nombre
            elif linea.strip() or cuerpo:
                cuerpo.append(linea)
        respuesta = "\n".join(cuerpo).strip()
        if nombres:
            log("Hablantes:", nombres)
            for etiqueta in sorted(nombres, key=lambda e: -len(e)):  # "Persona 10" antes que "Persona 1"
                transcripcion = re.sub(rf"\b{etiqueta}:", nombres[etiqueta] + ":", transcripcion)
            m["habla_por_persona_min"] = {nombres.get(k, k): v for k, v in m["habla_por_persona_min"].items()}
            for c in m.get("interrupciones_detalle", []):
                c["a"] = nombres.get(c["a"], c["a"])
            # Si la "otra persona" resultó ser tu propia voz (eco en el audio del sistema), no es interrupción.
            m["interrupciones_detalle"] = [c for c in m.get("interrupciones_detalle", []) if not es_yo(c["a"])]
            m["interrupciones_yo"] = len(m["interrupciones_detalle"])
    except Exception as e:  # la transcripción no se pierde aunque falle Claude
        log("ERROR Claude:", e)
        respuesta = f"> [!warning] No se pudieron generar las notas con Claude\n> {e}\n> Puedes reintentar con: `python3 ~/minuta/bin/procesar.py \"{carpeta}\"`"

    os.makedirs(VAULT, exist_ok=True)
    nombre = f"{inicio:%Y-%m-%d %H%M} - {nombre_archivo(titulo)}.md"
    ruta = os.path.join(VAULT, nombre)
    frontmatter = {
        "fecha": f"{inicio:%Y-%m-%d}", "hora": f"{inicio:%H:%M}", "tipo": meta.get("tipo", "Otra"),
        **({"plataforma": meta["plataforma"]} if meta.get("plataforma") else {}),
        **({"correos": "[" + ", ".join(f'"{c}"' for c in meta["correos"]) + "]"} if meta.get("correos") else {}),
        **{k: v for k, v in m.items() if not isinstance(v, (dict, list))},
        "participantes": "[" + ", ".join(f'"{p}"' for p in m["habla_por_persona_min"]) + "]",
    }
    fm = "\n".join(f"{k}: {v}" for k, v in frontmatter.items())
    cuerpo_transcripcion = "\n".join("> " + l for l in transcripcion.splitlines())
    nota = (f"---\n{fm}\ntags: [reunion, minuta]\n---\n# {titulo}\n\n{respuesta}\n\n"
            f"## Métricas\n{tabla_metricas(m)}\n\n"
            f"## Transcripción\n> [!note]- Transcripción completa (automática)\n{cuerpo_transcripcion}\n")
    with open(ruta, "w", encoding="utf-8") as f:
        f.write(nota)

    with open(HISTORIAL, "a", encoding="utf-8") as f:
        f.write(json.dumps({"fecha": inicio.isoformat(), "titulo": titulo, "tipo": meta.get("tipo"),
                            "nota": ruta, **m}, ensure_ascii=False) + "\n")
    for nombre_txt in ("nota.txt", "../../ultima-nota.txt"):
        with open(os.path.normpath(os.path.join(carpeta, nombre_txt)), "w", encoding="utf-8") as f:
            f.write(ruta)
    for f in ("yo.wav", "ellos.wav"):
        p = os.path.join(carpeta, f)
        if os.path.exists(p):
            os.remove(p)
    borrar_audios_viejos()
    log("Nota lista:", ruta)
    if not respuesta.startswith("> [!warning]"):  # deja listo el mensaje para enviar a los participantes (no retrasa la nota)
        subprocess.Popen([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "redactar.py"), "--guardar", ruta],
                         stdout=subprocess.DEVNULL, stderr=open(os.path.join(os.path.dirname(HISTORIAL), "redactar.log"), "a"),
                         start_new_session=True)


if __name__ == "__main__":
    main()
