// Primera vez, respaldo de notas y actualizaciones. Equivalente de Bienvenida.swift.
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { app, dialog, net, safeStorage } = require("electron");
const { BASE, ES_WIN, PLATAFORMA, HOME, expandir, corta } = require("./rutas");
const { Perfil, Idioma, leerJSON, escribirJSON } = require("./datos");

// ───────────── Modelos de transcripción (descarga verificada por SHA-256) ─────────────
const HF = "https://huggingface.co/";
const Modelos = {
  carpeta: path.join(BASE, "models"),
  transcripcion: [
    { id: "turbo", nombre: "Preciso", archivo: "ggml-large-v3-turbo-q5_0.bin", bytes: 574041195,
      sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2", detalle: "El más preciso. Sin tarjeta gráfica es más lento: recomendado con 8 núcleos y 16 GB o más." },
    { id: "small", nombre: "Liviano", archivo: "ggml-small-q5_1.bin", bytes: 190085487,
      sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb", detalle: "Más rápido y pequeño; el recomendado para la mayoría de los computadores." },
  ],
  vad: { id: "vad", nombre: "Detector de voz", archivo: "ggml-silero-v5.1.2.bin", bytes: 885098,
    sha256: "29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf" },
  url(m) { return HF + (m.id === "vad" ? "ggml-org/whisper-vad" : "ggerganov/whisper.cpp") + "/resolve/main/" + m.archivo; },
  existe(m) { try { return fs.statSync(path.join(this.carpeta, m.archivo)).size === m.bytes; } catch { return false; } },
  // En Windows y Linux whisper corre en el procesador (sin Metal): el modelo grande solo conviene en equipos potentes.
  get recomendado() { return os.cpus().length >= 8 && os.totalmem() >= 16 * 2 ** 30 ? "turbo" : "small"; },
  paraJS() {
    return { recomendado: this.recomendado, ram: Math.round(os.totalmem() / 2 ** 30), elegido: Perfil.datos().modelo_whisper || "",
      lista: this.transcripcion.map((m) => ({ id: m.id, nombre: m.nombre, mb: Math.round(m.bytes / 1e6), detalle: m.detalle, listo: this.existe(m) })),
      vadListo: this.existe(this.vad) };
  },
  async descargar(id, progreso) {
    const m = this.transcripcion.find((x) => x.id === id);
    if (!m) throw new Error("modelo desconocido");
    const pendientes = [m, this.vad].filter((x) => !this.existe(x));
    const total = pendientes.reduce((a, x) => a + x.bytes, 0);
    let hechos = 0;
    fs.mkdirSync(this.carpeta, { recursive: true });
    for (const mod of pendientes) {
      await descargarVerificado(this.url(mod), mod.sha256, path.join(this.carpeta, mod.archivo), (b) => progreso((hechos + b) / total));
      hechos += mod.bytes;
    }
  },
};

/** Descarga a un temporal calculando la huella mientras llega; solo lo deja en su lugar si coincide. */
async function descargarVerificado(url, sha256, destino, progreso = () => {}) {
  const r = await net.fetch(url);
  if (!r.ok || !r.body) throw new Error(`Respuesta ${r.status}`);
  const tmp = destino + ".descarga";
  const salida = fs.createWriteStream(tmp);
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  const lector = r.body.getReader();
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      hash.update(value);
      bytes += value.length;
      if (!salida.write(value)) await new Promise((ok) => salida.once("drain", ok));
      progreso(bytes);
    }
  } finally {
    await new Promise((ok) => salida.end(ok));
  }
  if (hash.digest("hex") !== sha256) { fs.rmSync(tmp, { force: true }); throw new Error("La descarga llegó dañada. Intenta de nuevo."); }
  fs.rmSync(destino, { force: true });
  fs.renameSync(tmp, destino);
}

// ───────────── IA del usuario (su propia cuenta) ─────────────
const IA = {
  conocidas: [
    { id: "claude", nombre: "Claude", comando: "claude", soportada: true, guia: "https://minuta-app.github.io/minuta/ia.html#claude" },
    { id: "codex", nombre: "ChatGPT (Codex)", comando: "codex", soportada: true, guia: "https://minuta-app.github.io/minuta/ia.html#codex" },
    { id: "gemini", nombre: "Gemini", comando: ["agy", "gemini"], soportada: true, guia: "https://minuta-app.github.io/minuta/ia.html#gemini" },
  ],
  /** Carpetas donde suelen quedar estas herramientas (la app no siempre hereda el PATH de la terminal). */
  dirs() {
    const d = [path.join(HOME, ".local", "bin"), path.join(HOME, ".claude", "local"), path.join(HOME, ".codex", "bin"), path.join(HOME, ".npm-global", "bin"),
      path.join(HOME, ".volta", "bin"), path.join(HOME, ".bun", "bin"), "/usr/local/bin", "/usr/bin", "/opt/homebrew/bin"];
    if (ES_WIN) d.push(path.join(process.env.APPDATA || "", "npm"), path.join(process.env.LOCALAPPDATA || "", "Programs", "claude"));
    return [...(process.env.PATH || "").split(path.delimiter), ...d].filter(Boolean);
  },
  buscar(comandos) {
    const ext = ES_WIN ? [".exe", ".cmd", ".bat", ""] : [""];
    for (const comando of [].concat(comandos)) for (const d of this.dirs()) for (const e of ext) {
      const r = path.join(d, comando + e);
      try { if (fs.statSync(r).isFile()) return r; } catch {}
    }
    return null;
  },
  paraJS() { return this.conocidas.map((x) => ({ id: x.id, nombre: x.nombre, ruta: this.buscar(x.comando), soportada: x.soportada, guia: x.guia })); },
  /** PATH completo para los procesos hijos (Python, la IA, git). */
  path() { return [...new Set(this.dirs())].join(path.delimiter); },
  // La prueba real (pedirle una palabra) la hace la pieza «ia»: acción probarIA de main.js → bin/ia.py probar.
};

