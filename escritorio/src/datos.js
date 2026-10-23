// Archivos del usuario en ~/minuta: perfil, universos, categorías, correcciones, votos, mensajes, ajustes e idioma.
// Es el equivalente de Perfil.swift, Juego.swift (Temas), Categorias.swift, Extras.swift y Catalogo.swift.
const fs = require("fs");
const path = require("path");
const { net, shell } = require("electron");
const { BASE, recursos, expandir } = require("./rutas");

const leerJSON = (ruta, defecto = null) => { try { return JSON.parse(fs.readFileSync(ruta, "utf8")); } catch { return defecto; } };
function escribirJSON(ruta, valor) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = ruta + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(valor, null, 2));
  fs.renameSync(tmp, ruta);
}

// ───────────── Perfil ─────────────
const Perfil = {
  archivo: path.join(BASE, "perfil.json"),
  porDefecto: {
    nombre: "", nombre_completo: "", descripcion: "", pais: "", gentilicio: "",
    idioma: "español", carpeta_notas: "~/Documents/Minuta/Reuniones",
    idioma_audio: "auto", idioma_ui: "es",
    ia: "claude", modelo_whisper: "", respaldo: "", respaldo_remoto: "",
  },
  datos() {
    const d = { ...this.porDefecto };
    const o = leerJSON(this.archivo, {});
    for (const [k, v] of Object.entries(o || {})) if (typeof v === "string") d[k] = v;
    return d;
  },
  guardar(p) {
    const limpio = {};
    for (const k of Object.keys(this.porDefecto).sort()) if (typeof p[k] === "string") limpio[k] = p[k];
    escribirJSON(this.archivo, limpio);
  },
  /** Mezcla cambios (solo claves conocidas y de texto). */
  mezclar(cambios = {}) {
    const p = this.datos();
    for (const [k, v] of Object.entries(cambios)) if (k in this.porDefecto && typeof v === "string") p[k] = v;
    this.guardar(p);
  },
  get falta() { return !fs.existsSync(this.archivo); },
  carpetaNotas() {
    const ruta = (this.datos().carpeta_notas || "").trim() || this.porDefecto.carpeta_notas;
    const abs = expandir(ruta);
    fs.mkdirSync(abs, { recursive: true });
    return abs;
  },
};

// ───────────── Universos ─────────────
const Temas = {
  carpeta: path.join(BASE, "temas"),
  config: path.join(BASE, "config.json"),
  incluidos: () => path.join(recursos(), "universos"),
  /** Archivos de universo: los incluidos y los tuyos (si tienes uno con el mismo id, gana el tuyo). */
  archivos() {
    const porId = {};
    for (const dir of [this.incluidos(), this.carpeta]) {
      let lista = [];
      try { lista = fs.readdirSync(dir); } catch {}
      for (const f of lista) if (f.endsWith(".json") && !f.startsWith("_")) porId[f.slice(0, -5)] = path.join(dir, f);
    }
    return Object.keys(porId).sort().map((k) => porId[k]);
  },
  paraJS() {
    const estilos = leerJSON(path.join(this.carpeta, "_estilos.json"), {}) || {};
    let ids = new Set();
    try { ids = new Set(fs.readdirSync(this.incluidos()).map((f) => f.replace(/\.json$/, ""))); } catch {}
    const inc = path.resolve(this.incluidos());
    return this.archivos().map((ruta) => {
      const o = leerJSON(ruta);
      if (!o || typeof o.id !== "string") return null;
      if (!o.estilo && estilos[o.id]) o.estilo = estilos[o.id];
      o.incluido = ids.has(o.id) && path.resolve(path.dirname(ruta)) === inc;
      return o;
    }).filter(Boolean);
  },
  valido(t) {
    return t && Array.isArray(t.rangos) && t.rangos.length === 10 && t.apartados
      && ["claridad", "escucha", "preguntas", "cierre"].every((k) => Array.isArray(t.apartados[k]) && t.apartados[k].length === 10);
  },
  idGuardado() { return leerJSON(this.config, {})?.tema || "cine"; },
  guardarId(id) { const c = leerJSON(this.config, {}) || {}; c.tema = id; escribirJSON(this.config, c); },
  existe(id) { return this.archivos().some((r) => path.basename(r) === `${id}.json`); },
  estilo(id) {
    const r = this.archivos().find((x) => path.basename(x) === `${id}.json`) || this.archivos().find((x) => path.basename(x) === "cine.json");
    const t = r && leerJSON(r);
    return t?.estilo || (leerJSON(path.join(this.carpeta, "_estilos.json"), {}) || {})[t?.id] || null;
  },
};

