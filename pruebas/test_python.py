#!/usr/bin/env python3
"""Pruebas del procesamiento en Python (solo biblioteca estándar).

Uso: python3 pruebas/test_python.py   (desde la raíz del repo)
Corren en un HOME temporal con un perfil ficticio y una IA simulada: nunca tocan tus notas ni llaman a una IA real.
"""
import csv
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(RAIZ, "pruebas", "casos_nombres.json"), encoding="utf-8") as _f:
    CASOS = json.load(_f)

# HOME y PATH de mentira antes de importar perfil (lee ~/minuta/perfil.json al importarse).
HOME = tempfile.mkdtemp(prefix="minuta-pruebas-")
NOTAS = os.path.join(HOME, "notas")
BIN_FALSO = os.path.join(HOME, "bin-falso")
for d in (os.path.join(HOME, "minuta"), NOTAS, BIN_FALSO):
    os.makedirs(d, exist_ok=True)
with open(os.path.join(HOME, "minuta", "perfil.json"), "w", encoding="utf-8") as f:
    json.dump({"nombre": "Ana", "nombre_completo": "Ana Pérez", "ia": "claude", "carpeta_notas": NOTAS}, f)
os.environ["HOME"] = HOME
os.environ["PATH"] = BIN_FALSO + os.pathsep + os.environ.get("PATH", "")
sys.path.insert(0, os.path.join(RAIZ, "bin"))

import perfil  # noqa: E402
import corregir  # noqa: E402

NOTA = textwrap.dedent("""\
    ---
    fecha: 2026-10-20
    participantes: ["Matías (PO)", "Rocío (la separación de voces, x)", "Ana"]
    tags: [reunion, minuta]
    ---
    # Reunión de prueba

    ### Tablero
    - Matías pidió prioridades

    ### Próximos pasos
    - [ ] Matías — revisar tablero — lunes
    - [x] Ana — enviar acta — hoy

    ## Personas
    - **Matías** (PO): pide prioridades

    ## Feedback para Ana
    - **Veredicto:** bien
    - **Puntajes:** Claridad 7 · Escucha 7 · Preguntas 7 · Cierre 7

    ## Métricas
    | Habla | Matías 3 min, Persona 2 2 min |

    ## Transcripción
    > [!note]- Transcripción completa (automática)
    > [00:00:01] Matías (PO): hola
    > [00:00:05] Persona 2: qué tal
    """)


def ia_falsa(respuesta):
    """Deja un `claude` falso en el PATH que responde siempre lo mismo."""
    ruta = os.path.join(BIN_FALSO, "claude")
    with open(ruta, "w", encoding="utf-8") as f:
        f.write("#!/bin/bash\ncat > /dev/null\ncat <<'RESPUESTA'\n" + respuesta + "\nRESPUESTA\n")
    os.chmod(ruta, 0o755)


class Nombres(unittest.TestCase):
    def test_casos_compartidos(self):
        for entrada, esperado in CASOS["limpiar"]:
            with self.subTest(entrada=entrada):
                self.assertEqual(perfil.limpiar_nombre(entrada), esperado)

    def test_participantes(self):
        for bruto, esperado in CASOS["participantes"]:
            with self.subTest(bruto=bruto):
                vistos, lista = set(), []
                for n in map(perfil.limpiar_nombre, corregir.leer_participantes(f"---\nparticipantes: {bruto}\n---\n")):
                    if n and n.lower() not in vistos:
                        vistos.add(n.lower())
                        lista.append(n)
                self.assertEqual(lista, esperado)