/** spawn que también sirve para los .cmd de npm en Windows (necesitan pasar por la consola). */
function lanzar(ruta, args, opciones = {}) {
  if (ES_WIN && /\.(cmd|bat)$/i.test(ruta)) {
    const citar = (a) => `"${String(a).replace(/"/g, '""')}"`;
    return spawn(`${citar(ruta)} ${args.map(citar).join(" ")}`, { ...opciones, shell: true, windowsHide: true });
  }
  return spawn(ruta, args, { ...opciones, windowsHide: true });
}

// ───────────── Notas: carpeta, importar desde git y respaldo en la cuenta del usuario ─────────────
const Respaldo = {
  // Los tokens van cifrados por el sistema (host.secretos de la pieza «host-escritorio»: safeStorage, DPAPI en Windows,
  // libsecret/kwallet en Linux) en el mismo archivo de siempre, ~/minuta/.tokens ({cuenta: base64}), con las mismas cuentas
  // («github», «gitlab»): quien ya conectó su cuenta no la pierde. main.js lo conecta con usarSecretos al arrancar.
  archivo: path.join(BASE, ".tokens"),
  _secretos: null,
  usarSecretos(s) { this._secretos = s; },
  _todos() { return leerJSON(this.archivo, {}) || {}; },
  guardarToken(token, cuenta) {
    if (this._secretos && this._secretos.guardar(cuenta, token)) return;
    // Linux sin llavero (safeStorage «basic_text»): el host no guarda nada ahí. Se sigue como hasta ahora, para que el respaldo
    // de quien ya lo usaba no se corte (pendiente para Pieza: decidir qué hacer en ese caso).
    if (!safeStorage.isEncryptionAvailable()) return;
    const t = this._todos();
    t[cuenta] = safeStorage.encryptString(token).toString("base64");
    escribirJSON(this.archivo, t);
    try { fs.chmodSync(this.archivo, 0o600); } catch {}
  },
  token(cuenta) {
    const s = this._secretos && this._secretos.leer(cuenta);
    if (s) return s;
    // Lo guardado antes en Linux sin llavero: se sigue leyendo igual que siempre.
    const c = this._todos()[cuenta];
    if (!c || !safeStorage.isEncryptionAvailable()) return null;
    try { return safeStorage.decryptString(Buffer.from(c, "base64")); } catch { return null; }
  },
  contarNotas(dir) { try { return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).length; } catch { return 0; } },
  async elegirCarpeta(ventana) {
    const r = await dialog.showOpenDialog(ventana, {
      title: Idioma.t("Elige la carpeta donde están (o donde quieres guardar) tus notas"),
      buttonLabel: Idioma.t("Usar esta carpeta"), properties: ["openDirectory", "createDirectory"],
    });
    return r.canceled ? null : r.filePaths[0];
  },
  gitRuta() {
    if (ES_WIN) {
      for (const r of [path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "cmd", "git.exe"), path.join(process.env.LOCALAPPDATA || "", "Programs", "Git", "cmd", "git.exe")])
        if (fs.existsSync(r)) return r;
    }
    return "git";
  },
  encabezado(proveedor, token) {
    const usuario = proveedor === "gitlab" ? "oauth2" : "x-access-token";
    return "Authorization: Basic " + Buffer.from(`${usuario}:${token}`).toString("base64");
  },
  /** git con el token solo en memoria (encabezado para ese comando), nunca escrito en disco. */
  git(args, carpeta, proveedor) {
    return new Promise((fin) => {
      const t = proveedor && this.token(proveedor);
      const a = t ? ["-c", `http.extraHeader=${this.encabezado(proveedor, t)}`, ...args] : args;
      let texto = "";
      let p;
      try { p = spawn(this.gitRuta(), a, { cwd: carpeta, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }); }
      catch (e) { return fin({ ok: false, texto: e.message }); }
      p.stdout.on("data", (d) => (texto += d));
      p.stderr.on("data", (d) => (texto += d));
      p.on("error", (e) => fin({ ok: false, texto: e.code === "ENOENT" ? Idioma.t("Falta Git: instálalo desde git-scm.com y vuelve a intentar.") : e.message }));
      p.on("close", (c) => fin({ ok: c === 0, texto }));
    });
  },
  async clonar(url, proveedor, destino) {
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    return this.git(["clone", url, destino], path.dirname(destino), proveedor);
  },
  /** Crea un repositorio PRIVADO en la cuenta del usuario y deja la carpeta de notas conectada a él. */
  async crearRepo(proveedor, token, nombre, carpeta) {
    let r;
    try {
      r = proveedor === "gitlab"
        ? await net.fetch("https://gitlab.com/api/v4/projects", { method: "POST", headers: { "PRIVATE-TOKEN": token, "Content-Type": "application/json" },
          body: JSON.stringify({ name: nombre, visibility: "private" }) })
        : await net.fetch("https://api.github.com/user/repos", { method: "POST",
          headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
          body: JSON.stringify({ name: nombre, private: true, description: "Mis notas de reuniones (Minuta)" }) });
    } catch (e) { return { ok: false, texto: e.message }; }
    const o = await r.json().catch(() => ({}));
    const url = o.clone_url || o.http_url_to_repo;
    if (!r.ok || !url) return { ok: false, texto: typeof o.message === "string" ? o.message : JSON.stringify(o.message || `Respuesta ${r.status}`) };
    this.guardarToken(token, proveedor);
    const c = await this.conectar(carpeta, url, proveedor);
    return { ok: c.ok, texto: c.ok ? url : c.texto };
  },
  async conectar(carpeta, remoto, proveedor) {
    fs.mkdirSync(carpeta, { recursive: true });
    const ignorar = path.join(carpeta, ".gitignore");
    if (!fs.existsSync(ignorar)) fs.writeFileSync(ignorar, ".DS_Store\nThumbs.db\n.obsidian/workspace*\n");
    const pasos = [["init", "-b", "main"], ["remote", "remove", "origin"], ["remote", "add", "origin", remoto], ["add", "-A"],
      ["-c", "user.name=Minuta", "-c", "user.email=minuta@localhost", "commit", "-m", "Notas de reuniones", "--allow-empty"], ["push", "-u", "origin", "main"]];
    for (let i = 0; i < pasos.length; i++) {
      const r = await this.git(pasos[i], carpeta, i === pasos.length - 1 ? proveedor : null);
      if (!r.ok && (pasos[i][0] === "push" || pasos[i][0] === "init")) return r;
    }
    Perfil.mezclar({ respaldo: proveedor, respaldo_remoto: remoto });
    return { ok: true, texto: "" };
  },
  /** Después de cada reunión: guarda y sube los cambios de la carpeta de notas (si el usuario activó el respaldo). */
  async sincronizar() {
    const proveedor = Perfil.datos().respaldo;
    if (!proveedor) return;
    const c = Perfil.carpetaNotas();
    await this.git(["add", "-A"], c);
    await this.git(["-c", "user.name=Minuta", "-c", "user.email=minuta@localhost", "commit", "-m", `Reunión ${new Date().toISOString()}`], c);
    await this.git(["pull", "--rebase", "--autostash"], c, proveedor);
    const r = await this.git(["push"], c, proveedor);
    if (!r.ok) console.error("Minuta: no pude respaldar las notas:", r.texto);
  },
};

