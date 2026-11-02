// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Pieza «host-escritorio»: vigilar la carpeta de la persona (equivale a `Vigilante` de «host-mac», que usa FSEvents). Si un
// archivo que la app tiene abierto cambia en el disco (otro editor, git pull…), la app se entera; si cambia algo más de la carpeta,
// también (para volver a listarla). Sin nada de una app adentro.
//
// La app recuerda el último texto que leyó o escribió de cada archivo abierto (`conocer(ruta, texto)`): así lo que escribe ella
// misma nunca se avisa como un cambio de afuera (el texto queda conocido ANTES de escribirlo). Cuando fs.watch avisa algo que
// puede importar (un archivo con una de las `extensiones`, o una carpeta), se espera a que la carpeta quede quieta y:
//   1. se relee cada archivo conocido; si su texto no es el conocido → alCambiarArchivo(ruta, texto);
//   2. alCambiar(base): la app vuelve a listar si quiere.
// Windows y Mac: fs.watch recursivo (nativo). Linux: un fs.watch por carpeta (inotify), sin entrar a .git, node_modules y otras
// carpetas pesadas, con un máximo de carpetas; se vuelven a revisar en cada cambio. Sin Electron: se prueba con Node.
"use strict";
const fs = require("fs");
const path = require("path");
const { dentro } = require("./enchufe");

/** Carpetas que nunca cuentan (pesadas o con secretos). */
const FUERA = new Set([".git", "node_modules", ".venv", "venv", "env", "__pycache__", ".mypy_cache", ".pytest_cache", ".tox", "dist", "build",
  ".next", ".nuxt", "target", ".gradle", ".idea", ".terraform", ".aws", ".ssh", ".gnupg", ".cache", "Pods", "DerivedData", ".build"]);
const MAX_CARPETAS = 3000;
const PROFUNDIDAD = 8;

/** El texto de un archivo (UTF-8; lo que no lo es se reemplaza), o null si no es un archivo o pesa más que `maximo`. */
function leerTexto(ruta, maximo) {
  try {
    const st = fs.statSync(ruta);
    if (!st.isFile() || st.size > maximo) return null;
    return fs.readFileSync(ruta).toString("utf8");
  } catch { return null; }
}

class Vigilante {
  /**
   * @param {object} o
   * @param {string[]} [o.extensiones]  [".md", ".mmd"]: solo esos archivos (y las carpetas) cuentan. Sin esto, todo.
   * @param {function} [o.alCambiarArchivo]  (ruta, texto): un archivo conocido cambió afuera
   * @param {function} [o.alCambiar]  (base): algo de la carpeta cambió (para volver a listar)
   * @param {number} [o.espera]  ms de calma antes de revisar (350)
   * @param {number} [o.maximo]  bytes de un archivo que se relee (2 MB)
   */
  constructor({ extensiones = null, alCambiarArchivo = () => {}, alCambiar = null, espera = 350, maximo = 2 * 1024 * 1024, fuera = FUERA, plataforma = process.platform } = {}) {
    Object.assign(this, { extensiones: extensiones && extensiones.map((e) => e.toLowerCase()), alCambiarArchivo, alCambiar, espera, maximo, fuera, plataforma });
    this.base = null;
    this.conocidos = new Map();  // ruta relativa → último texto que la app leyó o escribió
    this._vigias = new Map();    // carpeta absoluta → FSWatcher
    this._reloj = null;
    this._revisando = false;
    this._otraVez = false;
  }

  /** ¿Puede importar este nombre (relativo a la carpeta)? Un archivo de las extensiones o algo sin extensión (una carpeta). */
  importa(relativa) {
    if (!relativa) return true;
    const partes = String(relativa).split(/[\\/]/);
    if (partes.some((p) => this.fuera.has(p))) return false;
    if (!this.extensiones) return true;
    const ext = path.extname(partes[partes.length - 1]).toLowerCase();
    return ext === "" || this.extensiones.includes(ext);
  }

  /** La ruta absoluta de `relativa` dentro de la carpeta vigilada (la guarda de nucleo.ruta_en), o null. */
  absoluta(relativa) { return this.base ? dentro(this.base, relativa, { extensiones: this.extensiones }) : null; }

  empezar(base) {
    if (this.base === base && this._vigias.size) return;
    this.detener();
    this.base = base;
    this.conocidos = new Map();
    if (this.plataforma === "win32" || this.plataforma === "darwin") this._vigiar(base, true);
    else this._sincronizarCarpetas();
  }

  detener() {
    for (const w of this._vigias.values()) { try { w.close(); } catch {} }
    this._vigias.clear();
    clearTimeout(this._reloj);
    this.base = null;
  }

  /** Recuerda el texto que la app leyó o escribió (así lo suyo no se avisa como un cambio de afuera). Sin texto, lo olvida. */
  conocer(ruta, texto) { if (typeof texto === "string") this.conocidos.set(ruta, texto); else this.conocidos.delete(ruta); }
  olvidar(ruta) { this.conocidos.delete(ruta); }

  _vigiar(dir, recursivo) {
    if (this._vigias.has(dir)) return;
    try {
      const w = fs.watch(dir, { recursive: recursivo, persistent: false }, (_tipo, nombre) => {
        const rel = recursivo ? nombre : path.relative(this.base || dir, path.join(dir, String(nombre || "")));
        if (this.importa(rel)) this.programar();
      });
      w.on("error", () => { try { w.close(); } catch {} this._vigias.delete(dir); });
      this._vigias.set(dir, w);
    } catch { /* sin permiso o se borró: no pasa nada */ }
  }

  /** Linux: un vigía por carpeta. Agrega las nuevas y quita las que ya no están. */
  _sincronizarCarpetas() {
    if (!this.base) return;
    const vistas = new Set();
    const pila = [[this.base, 0]];
    while (pila.length && vistas.size < MAX_CARPETAS) {
      const [dir, nivel] = pila.pop();
      vistas.add(dir);
      if (nivel >= PROFUNDIDAD) continue;
      let entradas = [];
      try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entradas) if (e.isDirectory() && !e.isSymbolicLink() && !this.fuera.has(e.name)) pila.push([path.join(dir, e.name), nivel + 1]);
    }
    for (const [dir, w] of this._vigias) if (!vistas.has(dir)) { try { w.close(); } catch {} this._vigias.delete(dir); }
    for (const dir of vistas) this._vigiar(dir, false);
  }

  /** Un editor o git escriben varias veces seguidas: se espera a que la carpeta quede quieta. */
  programar() {
    clearTimeout(this._reloj);
    this._reloj = setTimeout(() => this.revisar(), this.espera);
  }

  async revisar() {
    const base = this.base;
    if (!base) return;
    if (this._revisando) { this._otraVez = true; return; }
    this._revisando = true;
    try {
      for (const [ruta, conocido] of this.conocidos) {
        const abs = this.absoluta(ruta);
        const texto = abs && leerTexto(abs, this.maximo);
        if (texto == null || texto === conocido) continue;
        this.conocidos.set(ruta, texto);
        this.alCambiarArchivo(ruta, texto);
      }
      if (this.plataforma !== "win32" && this.plataforma !== "darwin") this._sincronizarCarpetas();
      if (this.alCambiar && this.base === base) await this.alCambiar(base);
    } finally {
      this._revisando = false;
      if (this._otraVez) { this._otraVez = false; this.programar(); }
    }
  }
}

module.exports = { Vigilante, leerTexto, FUERA };
