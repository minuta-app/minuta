// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Pieza «catálogo» (Windows y Linux, Electron). Equivale a app/Sources/PiezaCatalogo/Catalogo.swift.
// Baja el índice y los archivos de un catálogo de la comunidad SOLO desde https://raw.githubusercontent.com/<repo>/<rama>/, sin
// seguir redirecciones, con tamaño máximo (cortado al leer). El índice lo valida bin/catalogo.py (con el validador que pone la
// app); cada archivo se busca solo en ese índice validado (nunca en lo que manda la interfaz) y se compara su tamaño y su SHA-256
// antes de que Python lo vuelva a validar y lo guarde en la carpeta de datos de la app.
//
// Nada de la app adentro: repo y tipos salen de app.json (sección «catalogo»), y fetch y el Procesador llegan como parámetros
// (net.fetch en la app; así se prueba en Node sin Electron).
//
//   const { crear } = require("./catalogo");
//   const cat = crear({ fetch: net.fetch, procesador: Procesador, appJson: leerJSON(".../app.json"), agente: "Ana/1.2.0" });
//   ACCIONES.catalogo = async ({ tipo }) => llamar("catalogoListo", await cat.listar(tipo));
//   ACCIONES.descargarDelCatalogo = async ({ tipo, id }) => llamar("catalogoDescargado", await cat.descargar(tipo, id));
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOST = "raw.githubusercontent.com";
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const RAMA = /^[A-Za-z0-9._-]{1,60}$/;
const TIPO = /^[a-z][a-z0-9-]{0,30}$/;
const INDICE = /^(?:[a-z0-9-]+\/)?[a-z0-9-]+\.json$/;
const ID = "[a-z0-9]+(?:-[a-z0-9]+)*";
/** Frases en español (claves de traducción): la interfaz las muestra con Tp(plantilla). Las mismas de bin/catalogo.py. */
const ERRORES = {
  sin_conexion: "No pude conectarme. Revisa tu conexión.",
  indice: "No pude leer el catálogo.",
  no_valido: "Eso no es válido.",
  danado: "Llegó dañado. Intenta de nuevo.",
  no_esta: "Ya no está en el catálogo. Vuelve a abrirlo.",
};
const error = (codigo, extra = {}) => ({ ok: false, codigo, plantilla: ERRORES[codigo], error: ERRORES[codigo], ...extra });

const entero = (v, defecto, tope) => (Number.isInteger(v) && v > 0 && v <= tope ? v : defecto);

/** La sección «catalogo» de app.json, validada igual que en bin/catalogo.py (config()). Lanza si no sirve. */
function leerConfig(appJson) {
  const c = appJson && appJson.catalogo;
  if (!c || !REPO.test(String(c.repo || ""))) throw new Error("app.json: «catalogo.repo» debe ser «dueño/repo».");
  const rama = c.rama === undefined ? "main" : c.rama;
  if (typeof rama !== "string" || !RAMA.test(rama) || rama.includes("..")) throw new Error("app.json: «catalogo.rama» no es válida.");
  const tipos = {};
  for (const [id, t] of Object.entries(c.tipos || {})) {
    if (!TIPO.test(id) || !t || typeof t !== "object") throw new Error(`app.json: tipo de catálogo raro «${id}».`);
    const indice = t.indice === undefined ? `${id}/index.json` : t.indice;
    if (typeof indice !== "string" || !INDICE.test(indice)) throw new Error(`app.json: «catalogo.tipos.${id}.indice» no es válido.`);
    tipos[id] = {
      id, indice,
      maxBytes: entero(t.max_bytes, 100 * 1024, 5 * 1024 * 1024),
      maxIndice: entero(t.max_indice, 1024 * 1024, 20 * 1024 * 1024),
      patron: new RegExp(`^${id}/${ID}/${ID}\\.json$`),
    };
  }
  return { repo: c.repo, rama, base: `https://${HOST}/${c.repo}/${rama}/`, tipos };
}