// ───────────── Actualizaciones de una instalación de desarrollo ─────────────
// Las de siempre (Releases con su .sha256: Windows, AppImage o el tar.gz de instalar.sh) son de la pieza «actualizaciones»
// (actualizaciones.js). Aquí queda lo propio de Minuta: si ~/minuta es un checkout de git, se actualiza con git.
const Actualizaciones = {
  get esDesarrollo() { return fs.existsSync(path.join(BASE, ".git")); },
  /** {hay, detalle, error}: los commits nuevos de origin/main. */
  async revisar() {
    const f = await Respaldo.git(["fetch", "--quiet", "origin", "main"], BASE);
    if (!f.ok) return { hay: false, detalle: "", error: true };
    const n = parseInt((await Respaldo.git(["rev-list", "--count", "HEAD..origin/main"], BASE)).texto.trim(), 10) || 0;
    if (!n) return { hay: false, detalle: "" };
    const log = (await Respaldo.git(["log", "--format=%s", "-n", "3", "HEAD..origin/main"], BASE)).texto;
    return { hay: true, detalle: log.split("\n").filter(Boolean).map((l) => "• " + l).join("\n"), desarrollo: true };
  },
  /** git pull y volver a abrir. avance({paso, codigo, texto, valores, total}): la misma forma que la pieza. */
  async instalar(avance = () => {}) {
    const paso = (n, codigo, texto) => avance({ paso: String(n), codigo, texto, valores: { app: "Minuta" }, total: 3 });
    paso(1, "bajando", "Descargando la versión nueva…");
    const r = await Respaldo.git(["pull", "--ff-only"], BASE);
    if (!r.ok) throw new Error("No pude descargar la versión nueva. Revisa tu conexión e intenta de nuevo.");
    paso(3, "instalando", "Instalando: {app} se cerrará y volverá a abrirse sola");
    setTimeout(() => { app.relaunch(); app.exit(0); }, 1500);
  },
};

module.exports = { Modelos, IA, Respaldo, Actualizaciones, lanzar, descargarVerificado, corta, expandir };
