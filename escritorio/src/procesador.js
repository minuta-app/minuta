// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Pieza «host-escritorio»: corre los scripts de bin/ con el Python portátil de la app. Sin Electron adentro (se prueba en Node).
// Equivale a Procesador.swift de «host-mac». Contrato (nucleo.script): `script.py <args…> [entrada.json] <salida.json>`.
//   · Lo que manda la interfaz va en el archivo de entrada, nunca como argumento (cualquier programa ve los argumentos).
//   · Un secreto (la llave de un conector) va por la entrada estándar: nunca en un archivo, un argumento ni el entorno.
//   · Ninguna variable <ID>_* de afuera llega al script: solo las que pone el host (<ID>_RECURSOS, <ID>_DATOS…).
//   · Todo tiene límite de tiempo: al cumplirse se corta el script y lo que haya lanzado (su grupo de procesos). Un trabajo largo
//     ({latido: true}, «limite»: "trabajo") no tiene tope, pero tiene que latir (pieza «trabajos»: <ID>_LATIDO): si deja de latir,
//     se corta igual.
//   · Al salir de la app se corta lo que siga corriendo (cortarTodo): un trabajo queda «interrumpido» y se sigue después.
//   · Entrada y salida viven en una carpeta temporal propia (0700) que se borra al terminar.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { SCRIPT, leerJSON } = require("./enchufe");

const ES_WIN = process.platform === "win32";
const TEXTOS = {
  limite: "Tardó demasiado y lo detuve. Intenta de nuevo.",
  latido: "Dejó de avanzar y lo detuve. Intenta de nuevo.",
  fallo: "No pude terminar. Intenta de nuevo.",
};
const MAX_SALIDA_ESTANDAR = 1024 * 1024;
const VARIABLE = /^[A-Z][A-Z0-9_]{0,60}$/;

/**
 * @param {object} o
 * @param {string} o.python    ejecutable de Python
 * @param {string} o.recursos  raíz del código de la app (bin/ adentro)
 * @param {string} o.id        id de app.json (prefijo de las variables)
 * @param {string} o.datos     carpeta de datos (va en <ID>_DATOS)
 * @param {function} [o.t]     traducir (para `error`, que leen las interfaces de antes)
 * @param {function} [o.lectorProgreso]  pieza «trabajos» (progreso.js): lectorProgreso(aviso, {prefijo})
 * @param {number} [o.gracia]  segundos entre pedir que termine y cortarlo (3)
 * @param {object} [o.latido]  {muerto: 45, primero: 120, revisar: 5} segundos: un trabajo sin latido por más de `muerto` se corta
 */
