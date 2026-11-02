// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Pieza «host-escritorio»: la lógica del host que no necesita Electron (se prueba en Node). Equivale a Host.swift y
// Enchufe.swift de la pieza «host-mac», con las mismas reglas que bin/nucleo.py y herramientas/pieza.py:
//   · app.json: id, nombre, carpeta de datos y claves de config permitidas (lo demás se descarta);
//   · idioma: el elegido o el del sistema, y las frases de ui/idiomas/<codigo>.json;
//   · acciones declaradas (acciones.json, lo arma pieza.py con los pieza.json y app.json): se validan al cargar y cada mensaje
//     de la interfaz se valida contra sus reglas antes de correr nada;
//   · dentro(base, relativa): la misma guarda que nucleo.ruta_en.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const ID = /^[a-z][a-z0-9]{0,30}$/;
const ACCION = /^[A-Za-z][A-Za-z0-9]{0,60}$/;
const FUNCION = ACCION;
const SCRIPT = /^\w+\.py$/;
const LITERAL = /^[\w.-]+$/;
const CAMPO = /^[A-Za-z_]\w{0,60}$/;
const TIPOS = new Set(["texto", "enum", "bool", "entero", "rutaRelativa", "base64", "lista"]);
const MAXIMO_ENTRADA = 5 * 1024 * 1024;   // lo que puede pesar la entrada de una acción, salvo que diga «maximo»
const TOPE_ENTRADA = 50 * 1024 * 1024;    // «maximo» como mucho
const MAXIMO_JSON = 50 * 1024 * 1024;
const PROHIBIDOS = new Set(["__proto__", "constructor", "prototype"]);

function leerJSON(ruta, defecto = null, maximo = MAXIMO_JSON) {
  try {
    if (fs.statSync(ruta).size > maximo) return defecto;
    return JSON.parse(fs.readFileSync(ruta, "utf8"));
  } catch { return defecto; }
}

const esObjeto = (x) => !!x && typeof x === "object" && !Array.isArray(x);

/** Escribe de una vez: temporal en la misma carpeta + renombrar. Un archivo nuevo queda solo para la persona (0600). */
function escribirAtomico(ruta, contenido, modo = 0o600) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = path.join(path.dirname(ruta), `.pieza-${crypto.randomBytes(6).toString("hex")}`);
  fs.writeFileSync(tmp, contenido, { mode: modo, flag: "wx" });
  try { fs.renameSync(tmp, ruta); } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
}

// ───────────── app.json ─────────────
/** La descripción de la app, validada igual que nucleo.app(). Lanza un error si no sirve: sin app.json no hay app. */
function leerApp(recursos) {
  const d = leerJSON(path.join(recursos, "app.json"), null, 1024 * 1024);
  if (!esObjeto(d) || typeof d.id !== "string" || !ID.test(d.id)) {
    throw new Error("app.json: falta o no sirve «id» (minúsculas y números, ej. «ana»).");
  }
  return {
    ...d,
    nombre: typeof d.nombre === "string" && d.nombre ? d.nombre : d.id[0].toUpperCase() + d.id.slice(1),
    datos: d.datos === undefined ? "sistema" : d.datos,
    config: esObjeto(d.config) ? d.config : {},
  };
}

/** La carpeta de datos de la app, la misma que nucleo.carpeta_datos() (sin la variable <ID>_DATOS: esa la pone el host). */
function carpetaDatos(a, { plataforma = process.platform, casa = os.homedir(), env = process.env } = {}) {
  if (esObjeto(a.datos)) {
    const casaReal = (() => { try { return fs.realpathSync(casa); } catch { return path.resolve(casa); } })();
    const crudo = String(a.datos.carpeta || "");
    const ruta = path.resolve(crudo.startsWith("~") ? path.join(casaReal, crudo.slice(1)) : crudo);
    if (!ruta.startsWith(casaReal + path.sep)) throw new Error("app.json: «datos.carpeta» tiene que estar dentro de la carpeta de la persona (~/…).");
    return ruta;
  }
  if (a.datos === "visible") return path.join(casa, a.nombre, "." + a.id);
  if (plataforma === "darwin") return path.join(casa, "Library", "Application Support", a.nombre);
  if (plataforma === "win32") return path.join(env.APPDATA || path.join(casa, "AppData", "Roaming"), a.nombre);
  return path.join(env.XDG_CONFIG_HOME || path.join(casa, ".config"), a.id);
}