// ───────────── Categorías ─────────────
const Categorias = {
  archivo: path.join(BASE, "categorias.json"),
  porDefecto: [
    { id: "Personal", nombre: "Personal", emoji: "🏡", color: "#a855f7", descripcion: "conversaciones personales",
      enfoque: "Es una reunión o conversación personal. Da feedback de comunicación general, breve y amable.", dominios: [], palabras: [], apps: [] },
    { id: "Otra", nombre: "Otra", emoji: "💬", color: "#94a3b8", descripcion: "feedback general",
      enfoque: "Evalúa la comunicación en general: claridad, escucha, preguntas y cierre.", dominios: [], palabras: [], apps: [] },
  ],
  cargar() {
    const l = leerJSON(this.archivo);
    if (Array.isArray(l) && l.length) return l;
    this.guardar(this.porDefecto);
    return this.porDefecto;
  },
  guardar(lista) { escribirJSON(this.archivo, lista); },
  desdeJS(v) {
    if (!Array.isArray(v) || !v.length) return null;
    const campos = ["id", "nombre", "emoji", "color", "descripcion", "enfoque"];
    const ok = v.every((c) => c && campos.every((k) => typeof c[k] === "string") && ["dominios", "palabras", "apps"].every((k) => Array.isArray(c[k])));
    return ok ? v.map((c) => ({ ...Object.fromEntries(campos.map((k) => [k, c[k]])), dominios: c.dominios.map(String), palabras: c.palabras.map(String), apps: c.apps.map(String) })) : null;
  },
  /** Dominio de correo (3 pts) > palabra en el título (2) > app (1). */
  elegir(lista, titulo, correos, app) {
    const t = (titulo || "").toLowerCase();
    const dominios = (correos || []).map((c) => (c.split("@").pop() || "").toLowerCase());
    let mejor = null;
    for (const c of lista) {
      let p = 0;
      if (c.dominios.some((d) => d && dominios.some((x) => x === d.toLowerCase() || x.endsWith("." + d.toLowerCase())))) p += 3;
      if (c.palabras.some((w) => w && t.includes(w.toLowerCase()))) p += 2;
      if (app && c.apps.some((a) => a && app.toLowerCase().includes(a.toLowerCase()))) p += 1;
      if (p > 0 && p > (mejor?.p || 0)) mejor = { id: c.id, p };
    }
    return mejor?.id || null;
  },
};