function crearProcesador({ python, recursos, id, datos, t = (x) => x, lectorProgreso = null, gracia = 3, registro = console.error, latido: tiempos = {} }) {
  const P = id.toUpperCase() + "_";
  const L = { muerto: 45, primero: 120, revisar: 5, ...tiempos };
  const vivos = new Set();
  const yo = {
    enCurso: 0,
    /** Detiene todo lo que sigue corriendo (y lo que lanzó). Lo llama el host al salir. */
    cortarTodo() { for (const p of vivos) matar(p, "SIGTERM"); },
    /** Lo de bajo nivel: devuelve {respuesta, salidaEstandar, porLimite}. `latido: true`: sin tope mientras el script lata. */
    correr(script, args = [], { secreto = null, progreso = null, limite = 120, latido = false, entorno = {}, entrada = null } = {}) {
      return new Promise((fin) => {
        const falla = (error, extra = {}) => ({ respuesta: { ok: false, error, ...extra }, salidaEstandar: "", porLimite: false });
        if (typeof script !== "string" || !SCRIPT.test(script)) return fin(falla("script raro"));
        const ruta = path.join(recursos, "bin", script);
        if (!fs.existsSync(ruta)) return fin(falla(`no está bin/${script}`));
        if (!Array.isArray(args) || !args.every((a) => typeof a === "string" && !a.includes("\0"))) return fin(falla("argumentos raros"));
        const segundos = Number.isFinite(limite) && limite > 0 ? Math.min(limite, 3600) : 120;
        let dir;
        try { dir = fs.mkdtempSync(path.join(os.tmpdir(), `${id}-`)); if (!ES_WIN) fs.chmodSync(dir, 0o700); } catch (e) { return fin(falla(e.message)); }
        const salida = path.join(dir, "salida.json");
        const argsFinal = [...args];
        if (entrada !== null) {
          const archivo = path.join(dir, "entrada.json");
          try { fs.writeFileSync(archivo, JSON.stringify(entrada), { mode: 0o600, flag: "wx" }); } catch (e) { borrar(dir); return fin(falla(e.message)); }
          argsFinal.push(archivo);
        }
        const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith(P)));
        for (const [k, v] of Object.entries(entorno || {})) if (VARIABLE.test(k) && typeof v === "string") env[k] = v;
        Object.assign(env, { [P + "RECURSOS"]: recursos, [P + "DATOS"]: datos, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1" });
        const lector = progreso && lectorProgreso ? lectorProgreso(progreso, { prefijo: id }) : null;
        if (lector) env[P + "PROGRESO"] = lector.ruta;
        // Un trabajo late tocando este archivo (trabajos.latir_host): el host mira cuándo fue la última vez.
        const archivoLatido = path.join(dir, "latido");
        if (latido) {
          try { fs.writeFileSync(archivoLatido, "", { mode: 0o600, flag: "wx" }); } catch {}
          env[P + "LATIDO"] = archivoLatido;
        }
        let p, out = "", err = "", porLimite = false, terminado = false, reloj = null, corte = null, vigia = null;
        yo.enCurso++;
        const terminar = () => {
          if (terminado) return;
          terminado = true;
          clearTimeout(reloj); clearTimeout(corte); clearInterval(vigia);
          vivos.delete(p);
          yo.enCurso--;
          if (lector) lector.terminar();
          let r = porLimite ? null : leerJSON(salida, null);
          if (!r && err && !porLimite) registro(`${id}: ${script}`, err.slice(-600));
          borrar(dir);
          if (porLimite && latido) r = { ok: false, codigo: "limite", texto: TEXTOS.latido, valores: {}, error: t(TEXTOS.latido) };
          else if (porLimite) r = { ok: false, codigo: "limite", texto: TEXTOS.limite, valores: { s: segundos }, error: t(TEXTOS.limite) };
          else if (!r || typeof r !== "object" || Array.isArray(r)) r = { ok: false, codigo: "fallo", texto: TEXTOS.fallo, valores: {}, error: t(TEXTOS.fallo) };
          fin({ respuesta: r, salidaEstandar: out, porLimite });
        };
        try {
          p = spawn(python, [ruta, ...argsFinal, salida], {
            env, cwd: dir, windowsHide: true,
            // Un grupo propio (POSIX): al cumplirse el límite se corta el script y lo que haya lanzado (la IA, ffmpeg…).
            detached: !ES_WIN,
            stdio: [secreto !== null ? "pipe" : "ignore", secreto !== null ? "pipe" : "ignore", "pipe"],
          });
        } catch (e) { yo.enCurso--; terminado = true; borrar(dir); if (lector) lector.terminar(); return fin(falla(e.message)); }
        vivos.add(p);
        p.stderr.on("data", (d) => { if (err.length < 4000) err += d; });
        if (p.stdout) p.stdout.on("data", (d) => { if (out.length < MAX_SALIDA_ESTANDAR) out += d; });
        p.on("error", (e) => { err += String(e && e.message); terminar(); });
        p.on("close", terminar);
        if (secreto !== null) { p.stdin.on("error", () => {}); p.stdin.end(String(secreto)); }
        const cortar = () => {
          if (porLimite) return;
          porLimite = true;
          matar(p, "SIGTERM");
          corte = setTimeout(() => matar(p, "SIGKILL"), gracia * 1000);
        };
        if (latido) {
          // Sin tope, pero si el archivo del latido no se tocó hace más de `muerto` (el primero tiene `primero`), se corta.
          const inicio = Date.now();
          vigia = setInterval(() => {
            let tocado = inicio;
            try { tocado = fs.statSync(archivoLatido).mtimeMs; } catch {}
            const ultimo = Math.max(tocado, inicio + (L.primero - L.muerto) * 1000);
            if (Date.now() - ultimo > L.muerto * 1000) { clearInterval(vigia); cortar(); }
          }, L.revisar * 1000);
        } else {
          reloj = setTimeout(cortar, segundos * 1000);
        }
      });
    },
    /** El JSON de salida del script (o {ok: false, codigo, texto, error}). */
    async correrJSON(script, args = [], opciones = {}) {
      return (await yo.correr(script, args, opciones)).respuesta;
    },
    /** Lo que manda la interfaz va en un archivo de entrada (después de `args`, antes de la salida). `args` puede ser la acción
     *  sola («leer») o una lista de literales. */
    async conEntrada(script, args, datos, opciones = {}) {
      const lista = Array.isArray(args) ? args : [args];
      return (await yo.correr(script, lista, { ...opciones, entrada: datos && typeof datos === "object" ? datos : {} })).respuesta;
    },
  };
  return yo;
}

function matar(p, senal) {
  if (!p || p.exitCode !== null || p.signalCode !== null) return;
  try {
    if (ES_WIN) spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else process.kill(-p.pid, senal);
  } catch { try { p.kill(senal); } catch {} }
}

function borrar(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }

/** Una fila: las tareas corren de a una y en el orden en que llegaron (guardar nunca pisa un guardado más nuevo). */
function crearFila() {
  let cola = Promise.resolve();
  const fila = {
    pendientes: 0,
    agregar(tarea) {
      fila.pendientes++;
      const r = cola.then(tarea).finally(() => { fila.pendientes--; });
      cola = r.catch(() => {});
      return r;
    },
  };
  return fila;
}

module.exports = { crearProcesador, crearFila, TEXTOS };