/** Crea la carpeta solo para la persona (0700). Una carpeta propia de app.json ({"carpeta": …}) se usa tal cual. Con
 *  `visible` (app.json → "datos": "visible"), ~/<Nombre> recién creada también queda 0700, como en nucleo.carpeta_datos() (una que
 *  ya existía no se toca). */
function prepararCarpeta(ruta, { propia = false, visible = false } = {}) {
  if (propia) return ruta;
  const arriba = path.dirname(ruta);
  if (visible && !fs.existsSync(arriba)) {
    fs.mkdirSync(arriba, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") { try { fs.chmodSync(arriba, 0o700); } catch {} }
  }
  fs.mkdirSync(ruta, { recursive: true });
  if (process.platform !== "win32") { try { fs.chmodSync(ruta, 0o700); } catch {} }
  return ruta;
}

// ───────────── Configuración (las mismas reglas que nucleo._valida) ─────────────
function valida(regla, valor) {
  if (esObjeto(regla)) {
    const max = Number.isInteger(regla.max) && regla.max > 0 && regla.max <= MAXIMO_ENTRADA ? regla.max : 2000;
    if (regla.tipo === "texto" && typeof regla.patron === "string") {
      let re;
      try { re = new RegExp(`^(?:${regla.patron})$`, "u"); } catch { return false; }
      return typeof valor === "string" && valor.length <= max && re.test(valor);
    }
    if (regla.tipo === "texto" && Number.isInteger(regla.max)) return typeof valor === "string" && valor.length <= max;
    return valida(regla.tipo, valor);
  }
  if (Array.isArray(regla)) return regla.includes(valor);
  if (regla === "bool") return typeof valor === "boolean";
  if (regla === "texto") return typeof valor === "string" && valor.length <= 2000;
  if (regla === "numero") return typeof valor === "number" && Number.isFinite(valor);
  return false;
}

function limpiarConfig(reglas, datos) {
  const r = {};
  if (!esObjeto(datos)) return r;
  for (const [k, v] of Object.entries(datos)) if (Object.hasOwn(reglas, k) && !PROHIBIDOS.has(k) && valida(reglas[k], v)) r[k] = v;
  return r;
}

/** config.json en la carpeta de datos, compartido con los scripts (nucleo.config()). Solo claves de app.json; lo que llega de
 *  la interfaz nunca cambia una clave marcada "interfaz": false (esas las escribe la app con {desdeInterfaz: false}). */
function crearConfig({ ruta, reglas, preparar = () => {} }) {
  const crudo = () => { const d = leerJSON(ruta, {}, 1024 * 1024); return esObjeto(d) ? d : {}; };
  return {
    reglas,
    ruta,
    leer() { return limpiarConfig(reglas, crudo()); },
    guardar(cambios, { desdeInterfaz = true } = {}) {
      const limpios = Object.fromEntries(Object.entries(limpiarConfig(reglas, cambios))
        .filter(([k]) => !(desdeInterfaz && esObjeto(reglas[k]) && reglas[k].interfaz === false)));
      preparar();
      const d = { ...crudo(), ...limpios };
      const ordenado = Object.fromEntries(Object.keys(d).sort().map((k) => [k, d[k]]));
      escribirAtomico(ruta, JSON.stringify(ordenado, null, 1) + "\n");
      return { ...this.leer(), ...limpios };
    },
    texto(clave) { const v = this.leer()[clave]; return typeof v === "string" ? v : ""; },
  };
}

// ───────────── Idioma (las claves son el texto en español, igual que en ui/idiomas) ─────────────
/** `elegidoDe` (opcional): de dónde leer el idioma elegido si la app no lo guarda en config.json (devuelve el código o ""). */
function crearIdioma({ config, recursos, sistema = "es", elegidoDe = null }) {
  const elegidoAhora = () => { const x = elegidoDe ? elegidoDe() : config.texto("idioma_ui"); return typeof x === "string" ? x : ""; };
  const lista = Array.isArray(config.reglas.idioma_ui) ? config.reglas.idioma_ui.filter((x) => /^[a-z]{2,3}$/.test(x)) : [];
  const idiomas = lista.length ? lista : ["es", "en"];
  let cache = null;
  const yo = {
    sistema,
    idiomas,
    /** Solo uno de los idiomas de app.json (el archivo de traducciones se busca con este código: nunca otra cosa). */
    get codigo() {
      const e = elegidoAhora();
      if (idiomas.includes(e)) return e;
      const s = String(yo.sistema || "").toLowerCase().slice(0, 2);
      if (idiomas.includes(s)) return s;
      return idiomas.includes("en") ? "en" : idiomas[0];
    },
    /** Ya hay idioma: lo eligió (bienvenida o Ajustes) o terminó la bienvenida. Antes, nada corre solo ni se pide. */
    get elegido() { return !!elegidoAhora() || config.leer().bienvenida === true; },
    t(texto) {
      const c = yo.codigo;
      if (c === "es") return texto;
      if (!cache || cache.codigo !== c) {
        const j = leerJSON(path.join(recursos, "ui", "idiomas", `${c}.json`), {}, 5 * 1024 * 1024) || {};
        cache = { codigo: c, textos: esObjeto(j.textos) ? j.textos : {} };
      }
      const t = cache.textos[texto];
      return typeof t === "string" ? t : texto;
    },
    /** Una frase con marcadores ({x}, {n}…): se traduce entera y después se ponen los valores. */
    f(plantilla, valores = {}) {
      return yo.t(plantilla).replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(valores, k) ? String(valores[k]) : m));
    },
    olvidar() { cache = null; },
  };
  return yo;
}