// ───────────── Correcciones, votos, notas y mensajes ─────────────
const Extras = {
  correccionesURL: path.join(BASE, "correcciones.json"),
  votosURL: path.join(BASE, "votos.json"),
  vocabularioURL: path.join(BASE, "vocabulario.txt"),
  mensajes: path.join(BASE, "mensajes"),
  correcciones() { const l = leerJSON(this.correccionesURL, []); return Array.isArray(l) ? l : []; },
  agregarCorreccion(d) {
    const de = String(d.de || "").trim(), a = String(d.a || "").trim();
    if (!de || !a) return;
    const lista = this.correcciones().filter((c) => c.de !== de);
    lista.push({ de, a, palabra: d.palabra ?? true, mayus: d.mayus ?? true });
    escribirJSON(this.correccionesURL, lista);
    let vocab = "Reunión de trabajo.";
    try { vocab = fs.readFileSync(this.vocabularioURL, "utf8").trim() || vocab; } catch {}
    if (!vocab.toLowerCase().includes(a.toLowerCase())) {
      vocab = vocab.endsWith(".") ? `${vocab.slice(0, -1)}, ${a}.` : `${vocab} ${a}.`;
      fs.writeFileSync(this.vocabularioURL, vocab);
    }
  },
  quitarCorreccion(de) { escribirJSON(this.correccionesURL, this.correcciones().filter((c) => c.de !== de)); },
  votos() { return leerJSON(this.votosURL, {}) || {}; },
  votar(d) {
    if (typeof d.clave !== "string") return;
    const todos = this.votos();
    const v = Math.round(Number(d.v) || 0);
    if (v === 0) delete todos[d.clave];
    else { const { accion, clave, ...resto } = d; todos[d.clave] = { ...resto, v, fecha: new Date().toISOString() }; }
    escribirJSON(this.votosURL, todos);
  },
  /** Solo notas .md dentro de la carpeta de reuniones. */
  esNota(ruta) {
    const r = path.resolve(ruta);
    return r.endsWith(".md") && path.dirname(r) === path.resolve(Perfil.carpetaNotas()) && fs.existsSync(r);
  },
  reescribir(ruta, texto) {
    if (!this.esNota(ruta) || !texto) return false;
    try { fs.writeFileSync(ruta, texto); return true; } catch { return false; }
  },
  mensajeURL(ruta) { return path.join(this.mensajes, path.basename(ruta).replace(/\.md$/, "") + ".json"); },
  mensajeGuardado(ruta) { const d = leerJSON(this.mensajeURL(ruta)); return d && typeof d.texto === "string" && d.texto ? d : null; },
  guardarMensaje(ruta, asunto, texto) {
    if (!String(texto || "").trim()) return;
    const d = this.mensajeGuardado(ruta) || {};
    Object.assign(d, { asunto, texto, editado: true, fecha: new Date().toISOString() });
    escribirJSON(this.mensajeURL(ruta), d);
  },
  async borrarUniverso(id) {
    if (!/^[a-z0-9]+$/.test(id)) return false;
    const r = path.join(Temas.carpeta, `${id}.json`);
    if (!fs.existsSync(r)) return false;
    try { await shell.trashItem(r); return true; } catch { return false; }
  },
  async borrarNota(ruta) {
    if (!this.esNota(ruta)) return false;
    try { await shell.trashItem(ruta); } catch { return false; }
    try { fs.rmSync(this.mensajeURL(ruta), { force: true }); } catch {}
    return true;
  },
  /** Notas para la interfaz: [{ruta, texto}]. */
  notas() {
    const dir = Perfil.carpetaNotas();
    let lista = [];
    try { lista = fs.readdirSync(dir).filter((f) => f.endsWith(".md")); } catch {}
    return lista.map((f) => { const ruta = path.join(dir, f); try { return { ruta, texto: fs.readFileSync(ruta, "utf8") }; } catch { return null; } }).filter(Boolean);
  },
};

// ───────────── Avisos (~/minuta/ajustes.json) ─────────────
const Ajustes = {
  archivo: path.join(BASE, "ajustes.json"),
  porDefecto: { avisarDeteccion: true, avisarCalendario: true, avisarFin: true, avisarNotas: true, alTocar: "grabar",
    avisarPrep: true, avisarCompromisos: true, coachVivo: true, avisoMonologo: true },
  cargar() { return { ...this.porDefecto, ...(leerJSON(this.archivo, {}) || {}) }; },
  desdeJS(d = {}) {
    const a = {};
    for (const [k, v] of Object.entries(this.porDefecto)) a[k] = k === "alTocar" ? (d.alTocar === "panel" ? "panel" : "grabar") : (typeof d[k] === "boolean" ? d[k] : v);
    return a;
  },
  guardar(a) { escribirJSON(this.archivo, a); },
};

