#!/usr/bin/env python3
"""Dictado del Gimnasio (Windows y Linux): lo que dijiste, en texto, con la pieza «transcribir» (whisper local, sin enviar audio).

Uso: dictado.py <entrada.json> <salida.json>
entrada: {"wav": "<ruta del WAV de 16 kHz mono que grabó la app>"}  (lo escribe la app, nunca la interfaz)
salida:  {"ok": true, "texto": "…"} o {"ok": false, "codigo": "sin_modelo" | "sin_transcriptor" | "fallo" | "datos", "texto": ""}

Mismo modelo, idioma y vocabulario que las notas (perfil.json → modelo_whisper, idioma_audio; ~/minuta/vocabulario.txt). La
energía del audio va a `limpiar`: un «Gracias.» dicho de verdad queda; uno inventado sobre silencio, no.
"""
import os
import sys

import nucleo  # pieza «nucleo» (Pieza)
import transcribir  # pieza «transcribir» (Pieza)
from perfil import BASE, IDIOMA_AUDIO, P as PERFIL


def vocabulario():
    try:
        with open(os.path.join(BASE, "vocabulario.txt"), encoding="utf-8") as f:
            return f.read().strip()[:2000]
    except OSError:
        return ""


def dictar(d):
    wav = d.get("wav") if isinstance(d, dict) else None
    if not isinstance(wav, str) or not wav.lower().endswith(".wav") or not os.path.isfile(wav):
        return {"ok": False, "codigo": "datos", "texto": ""}
    modelo = transcribir.modelo_elegido((PERFIL.get("modelo_whisper") or "").strip())
    try:
        segs = transcribir.transcribir(wav, idioma=(IDIOMA_AUDIO or "auto").strip() or "auto", modelo=modelo,
                                       vocabulario=vocabulario(), energia_=transcribir.energia(wav), tiempo=120)
    except transcribir.ErrorTranscribir as e:
        return {"ok": False, "codigo": getattr(e, "codigo", "fallo"), "texto": ""}
    return {"ok": True, "texto": " ".join(s["texto"].strip() for s in segs if s.get("texto", "").strip())}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    nucleo.escribir_json(sys.argv[2], dictar(nucleo.leer_json(sys.argv[1], {})))