// ───────────── Rutas que manda la interfaz (igual que nucleo.ruta_en) ─────────────
/** La ruta absoluta de `relativa` dentro de `base`, o null si se sale (absoluta, «..», enlaces hacia afuera). `extensiones`
 *  (opcional) limita el tipo de archivo. Si el archivo aún no existe, se revisa la carpeta que lo contendría. */
function dentro(base, relativa, { extensiones = null, maximo = 400 } = {}) {
  if (!esRelativa(relativa, maximo)) return null;
  if (extensiones && !extensiones.some((e) => relativa.toLowerCase().endsWith(e.toLowerCase()))) return null;
  let raiz;
  try { raiz = fs.realpathSync(base); } catch { return null; }
  let ruta = path.join(raiz, ...relativa.split(/[\\/]/));
  try { ruta = fs.realpathSync(ruta); } catch {
    try { ruta = path.join(fs.realpathSync(path.dirname(ruta)), path.basename(ruta)); } catch {}
  }
  const rel = path.relative(raiz, ruta);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? ruta : null;
}

function esRelativa(r, maximo = 400) {
  if (typeof r !== "string" || !r || r.length > maximo || r.includes("\0")) return false;
  if (/^[\\/]/.test(r) || /^[A-Za-z]:/.test(r) || path.isAbsolute(r)) return false;
  return r.split(/[\\/]/).every((p) => p !== "" && p !== "." && p !== "..");
}

// ───────────── Acciones declaradas (docs/enchufe.md, «Una acción») ─────────────
/** Las mismas reglas que herramientas/pieza.py (errores_accion): el host las vuelve a revisar al cargar, así un acciones.json
 *  cambiado a mano nunca hace correr algo que pieza.py no habría aceptado. */