// ───────────── Idioma de la interfaz ─────────────
const Idioma = {
  dirDescargados: path.join(BASE, "idiomas"),
  codigo() { const c = (Perfil.datos().idioma_ui || "es").trim(); return c || "es"; },
  paquete(c) {
    for (const dir of [this.dirDescargados, path.join(recursos(), "ui", "idiomas")]) {
      const o = leerJSON(path.join(dir, `${c}.json`));
      if (o) return o;
    }
    return null;
  },
  instalados() {
    const lista = [{ codigo: "es", nombre: "Español", bandera: "🇪🇸", incluido: true }];
    const vistos = new Set(["es"]);
    for (const [dir, incluido] of [[path.join(recursos(), "ui", "idiomas"), true], [this.dirDescargados, false]]) {
      let fs_ = [];
      try { fs_ = fs.readdirSync(dir).filter((f) => f.endsWith(".json")); } catch {}
      for (const f of fs_) {
        const o = leerJSON(path.join(dir, f));
        if (!o || typeof o.codigo !== "string" || vistos.has(o.codigo)) continue;
        vistos.add(o.codigo);
        lista.push({ codigo: o.codigo, nombre: o.nombre || o.codigo, bandera: o.bandera || "", incluido });
      }
    }
    return lista;
  },
  _cache: null,
  olvidar() { this._cache = null; },
  t(es) {
    const c = this.codigo();
    if (c === "es") return es;
    if (this._cache?.[0] !== c) this._cache = [c, this.paquete(c)?.textos || {}];
    return this._cache[1][es] || es;
  },
  f(plantilla, ...valores) {
    let r = this.t(plantilla);
    for (const v of valores) { const i = r.search(/\{x\}|\{n\}/); if (i < 0) break; r = r.slice(0, i) + v + r.slice(i + 3); }
    return r;
  },
  paraJS() {
    const c = this.codigo(), p = c === "es" ? null : this.paquete(c);
    return { codigo: c, textos: p?.textos || {}, palabras: p?.palabras || null, instalados: this.instalados() };
  },
};

// ───────────── Catálogo público (universos e idiomas) ─────────────
const Catalogo = {
  repo: "soydavidcornejo/minuta-catalogo",
  get raiz() { return `https://raw.githubusercontent.com/${this.repo}/main/`; },
  get urlComentarios() { return `https://github.com/${this.repo}/issues/new`; },
  cache: path.join(BASE, "catalogo"),
  async bajar(ruta) {
    const r = await net.fetch(this.raiz + ruta, { headers: { "User-Agent": "Minuta" }, cache: "no-store" });
    if (!r.ok) throw new Error(`Respuesta ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  },
  async indice(tipo) {
    const copia = path.join(this.cache, `${tipo}.json`);
    try {
      const datos = await this.bajar(`${tipo}/index.json`);
      const lista = JSON.parse(datos.toString("utf8"));
      fs.mkdirSync(this.cache, { recursive: true });
      fs.writeFileSync(copia, datos);
      return { lista };
    } catch (e) {
      return { lista: leerJSON(copia, []) || [], error: String(e.message || e) };
    }
  },
  async descargarUniverso(id) {
    if (!/^[a-z0-9]{2,40}$/.test(id)) return "id inválido";
    let o;
    try { o = JSON.parse((await this.bajar(`universos/${id}.json`)).toString("utf8")); } catch (e) { return String(e.message || e); }
    if (o?.id !== id || !Temas.valido(o)) return "El universo no tiene el formato esperado.";
    o.descargado = true;
    try { escribirJSON(path.join(Temas.carpeta, `${id}.json`), o); } catch { return "No pude guardarlo."; }
    return null;
  },
  async descargarIdioma(codigo) {
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(codigo)) return "código inválido";
    let datos, o;
    try { datos = await this.bajar(`idiomas/${codigo}.json`); o = JSON.parse(datos.toString("utf8")); } catch (e) { return String(e.message || e); }
    if (o?.codigo !== codigo || !o.textos || typeof o.textos !== "object" || !Object.keys(o.textos).length) return "El idioma no tiene el formato esperado.";
    try { fs.mkdirSync(Idioma.dirDescargados, { recursive: true }); fs.writeFileSync(path.join(Idioma.dirDescargados, `${codigo}.json`), datos); } catch { return "No pude guardarlo."; }
    return null;
  },
};

module.exports = { leerJSON, escribirJSON, Perfil, Temas, Categorias, Extras, Ajustes, Idioma, Catalogo };
