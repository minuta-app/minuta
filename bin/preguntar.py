#!/usr/bin/env python3
"""Responde preguntas sobre tus reuniones con Claude (claude -p), citando notas y minutos.

Uso: preguntar.py "<pregunta>" <salida.json>
1) Busca localmente las notas y fragmentos de transcripción más relevantes (sin enviar todo).
2) Le pasa a Claude un índice de todas las reuniones + el detalle de las relevantes, numeradas.
3) Escribe {"respuesta": markdown con citas [n] o [n@hh:mm:ss], "fuentes": [...]} en <salida.json>.
"""
import json
import math
import os
import re
import subprocess
import sys
import unicodedata

from perfil import NOMBRE, IDIOMA, CARPETA_NOTAS, CLAUDE

HOME = os.path.expanduser("~")
VAULT = CARPETA_NOTAS

VACIAS = set("""a al algo ante antes como con contra cual cuales cuando de del desde donde dos el ella ellas ellos en entre era es esa
ese eso esta este esto estos fue fueron ha han hay la las le les lo los mas me mi mis muy nada ni no nos o otra otro para pero por porque
que quien se ser si sin sobre su sus tambien te tiene tu tus un una uno unos y ya yo dijo dije cosa cosas reunion reuniones tuve hice""".split())


def norm(t):
    t = unicodedata.normalize("NFD", t.lower())
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


def palabras(t):
    return [w for w in re.findall(r"[a-zñ0-9]{3,}", norm(t)) if w not in VACIAS]


def leer_notas():
    notas = []
    for f in sorted(os.listdir(VAULT)):
        if not f.endswith(".md"):
            continue
        ruta = os.path.join(VAULT, f)
        try:
            texto = open(ruta, encoding="utf-8").read()
        except Exception:
            continue
        fm, cuerpo = {}, texto
        if texto.startswith("---\n"):
            fin = texto.find("\n---\n", 4)
            if fin > 0:
                for l in texto[4:fin].splitlines():
                    if ":" in l:
                        k, v = l.split(":", 1)
                        fm[k.strip()] = v.strip()
                cuerpo = texto[fin + 5:]
        titulo = next((l[2:].strip() for l in cuerpo.splitlines() if l.startswith("# ")), f[:-3])
        partes = re.split(r"\n## ", "\n" + cuerpo)
        secc = {"puntos": partes[0]}
        for p in partes[1:]:
            cab, _, resto = p.partition("\n")
            secc[norm(cab.split()[0]) if cab.split() else ""] = resto
        trans = [re.sub(r"^[>\s]+", "", l) for l in secc.get("transcripcion", "").splitlines()]
        trans = [l for l in trans if re.match(r"^\[\d", l)]
        notas.append({"ruta": ruta, "titulo": titulo, "fecha": fm.get("fecha", ""), "hora": fm.get("hora", ""), "tipo": fm.get("tipo", ""),
                      "participantes": fm.get("participantes", "").strip("[]").replace('"', ""), "puntos": secc["puntos"].replace(f"# {titulo}", "").strip(),
                      "feedback": secc.get("feedback", "").strip(), "personas": secc.get("personas", "").strip(), "trans": trans})
    return notas


def puntuar(notas, pregunta):
    q = palabras(pregunta)
    if not q:
        return [(0.0, n) for n in notas]
    docs = [(n, palabras(n["titulo"]) * 3 + palabras(n["participantes"]) * 3 + palabras(n["puntos"]) * 2 + palabras(n["personas"]) * 2
             + palabras(n["feedback"]) + palabras(" ".join(n["trans"]))) for n in notas]
    N = len(docs)
    df = {w: sum(1 for _, d in docs if w in d) for w in set(q)}
    res = []
    for i, (n, d) in enumerate(docs):
        cuenta = {}
        for w in d:
            cuenta[w] = cuenta.get(w, 0) + 1
        s = sum(math.log(1 + cuenta.get(w, 0)) * math.log(1 + N / (1 + df[w])) for w in q)
        res.append((s + i / max(1, N) * 0.15, n))  # leve preferencia por lo reciente
    return sorted(res, key=lambda x: -x[0])


def fragmentos(n, pregunta, maximo=24):
    q = set(palabras(pregunta))
    if not q:
        return n["trans"][:maximo]
    marcas = set()
    for i, l in enumerate(n["trans"]):
        if q & set(palabras(l)):
            marcas.update(range(max(0, i - 2), min(len(n["trans"]), i + 3)))
    return [n["trans"][i] for i in sorted(marcas)][:maximo]


def main():
    pregunta, salida = sys.argv[1], sys.argv[2]
    notas = leer_notas()
    if not notas:
        json.dump({"respuesta": "Aún no tienes reuniones grabadas.", "fuentes": []}, open(salida, "w"), ensure_ascii=False)
        return
    top = [n for s, n in puntuar(notas, pregunta)[:7] if s > 0] or notas[-5:]
    fuentes = []
    bloques = []
    for k, n in enumerate(top, 1):
        fuentes.append({"n": k, "ruta": n["ruta"], "titulo": n["titulo"], "fecha": n["fecha"]})
        frag = "\n".join(fragmentos(n, pregunta))
        bloques.append(f"""[{k}] «{n['titulo']}» — {n['fecha']} {n['hora']} · {n['tipo']} · participantes: {n['participantes'] or '?'}
NOTAS:
{n['puntos'][:3500]}
{('PERSONAS:' + chr(10) + n['personas'][:800]) if n['personas'] else ''}
FEEDBACK:
{n['feedback'][:1500]}
FRAGMENTOS DE TRANSCRIPCIÓN RELEVANTES:
{frag or '(ninguno)'}""")
    indice = "\n".join(f"- {n['fecha']} {n['hora']} · {n['tipo']} · «{n['titulo']}» · {n['participantes']}" for n in notas[-120:])
    prompt = f"""Eres el asistente de {NOMBRE} y conoces todas sus reuniones. Responde su pregunta en {IDIOMA}, directo y breve
(máximo ~150 palabras salvo que pida detalle), usando SOLO la información de abajo. Si no está, dilo claramente.

Cita SIEMPRE de dónde sale cada dato con [n] (número de la reunión) o [n@hh:mm:ss] si viene de un fragmento de transcripción con hora.
Usa viñetas si enumeras varias cosas. No inventes nombres, cifras ni fechas.

PREGUNTA: {pregunta}

ÍNDICE DE TODAS SUS REUNIONES (para preguntas de conteo o fechas):
{indice}

REUNIONES MÁS RELEVANTES:
{chr(10).join(bloques)}
"""
    cmd = [CLAUDE, "-p", "--output-format", "text"]
    if os.environ.get("MINUTA_MODELO"):
        cmd += ["--model", os.environ["MINUTA_MODELO"]]
    r = subprocess.run(cmd, input=prompt, text=True, capture_output=True, timeout=300, cwd=os.path.join(HOME, "minuta"))
    if r.returncode != 0 or not r.stdout.strip():
        raise SystemExit(f"claude -p falló: {r.stderr.strip()[:300]}")
    with open(salida, "w", encoding="utf-8") as f:
        json.dump({"respuesta": r.stdout.strip(), "fuentes": fuentes}, f, ensure_ascii=False)


if __name__ == "__main__":
    main()