function erroresAccion(nombre, a) {
  const e = [];
  const donde = `acción «${nombre}»`;
  if (!ACCION.test(nombre)) e.push(`${donde}: nombre raro`);
  if (!esObjeto(a)) return [`${donde}: no es un objeto`];
  if (typeof a.script !== "string" || !SCRIPT.test(a.script)) e.push(`${donde}: «script» debe ser nombre.py`);
  const datos = a.datos === undefined ? {} : a.datos;
  const args = a.args === undefined ? [] : a.args;
  if (!esObjeto(datos)) e.push(`${donde}: «datos» es {campo: regla}`);
  if (!Array.isArray(args) || !args.every((x) => typeof x === "string")) e.push(`${donde}: «args» es una lista de textos`);
  if (e.length) return e;
  let maximo = a.maximo === undefined ? MAXIMO_ENTRADA : a.maximo;
  if (!Number.isInteger(maximo) || maximo < 1 || maximo > TOPE_ENTRADA) {
    e.push(`${donde}: «maximo» (bytes de la entrada) es un entero hasta ${TOPE_ENTRADA}`);
    maximo = MAXIMO_ENTRADA;
  }
  for (const [campo, regla] of Object.entries(datos)) {
    if (campo === "*") { if (regla !== "pasar") e.push(`${donde}: «*» solo puede ser "pasar"`); continue; }
    if (!CAMPO.test(campo) || PROHIBIDOS.has(campo)) e.push(`${donde}: campo raro «${campo}»`);
    e.push(...erroresRegla(`${donde}: «${campo}»`, regla, maximo));
  }
  for (const arg of args) {
    if (arg.startsWith("$")) {
      const r = datos[arg.slice(1)];
      // Regla de oro: lo que escribe la persona nunca va como argumento del proceso, solo por el archivo de entrada.
      if (!esObjeto(r) || !["enum", "entero"].includes(r.tipo)) e.push(`${donde}: el argumento ${arg} solo puede ser un campo enum o entero`);
    } else if (!LITERAL.test(arg)) e.push(`${donde}: argumento literal raro «${arg}»`);
  }
  const porArchivo = Object.keys(datos).filter((k) => k === "*" || !args.includes("$" + k));
  const inyectar = a.inyectar === undefined ? {} : a.inyectar;
  if (!esObjeto(inyectar) || !Object.entries(inyectar).every(([k, v]) => CAMPO.test(k) && !PROHIBIDOS.has(k) && typeof v === "string" && CAMPO.test(v))) {
    e.push(`${donde}: «inyectar» es {campo: fuente}`);
  } else {
    for (const k of Object.keys(inyectar)) if (Object.hasOwn(datos, k)) e.push(`${donde}: «${k}» lo pone el host: no puede venir también en «datos»`);
    if (Object.keys(inyectar).length) porArchivo.push(...Object.keys(inyectar));
  }
  if (porArchivo.length && a.entrada !== "archivo") e.push(`${donde}: ${porArchivo.join(", ")} no van en args: necesita "entrada": "archivo"`);
  if (a.entrada !== undefined && a.entrada !== null && a.entrada !== "archivo") e.push(`${donde}: «entrada» es "archivo" o null`);
  e.push(...erroresLimite(donde, a.limite, datos));
  if (a.vigilar !== undefined) {
    const r = Object.hasOwn(datos, "ruta") ? datos.ruta : null, x = Object.hasOwn(datos, "texto") ? datos.texto : null;
    if (!["lee", "escribe"].includes(a.vigilar) || !(esObjeto(r) && r.tipo === "rutaRelativa") || (a.vigilar === "escribe" && !(esObjeto(x) && x.tipo === "texto"))) {
      e.push(`${donde}: «vigilar» es "lee" o "escribe", con «ruta» (rutaRelativa) en datos (y «texto» para escribe)`);
    }
  }
  if (a.responde !== undefined && a.responde !== null && !(typeof a.responde === "string" && FUNCION.test(a.responde))) e.push(`${donde}: «responde» es el nombre de una función`);
  if (a.progreso !== undefined && !(typeof a.progreso === "string" && FUNCION.test(a.progreso))) e.push(`${donde}: «progreso» es el nombre de una función`);
  for (const k of ["eco", "despues"]) {
    if (a[k] !== undefined && !(Array.isArray(a[k]) && a[k].every((x) => typeof x === "string" && (k === "eco" ? CAMPO : ACCION).test(x)))) e.push(`${donde}: «${k}» es una lista de nombres`);
  }
  if (a.cola !== undefined && a.cola !== "escritura") e.push(`${donde}: «cola» solo puede ser "escritura"`);
  return e;
}

const limiteOk = (x) => x === "trabajo" || (Number.isInteger(x) && x >= 1 && x <= 3600);

/** «limite»: segundos (1 a 3600), "trabajo" (sin tope, mientras lata: pieza «trabajos») o según el valor de un campo enum:
 *  {"segun": "orden", "valores": {"documentar": "trabajo", "leer": 60}, "otro": 120}. */