class Corregir(unittest.TestCase):
    def setUp(self):
        self.ruta = os.path.join(NOTAS, "nota.md")
        with open(self.ruta, "w", encoding="utf-8") as f:
            f.write(NOTA)
        self.instr = os.path.join(HOME, "instruccion.txt")
        with open(self.instr, "w", encoding="utf-8") as f:
            f.write("Matías es el Scrum Master y la Persona 2 es Jorge, el TL")
        self.salida = os.path.join(HOME, "salida.json")
        shutil.rmtree(os.path.join(HOME, "minuta", "respaldos"), ignore_errors=True)

    def correr(self):
        subprocess.run([sys.executable, os.path.join(RAIZ, "bin", "corregir.py"), self.ruta, self.instr, self.salida],
                       check=True, capture_output=True, env=os.environ)
        with open(self.salida, encoding="utf-8") as f:
            return json.load(f)

    def test_aplica_la_correccion(self):
        nueva = NOTA.split("---\n", 2)[2].split("\n## Métricas")[0].replace("(PO)", "(Scrum Master)")
        ia_falsa(f"RENOMBRAR: Persona 2 => Jorge\nRECORDAR: Matías es el Scrum Master | Jorge es el TL\nCAMBIOS: Rol de Matías.\n===NOTA===\n{nueva}")
        r = self.correr()
        self.assertTrue(r["ok"], r)
        texto = open(self.ruta, encoding="utf-8").read()
        self.assertIn("**Matías** (Scrum Master)", texto)
        self.assertIn("> [00:00:05] Jorge: qué tal", texto)
        self.assertIn("> [00:00:01] Matías: hola", texto)  # quita comentarios viejos de quién habla
        self.assertIn('participantes: ["Matías", "Rocío", "Jorge"]', texto)  # sin la propia usuaria
        self.assertIn("- [x] Ana — enviar acta — hoy", texto)
        self.assertTrue(os.listdir(os.path.join(HOME, "minuta", "respaldos")))
        self.assertEqual([h["texto"] for h in perfil.hechos()][-2:], ["Matías es el Scrum Master", "Jorge es el TL"])

    def test_no_aplica_si_se_pierde_la_estructura(self):
        ia_falsa("RENOMBRAR: ninguno\nRECORDAR: ninguno\nCAMBIOS: x\n===NOTA===\n# Reunión de prueba\n\nSolo esto.")
        r = self.correr()
        self.assertFalse(r["ok"])
        self.assertEqual(open(self.ruta, encoding="utf-8").read(), NOTA)

    def test_no_aplica_si_cambian_las_casillas(self):
        nueva = NOTA.split("---\n", 2)[2].split("\n## Métricas")[0].replace("- [x]", "- [ ]")
        ia_falsa(f"RENOMBRAR: ninguno\nRECORDAR: ninguno\nCAMBIOS: x\n===NOTA===\n{nueva}")
        self.assertFalse(self.correr()["ok"])


class LimpiarNotas(unittest.TestCase):
    def test_ordena_nombres_viejos(self):
        ruta = os.path.join(NOTAS, "vieja.md")
        with open(ruta, "w", encoding="utf-8") as f:
            f.write(NOTA)
        subprocess.run([sys.executable, os.path.join(RAIZ, "bin", "limpiar_notas.py")], check=True, capture_output=True, env=os.environ)
        texto = open(ruta, encoding="utf-8").read()
        self.assertIn('participantes: ["Matías", "Rocío"]', texto)
        self.assertIn("> [00:00:01] Matías: hola", texto)
        self.assertIn("### Próximos pasos", texto)


class Ejemplos(unittest.TestCase):
    def test_compromisos_abiertos(self):
        carpeta = tempfile.mkdtemp(dir=HOME)
        with open(os.path.join(carpeta, "n.md"), "w", encoding="utf-8") as f:
            f.write(NOTA)
        r = subprocess.run([sys.executable, os.path.join(RAIZ, "ejemplos", "compromisos_abiertos.py"), carpeta, "--csv"],
                           check=True, capture_output=True, text=True, encoding="utf-8")
        self.assertIn("Matías,revisar tablero,lunes,,Reunión de prueba,2026-10-20", r.stdout)
        self.assertNotIn("enviar acta", r.stdout)  # los marcados con [x] no salen

    def test_reuniones_a_csv(self):
        carpeta = tempfile.mkdtemp(dir=HOME)
        with open(os.path.join(carpeta, "n.md"), "w", encoding="utf-8") as f:
            f.write(NOTA.replace("Claridad 7 · Escucha 7", "Claridad 6 · Escucha 8"))
        with open(os.path.join(carpeta, "otra.md"), "w", encoding="utf-8") as f:
            f.write("# Apuntes sueltos\n\nsin frontmatter")
        r = subprocess.run([sys.executable, os.path.join(RAIZ, "ejemplos", "reuniones_a_csv.py"), carpeta],
                           check=True, capture_output=True, text=True, encoding="utf-8")
        filas = list(csv.DictReader(io.StringIO(r.stdout)))
        self.assertEqual(len(filas), 1)  # la nota sin frontmatter no cuenta
        self.assertEqual(filas[0], {"fecha": "2026-10-20", "hora": "", "tipo": "", "titulo": "Reunión de prueba", "duracion_min": "",
                                    "habla_yo_pct": "", "participantes": "Matías (PO); Rocío (la separación de voces, x); Ana",
                                    "claridad": "6", "escucha": "8", "preguntas": "7", "cierre": "7", "archivo": "n.md"})


class Universos(unittest.TestCase):
    def test_incluidos_validos(self):
        sys.path.insert(0, os.path.join(RAIZ, "bin"))
        import universo
        for f in sorted(os.listdir(os.path.join(RAIZ, "universos"))):
            if not f.endswith(".json") or f.startswith("_"):
                continue
            with self.subTest(universo=f):
                with open(os.path.join(RAIZ, "universos", f), encoding="utf-8") as a:
                    u = json.load(a)
                self.assertTrue(1 <= len(u.get("categorias", [])) <= 4)
                self.assertTrue(set(u["categorias"]) <= set(universo.CATEGORIAS))
                self.assertEqual(len(u["rangos"]), 10)


if __name__ == "__main__":
    try:
        unittest.main(verbosity=2)
    finally:
        shutil.rmtree(HOME, ignore_errors=True)