/** { fetch, procesador: {correrJSON, conEntrada}, appJson, agente }. */
function crear({ fetch, procesador, appJson, agente = "Pieza" }) {
  const conf = leerConfig(appJson);
  /** Lo último que validó Python por tipo: de aquí salen la ruta, el tamaño y la huella de cada descarga. */
  const indices = {};

  /** Pide `ruta` (relativa a la base): los bytes solo si es un 200 del mismo dominio y sin redirecciones; `false` si pasa del
   *  máximo (llegó algo que no es lo del índice); `null` si no se pudo. */
  async function pedir(ruta, maximo) {
    let u;
    try { u = new URL(conf.base + ruta); } catch { return null; }
    if (u.protocol !== "https:" || u.host !== HOST || !u.pathname.startsWith(`/${conf.repo}/${conf.rama}/`) || u.search || u.hash) return null;
    let r;
    try {
      r = await fetch(u.toString(), { redirect: "error", cache: "no-store", credentials: "omit", headers: { "User-Agent": agente } });
    } catch { return null; }
    try { if (r.status !== 200 || r.redirected || (r.url && new URL(r.url).host !== HOST)) return null; } catch { return null; }
    if (Number(r.headers?.get?.("content-length")) > maximo) return false;
    // Se lee de a pedazos y se corta apenas pasa del máximo (un archivo enorme nunca llega entero a la memoria).
    if (r.body?.getReader) {
      const lector = r.body.getReader();
      const partes = [];
      let total = 0;
      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        total += value.length;
        if (total > maximo) { try { await lector.cancel(); } catch {} return false; }
        partes.push(Buffer.from(value));
      }
      return Buffer.concat(partes);
    }
    const b = Buffer.from(await r.arrayBuffer());
    return b.length > maximo ? false : b;
  }

  function temporal(datos) {
    const u = path.join(os.tmpdir(), `pieza-catalogo-${crypto.randomUUID()}.json`);
    fs.writeFileSync(u, datos, { mode: 0o600, flag: "wx" });
    return u;
  }

  return {
    config: conf,
    /** El índice de un tipo, validado por Python: { ok, tipo, <tipo>: [...] } o { ok: false, codigo, plantilla, error }. */
    async listar(tipo) {
      const t = conf.tipos[tipo];
      if (!t) return error("no_valido", { tipo: String(tipo || "") });
      const datos = await pedir(t.indice, t.maxIndice);
      if (datos === false) return error("indice", { tipo });
      if (!datos) return error("sin_conexion", { tipo });
      const archivo = temporal(datos);
      try {
        const r = await procesador.conEntrada("catalogo.py", "indice", { tipo, archivo });
        if (!r || r.ok !== true || !Array.isArray(r[tipo])) return error("indice", { tipo });
        indices[tipo] = r[tipo];
        return r;
      } finally { try { fs.unlinkSync(archivo); } catch {} }
    },

    /** Descarga uno del índice validado, revisa tamaño y huella, y Python lo valida y lo guarda. */
    async descargar(tipo, id) {
      const t = conf.tipos[tipo];
      const malo = (c) => error(c, { tipo: String(tipo || ""), id: typeof id === "string" ? id : "" });
      if (!t || typeof id !== "string") return malo("no_valido");
      const e = (indices[tipo] || []).find((x) => x && x.id === id);
      if (!e) return malo("no_esta");
      if (typeof e.ruta !== "string" || !t.patron.test(e.ruta) || !/^[0-9a-f]{64}$/.test(e.sha256 || "")
          || !Number.isInteger(e.tamano) || e.tamano <= 0 || e.tamano > t.maxBytes) return malo("no_valido");
      const datos = await pedir(e.ruta, e.tamano);
      if (datos === false) return malo("danado");
      if (!datos) return malo("sin_conexion");
      const huella = crypto.createHash("sha256").update(datos).digest("hex");
      if (datos.length !== e.tamano || huella !== e.sha256) return malo("danado");
      const archivo = temporal(datos);
      try {
        const r = await procesador.conEntrada("catalogo.py", "instalar", { tipo, archivo, id, sha256: huella });
        return r && r.ok === true ? r : { ...malo((r && ERRORES[r.codigo]) ? r.codigo : "no_valido") };
      } finally { try { fs.unlinkSync(archivo); } catch {} }
    },
  };
}

module.exports = { crear, leerConfig, HOST, ERRORES };