function erroresLimite(donde, limite, datos) {
  const malo = [`${donde}: «limite» es obligatorio: segundos (1 a 3600), "trabajo" o {"segun": campo, "valores": {…}, "otro": …}`];
  if (!esObjeto(limite)) return limiteOk(limite) ? [] : malo;
  const regla = typeof limite.segun === "string" && Object.hasOwn(datos, limite.segun) ? datos[limite.segun] : null;
  const ok = Object.keys(limite).every((k) => ["segun", "valores", "otro"].includes(k)) && esObjeto(regla) && regla.tipo === "enum"
    && Array.isArray(regla.valores) && esObjeto(limite.valores) && limiteOk(limite.otro)
    && Object.entries(limite.valores).every(([k, v]) => regla.valores.includes(k) && limiteOk(v));
  return ok ? [] : malo;
}

/** El límite de esta vez: segundos, o "trabajo" (sin tope mientras el script lata). */
function limiteDe(def, entrada) {
  const l = def.limite;
  if (!esObjeto(l)) return l;
  const v = entrada && Object.hasOwn(entrada, l.segun) ? entrada[l.segun] : undefined;
  return typeof v === "string" && Object.hasOwn(l.valores, v) ? l.valores[v] : l.otro;
}

function erroresRegla(donde, r, maximo = MAXIMO_ENTRADA) {
  if (!esObjeto(r) || !TIPOS.has(r.tipo)) return [`${donde}: tipo desconocido`];
  const e = [];
  if (r.tipo === "texto" && !(Number.isInteger(r.max) && r.max > 0 && r.max <= maximo)) e.push(`${donde}: un texto necesita «max»`);
  if (r.tipo === "enum" && !(Array.isArray(r.valores) && r.valores.length && r.valores.every((x) => typeof x === "string" && LITERAL.test(x)))) e.push(`${donde}: un enum necesita «valores» (textos simples)`);
  if (r.tipo === "entero" && ["min", "max"].some((k) => r[k] !== undefined && !Number.isSafeInteger(r[k]))) e.push(`${donde}: «min»/«max» son enteros`);
  if (r.tipo === "base64" && !(Number.isInteger(r.maxBytes) && r.maxBytes > 0 && r.maxBytes <= maximo)) e.push(`${donde}: base64 necesita «maxBytes»`);
  if (r.tipo === "rutaRelativa" && r.extensiones !== undefined && !(Array.isArray(r.extensiones) && r.extensiones.every((x) => typeof x === "string" && /^\.\w{1,10}$/.test(x)))) e.push(`${donde}: «extensiones» es una lista como [".md"]`);
  if (r.tipo === "lista") {
    if (r.max !== undefined && !(Number.isInteger(r.max) && r.max > 0 && r.max <= 10000)) e.push(`${donde}: «max» de una lista es un entero`);
    if (r.de !== undefined) e.push(...(r.de && r.de.tipo === "lista" ? [`${donde}: una lista de listas no`] : erroresRegla(donde + " (cada uno)", r.de, maximo)));
  }
  return e;
}

/** acciones.json de la app (dentro del paquete, junto a app.json). Las que no pasan se descartan y se avisan; un script que no
 *  está en bin/ también. Sin el archivo, no hay acciones declaradas (la app puede registrar las suyas). */
function cargarAcciones(recursos) {
  const errores = [];
  const d = leerJSON(path.join(recursos, "acciones.json"), null, 2 * 1024 * 1024);
  const acciones = Object.create(null);
  if (d === null) return { acciones, errores };
  if (!esObjeto(d) || d.formato !== 1 || !esObjeto(d.acciones)) return { acciones, errores: ["acciones.json: formato desconocido"] };
  for (const [nombre, a] of Object.entries(d.acciones)) {
    const e = erroresAccion(nombre, a);
    if (!e.length && !fs.existsSync(path.join(recursos, "bin", a.script))) e.push(`acción «${nombre}»: no está bin/${a.script}`);
    if (e.length) { errores.push(...e); continue; }
    acciones[nombre] = Object.freeze({ ...a, datos: a.datos || {}, args: a.args || [] });
  }
  return { acciones, errores };
}

// ───────────── Validar lo que manda la interfaz ─────────────
function validarValor(r, v) {
  switch (r.tipo) {
    case "texto":
      if (typeof v !== "string") return { ok: false };
      if (v.length > r.max) return r.recortar === true ? { ok: true, valor: v.slice(0, r.max) } : { ok: false };
      return { ok: true, valor: v };
    case "enum": return r.valores.includes(v) ? { ok: true, valor: v } : { ok: false };
    case "bool": return typeof v === "boolean" ? { ok: true, valor: v } : { ok: false };
    case "entero":
      if (!Number.isSafeInteger(v)) return { ok: false };
      if ((r.min !== undefined && v < r.min) || (r.max !== undefined && v > r.max)) return { ok: false };
      return { ok: true, valor: v };
    case "rutaRelativa":
      if (!esRelativa(v)) return { ok: false };
      if (r.extensiones && !r.extensiones.some((e) => v.toLowerCase().endsWith(e.toLowerCase()))) return { ok: false };
      return { ok: true, valor: v };
    case "base64": {
      if (typeof v !== "string" || v.length > Math.ceil(r.maxBytes / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(v) || v.length % 4 === 1) return { ok: false };
      return Buffer.from(v, "base64").length <= r.maxBytes ? { ok: true, valor: v } : { ok: false };
    }
    case "lista": {
      if (!Array.isArray(v) || v.length > (r.max || 100)) return { ok: false };
      const de = r.de || { tipo: "texto", max: 2000 };
      const out = [];
      for (const x of v) { const y = validarValor(de, x); if (!y.ok) return { ok: false }; out.push(y.valor); }
      return { ok: true, valor: out };
    }
    default: return { ok: false };
  }
}

/** Solo lo declarado, con su tipo. Un campo que va en args ($campo) es obligatorio; los demás, solo si dicen "requerido".
 *  "*": "pasar" deja pasar el resto (el script valida todo) como copia JSON. Lo de «inyectar» nunca viene de la interfaz. */
function validarDatos(def, datos) {
  if (!esObjeto(datos)) datos = {};
  const entrada = {};
  const enArgs = new Set(def.args.filter((x) => x.startsWith("$")).map((x) => x.slice(1)));
  for (const [campo, r] of Object.entries(def.datos)) {
    if (campo === "*") continue;
    const v = Object.hasOwn(datos, campo) ? datos[campo] : undefined;
    if (v === undefined || v === null) {
      if (enArgs.has(campo) || r.requerido === true) return { ok: false, campo, codigo: "falta" };
      continue;
    }
    const x = validarValor(r, v);
    if (!x.ok) return { ok: false, campo, codigo: "invalido" };
    entrada[campo] = x.valor;
  }
  if (def.datos["*"] === "pasar") {
    for (const [k, v] of Object.entries(datos)) {
      if (Object.hasOwn(def.datos, k) || Object.hasOwn(def.inyectar || {}, k) || !CAMPO.test(k) || PROHIBIDOS.has(k)) continue;
      entrada[k] = v;
    }
  }
  let texto;
  try { texto = JSON.stringify(entrada); } catch { return { ok: false, campo: "*", codigo: "invalido" }; }
  if (Buffer.byteLength(texto) > (Number.isInteger(def.maximo) ? def.maximo : MAXIMO_ENTRADA)) return { ok: false, campo: "*", codigo: "grande" };
  return { ok: true, entrada: JSON.parse(texto) };
}

/** Los campos de «eco» que se pueden devolver aunque los datos no pasen: solo los que son válidos por sí solos (así la interfaz
 *  sabe a qué orden responde el error, y nunca vuelve algo que no calza con su regla). */
function ecoValido(def, datos) {
  const r = {};
  if (!esObjeto(datos)) return r;
  for (const k of def.eco || []) {
    if (!Object.hasOwn(def.datos, k) || !Object.hasOwn(datos, k)) continue;
    const x = validarValor(def.datos[k], datos[k]);
    if (x.ok) r[k] = x.valor;
  }
  return r;
}

/** Los argumentos del script: literales, o el valor de un campo enum/entero ya validado. Nada más. */
function armarArgs(def, entrada) {
  return def.args.map((a) => (a.startsWith("$") ? String(entrada[a.slice(1)]) : a));
}

module.exports = {
  ID, ACCION, FUNCION, SCRIPT, MAXIMO_ENTRADA, TOPE_ENTRADA, esObjeto, limiteDe, ecoValido, erroresLimite, leerJSON, escribirAtomico, leerApp, carpetaDatos, prepararCarpeta, valida,
  limpiarConfig, crearConfig, crearIdioma, dentro, esRelativa, erroresAccion, cargarAcciones, validarDatos, validarValor, armarArgs,
};
