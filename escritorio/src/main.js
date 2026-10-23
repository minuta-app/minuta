// Minuta para Windows y Linux. Misma interfaz (ui/) y mismo procesamiento (bin/) que la app de Mac;
// aquí está lo que en Mac hacen MinutaApp.swift, BarraMenu.swift, VisorWeb.swift y Alerta.swift.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { app, BrowserWindow, Tray, Menu, Notification, clipboard, desktopCapturer, ipcMain, nativeImage, net, protocol, screen, session, shell, systemPreferences } = require("electron");
const { ES_WIN, PLATAFORMA, BASE, recursos, herramientas, python, corta, expandir, asegurarCarpetas } = require("./rutas");
const { Perfil, Temas, Categorias, Extras, Ajustes, Idioma, Catalogo, leerJSON } = require("./datos");
const { Modelos, IA, Respaldo, Actualizaciones } = require("./bienvenida");
const { DetectorReuniones } = require("./deteccion");
const { CoachVivo } = require("./vivo");
const { EscritorWav } = require("./wav");
const Calendario = require("./calendario");

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
if (ES_WIN) app.setAppUserModelId("app.minuta.escritorio");
app.setName("Minuta");
// La grabadora es una ventana oculta: sin esto Chromium deja el AudioContext suspendido hasta un clic.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// La interfaz se sirve desde minuta://ui/… (así fetch() de archivos relativos funciona igual que en Mac).
protocol.registerSchemesAsPrivileged([{ scheme: "minuta", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const ICONOS = path.join(__dirname, "..", "iconos");
const icono = (n) => nativeImage.createFromPath(path.join(ICONOS, n));

// ───────────────────────── Estado (equivale a AppModel) ─────────────────────────
const M = {
  fase: "inactiva", desde: 0, titulo: "", tipo: "Otra", tipoManual: false, tipoAuto: false, plataforma: "", estado: "", detectada: null,
  actualizacion: { hay: false }, enCola: [], procesandoAhora: null, ultimaNota: null, notaSeleccionada: null,
  temaID: "cine", categorias: [], ajustes: {}, carpeta: null, evento: null,
};
const coach = new CoachVivo();
const detector = new DetectorReuniones();
const avisados = new Set();
let ventana = null, panel = null, alertaVentana = null, grabadora = null, bandeja = null;
let escritores = {}, parec = null, finPendiente = null, alertaActual = null;
let dictado = null;

function json(v) { return JSON.stringify(v); }
/** Muestras de 16 bits de un bloque (copia si viene desalineado en memoria, como a veces llegan los de parec). */
function muestras(buf) {
  const n = Math.floor(buf.length / 2);
  if (buf.byteOffset % 2 === 0) return new Int16Array(buf.buffer, buf.byteOffset, n);
  const copia = new Uint8Array(n * 2); copia.set(buf.subarray(0, n * 2));
  return new Int16Array(copia.buffer);
}
/** Ventanas cuya interfaz ya terminó de cargar (isLoading() aún dice true durante did-finish-load). */
const listo = new Set();
const cargada = (w) => w && !w.isDestroyed() && listo.has(w.webContents.id);
// ───────────── Comentarios y votos con la cuenta de GitHub del respaldo (sin servidor propio) ─────────────
const Comentarios = {
  repos: { app: "minuta-app/minuta", catalogo: Catalogo.repo },
  _usuario: null,
  async _api(ruta, metodo = "GET", cuerpo) {
    const token = Respaldo.token("github");
    if (!token) return { codigo: 0, json: {} };
    try {
      const r = await net.fetch(`https://api.github.com/${ruta}`, { method: metodo, body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "Minuta", "Content-Type": "application/json" } });
      return { codigo: r.status, json: await r.json().catch(() => ({})) };
    } catch (e) { return { codigo: 0, json: { message: e.message } }; }
  },
  async cuenta() {
    if (this._usuario) return this._usuario;
    const r = await this._api("user");
    this._usuario = r.codigo === 200 ? r.json.login || null : null;
    return this._usuario;
  },
  async publicar(repo, titulo, cuerpo, etiqueta) {
    const r = this.repos[repo]; if (!r) return { ok: false, error: "Repositorio desconocido" };
    const x = await this._api(`repos/${r}/issues`, "POST", { title: titulo, body: cuerpo, labels: [etiqueta] });
    return x.codigo === 201 ? { ok: true, url: x.json.html_url } : { ok: false, error: x.json.message || `GitHub respondió ${x.codigo}` };
  },
  async votar(numero, positivo) {
    if (!numero) return { ok: false, nuevo: false };
    const x = await this._api(`repos/${Catalogo.repo}/issues/${numero}/reactions`, "POST", { content: positivo ? "+1" : "-1" });
    return { ok: x.codigo === 200 || x.codigo === 201, nuevo: x.codigo === 201 };
  },
};

function llamarFuncion(web, f, datos) {
  if (!web || web.isDestroyed()) return Promise.resolve(null);
  return web.webContents.executeJavaScript(`window.Minuta && window.Minuta.${f} ? window.Minuta.${f}(${json(datos)}) : null`).catch(() => null);
}
const llamar = (web, datos) => llamarFuncion(web, "cargar", datos);
const temaEstilo = () => Temas.estilo(M.temaID);
const t = (s) => Idioma.t(s);
const f = (s, ...v) => Idioma.f(s, ...v);

// ───────────────────────── Ventanas ─────────────────────────
const webPrefs = (extra = []) => ({ preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: false, additionalArguments: extra, spellcheck: false });

function abrirVisor(ruta) {
  if (ruta) M.notaSeleccionada = ruta;
  if (!ventana || ventana.isDestroyed()) {
    const guardado = leerJSON(path.join(BASE, ".ventana.json"), {}) || {};
    ventana = new BrowserWindow({
      width: guardado.width || 1120, height: guardado.height || 760, x: guardado.x, y: guardado.y, minWidth: 980, minHeight: 640,
      frame: false, show: false, backgroundColor: "#111111", title: "Minuta", icon: icono("minuta-256.png"), webPreferences: webPrefs(),
    });
    ventana.loadURL("minuta://ui/index.html");
    ventana.webContents.on("did-finish-load", () => { listo.add(ventana.webContents.id); enviarTodo(); });
    ventana.once("ready-to-show", () => ventana.show());
    ventana.on("focus", () => { llamarFuncion(ventana, "ventana", { activa: true }); enviarTodo(); });
    ventana.on("blur", () => llamarFuncion(ventana, "ventana", { activa: false }));
    ventana.on("enter-full-screen", () => llamarFuncion(ventana, "ventana", { pantalla: true }));
    ventana.on("leave-full-screen", () => llamarFuncion(ventana, "ventana", { pantalla: false }));
    ventana.on("close", () => { try { fs.writeFileSync(path.join(BASE, ".ventana.json"), json(ventana.getNormalBounds())); } catch {} });
    ventana.on("closed", () => { ventana = null; });
    abrirEnlacesFuera(ventana);
  } else {
    if (ventana.isMinimized()) ventana.restore();
    ventana.show(); ventana.focus();
    if (ruta) llamar(ventana, { seleccion: ruta });
  }
  return ventana;
}

function abrirEnlacesFuera(w) {
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: "deny" }; });
  w.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("minuta://")) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); } });
}

/** Ejecuta JS en el visor cuando esté cargado (lo abre si hace falta). */
function enVisor(js, intentos = 25) {
  const w = abrirVisor();
  const probar = (n) => {
    if (w.isDestroyed()) return;
    if (!cargada(w)) { if (n > 0) setTimeout(() => probar(n - 1), 300); return; }
    setTimeout(() => w.webContents.executeJavaScript(js).catch(() => {}), 350);
  };
  probar(intentos);
}

const PANEL_ANCHO = 386;
let panelAlto = 560;
function crearPanel() {
  panel = new BrowserWindow({
    width: PANEL_ANCHO, height: panelAlto, show: false, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, transparent: false,
    backgroundColor: "#111111", fullscreenable: false, minimizable: false, maximizable: false, webPreferences: webPrefs(["--minuta-panel"]),
  });
  panel.loadURL("minuta://ui/index.html#panel");
  panel.webContents.on("did-finish-load", () => { listo.add(panel.webContents.id); enviarTodoPanel(); enviarEstado(); });
  panel.on("blur", () => setTimeout(() => { if (panel && !panel.isDestroyed() && !panel.isFocused()) panel.hide(); }, 120));
  abrirEnlacesFuera(panel);
}

function posicionarPanel() {
  const b = bandeja?.getBounds?.() || { x: 0, y: 0, width: 0, height: 0 };
  const punto = b.width ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(punto).workArea;
  const alto = Math.min(panelAlto, area.height - 20);
  const x = Math.round(Math.min(Math.max(punto.x - PANEL_ANCHO / 2, area.x + 6), area.x + area.width - PANEL_ANCHO - 6));
  // Barra de tareas abajo (lo normal en Windows) → el panel aparece encima; arriba (GNOME y otros) → debajo.
  const abajo = !b.width ? false : punto.y > area.y + area.height / 2;
  const y = Math.round(abajo ? area.y + area.height - alto - 6 : area.y + 6);
  panel.setBounds({ x, y, width: PANEL_ANCHO, height: alto });
}

function mostrarPanel() {
  if (!panel || panel.isDestroyed()) crearPanel();
  posicionarPanel();
  enviarTodoPanel();
  enviarEstado(true);
  panel.show(); panel.focus();
}
const alternarPanel = () => (panel?.isVisible() ? panel.hide() : mostrarPanel());

function crearBandeja() {
  bandeja = new Tray(icono(ES_WIN ? "bandeja-16.png" : "bandeja-32.png"));
  bandeja.setToolTip("Minuta");
  bandeja.on("click", alternarPanel);
  actualizarBandeja();
}

function actualizarBandeja() {
  if (!bandeja) return;
  const grabando = M.fase === "grabando";
  bandeja.setImage(icono(`${grabando ? "bandeja-grabando" : "bandeja"}-${ES_WIN ? 16 : 32}.png`));
  bandeja.setToolTip(grabando ? t("Minuta · grabando") : "Minuta");
  // En Linux muchos escritorios solo muestran el menú (no avisan el clic): todo lo importante está aquí también.
  bandeja.setContextMenu(Menu.buildFromTemplate([
    { label: t("Abrir panel"), click: mostrarPanel },
    { label: t("Abrir Minuta"), click: () => abrirVisor() },
    { type: "separator" },
    grabando ? { label: t("Detener y generar notas"), click: detener } : { label: t("Grabar ahora"), click: grabar },
    { type: "separator" },
    { label: t("Salir de Minuta"), click: salir },
  ]));
}

// ───────────────────────── Interfaz ⇄ app ─────────────────────────
function datosCompletos() {
  return {
    notas: Extras.notas(), temas: Temas.paraJS(), temaId: M.temaID, plataforma: PLATAFORMA, idioma: Idioma.paraJS(),
    categorias: M.categorias, agenda: Calendario.agendaJS(), correcciones: Extras.correcciones(), votos: Extras.votos(),
    ajustes: M.ajustes, perfil: Perfil.datos(), primeraVez: Perfil.falta, actualizacion: M.actualizacion, version: app.getVersion(),
  };
}
function enviarTodo(seleccion) {
  if (!cargada(ventana)) return;
  const d = datosCompletos();
  const s = seleccion || M.notaSeleccionada;
  if (s) d.seleccion = s;
  llamar(ventana, d);
  enviarEstadoAvisos();
}
function enviarTodoPanel() {
  if (!cargada(panel)) return;
  const d = datosCompletos();
  delete d.primeraVez;
  llamar(panel, d);
}
function notasCambiaron() { enviarTodo(); if (panel?.isVisible()) enviarTodoPanel(); }

function enviarEstado(abierto = false) {
  actualizarBandeja();
  if (!cargada(panel)) return;
  const d = { fase: M.fase, desde: M.desde, titulo: M.titulo, tipo: M.tipo, tipoAuto: M.tipoAuto, plataforma: M.plataforma, estado: M.estado,
    inicio: inicioAutomatico(), detectada: M.detectada, procesando: M.enCola.map((x) => x.titulo), actualizacion: M.actualizacion };
  if (abierto) d.abierto = true;
  llamarFuncion(panel, "panel", d);
}
function cambio() { enviarEstado(); }

function estadoAvisos() {
  return { permiso: Notification.isSupported() ? "si" : "no", estilo: "banners", sonido: true, calendario: Calendario.estado() };
}
function enviarEstadoAvisos() { for (const w of [ventana, panel]) llamar(w, { avisos: estadoAvisos(), ajustes: M.ajustes }); }

/** Texto que calcula la interfaz del panel (siempre cargada): preparación, compromisos, hábito, premios. */
async function textoJS(js) {
  if (!panel || panel.isDestroyed()) return null;
  try { return await panel.webContents.executeJavaScript(js); } catch { return null; }
}
async function premios(ruta) {
  enviarTodoPanel();
  await new Promise((r) => setTimeout(r, 400));
  const s = await textoJS(`JSON.stringify(window.Minuta && window.Minuta.premios ? window.Minuta.premios(${json(ruta)}) : null)`);
  try { return JSON.parse(s); } catch { return null; }
}

// ───────────────────────── Alerta flotante ─────────────────────────
const CABECERAS = { reunion: "MINUTA · REUNIÓN DETECTADA", fin: "MINUTA · ¿TERMINÓ LA REUNIÓN?", listo: "MINUTA · NOTAS LISTAS", logro: "MINUTA · ¡RECOMPENSA!" };
function mostrarAlerta(d, duracion) {
  ocultarAlerta();
  if (!alertaVentana || alertaVentana.isDestroyed()) {
    alertaVentana = new BrowserWindow({
      width: 392, height: 150, show: false, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, transparent: true,
      focusable: true, hasShadow: false, fullscreenable: false, backgroundColor: "#00000000",
      webPreferences: { preload: path.join(__dirname, "preload-alerta.js"), contextIsolation: true },
    });
    alertaVentana.setAlwaysOnTop(true, "screen-saver");
    alertaVentana.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    alertaVentana.loadURL("minuta://app/alerta.html");
  }
  alertaActual = { ...d, reloj: duracion ? setTimeout(() => ocultarAlerta(), duracion * 1000) : null };
  const enviar = () => {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    alertaVentana.setBounds({ x: area.x + area.width - 392 - 8, y: area.y + 4, width: 392, height: 150 });
    alertaVentana.webContents.send("mostrar", { tipo: d.tipo, cabecera: t(CABECERAS[d.tipo]), titulo: d.titulo, detalle: t(d.detalle || ""),
      principal: t(d.principal), secundario: t(d.secundario), desde: d.desde || 0, emoji: d.emoji || null, estilo: temaEstilo() });
    alertaVentana.showInactive();
  };
  if (alertaVentana.webContents.isLoading()) alertaVentana.webContents.once("did-finish-load", enviar); else enviar();
}
function ocultarAlerta(solo) {
  if (!alertaActual || (solo && alertaActual.tipo !== solo)) return;
  clearTimeout(alertaActual.reloj);
  alertaActual = null;
  alertaVentana?.hide();
}
ipcMain.on("alerta-respuesta", (_e, boton) => {
  const a = alertaActual;
  ocultarAlerta();
  if (!a) return;
  if (boton === "principal") a.alPrincipal?.(); else a.alSecundario?.();
});
ipcMain.on("alerta-alto", (_e, px) => {
  if (!alertaVentana || alertaVentana.isDestroyed()) return;
  const b = alertaVentana.getBounds();
  alertaVentana.setBounds({ ...b, height: Math.max(80, Math.min(400, Math.round(px))) });
});

function notificar(titulo, cuerpo, alClic) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: titulo, body: cuerpo, icon: path.join(ICONOS, "minuta-128.png"), silent: false });
  if (alClic) n.on("click", alClic);
  n.show();
}

// ───────────────────────── Detección de reuniones ─────────────────────────
function autoCategoria(appNombre) {
  if (M.tipoManual) return;
  const ev = Calendario.eventoActual();
  const id = Categorias.elegir(M.categorias, [M.titulo, ev?.titulo || ""].join(" "), ev?.correos || [], appNombre || M.detectada);
  if (id) { M.tipo = id; M.tipoAuto = true; }
}

function reunionDetectada(appNombre) {
  if (M.fase === "grabando" && (!M.plataforma || M.plataforma === appNombre)) { clearTimeout(finPendiente); ocultarAlerta("fin"); return; }
  if (M.fase !== "inactiva") return;
  M.detectada = appNombre;
  autoCategoria(appNombre);
  cambio();
  if (!M.ajustes.avisarDeteccion) return;
  const ev = Calendario.eventoActual();
  const titulo = ev?.titulo ? f("«{x}» en {x}", ev.titulo, appNombre) : f("Reunión en {x}", appNombre);
  alertaReunion(titulo, "Un clic y empiezo a grabar y tomar notas.", ev?.titulo || "");
}

function alertaReunion(titulo, detalle, tituloEvento) {
  mostrarAlerta({ tipo: "reunion", titulo, detalle, principal: "Grabar", secundario: "Ahora no",
    alPrincipal: () => { if (M.fase !== "inactiva") return; if (!M.titulo.trim() && tituloEvento) M.titulo = tituloEvento; grabar(); } }, 240);
}

function reunionTerminada(appNombre) {
  if (M.fase === "inactiva" && M.detectada === appNombre) { M.detectada = null; ocultarAlerta("reunion"); cambio(); return; }
  if (!M.ajustes.avisarFin || M.fase !== "grabando" || (M.plataforma && M.plataforma !== appNombre)) return;
  clearTimeout(finPendiente);
  finPendiente = setTimeout(async () => {
    if (M.fase !== "grabando" || (await detector.sigueActiva(appNombre))) return;
    const nombre = M.titulo.trim() ? `«${M.titulo.trim()}»` : t("Reunión");
    mostrarAlerta({ tipo: "fin", titulo: f("{x}: {x} se desconectó", nombre, appNombre), detalle: "sigo grabando", principal: "Terminó: generar notas",
      secundario: "Sigo en reunión", desde: M.desde, alPrincipal: detener });
  }, 8000);
}

// ───────────────────────── Grabación ─────────────────────────
function grabar() {
  if (M.fase !== "inactiva") return;
  const ahora = new Date(), dosD = (n) => String(n).padStart(2, "0");
  const nombre = `${ahora.getFullYear()}-${dosD(ahora.getMonth() + 1)}-${dosD(ahora.getDate())}_${dosD(ahora.getHours())}${dosD(ahora.getMinutes())}${dosD(ahora.getSeconds())}`;
  const dir = path.join(BASE, "grabaciones", nombre);
  try {
    fs.mkdirSync(dir, { recursive: true });
    escritores = { yo: new EscritorWav(path.join(dir, "yo.grabacion.wav")), ellos: new EscritorWav(path.join(dir, "ellos.grabacion.wav")) };
  } catch (e) { M.estado = `No pude grabar: ${e.message}`; cambio(); return; }
  M.carpeta = dir; M.desde = Date.now(); M.fase = "grabando"; M.estado = "";
  M.evento = Calendario.eventoActual();
  if (!M.titulo.trim() && M.evento?.titulo) M.titulo = M.evento.titulo;
  M.plataforma = M.detectada || "";
  autoCategoria();
  M.detectada = null;
  ocultarAlerta("reunion");
  if (M.ajustes.coachVivo) coach.empezar();
  // Windows: el audio del sistema llega por la grabadora (loopback). Linux: lo graba parec desde el monitor de la salida.
  if (!ES_WIN) grabarSistemaLinux();
  grabadora.webContents.send("empezar", { sistema: ES_WIN });
  cambio();
}

function grabarSistemaLinux() {
  const opciones = [
    ["parec", ["--device=@DEFAULT_MONITOR@", "--rate=16000", "--channels=1", "--format=s16le", "--latency-msec=100"]],
    ["pw-record", ["--rate", "16000", "--channels", "1", "--format", "s16", "-P", "{ stream.capture.sink = true }", "-"]],
  ];
  const probar = (i) => {
    if (i >= opciones.length) { M.estado = t("Solo micrófono: instala pulseaudio-utils (parec) para grabar a los demás."); cambio(); return; }
    const [cmd, args] = opciones[i];
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    let recibio = false;
    p.on("error", () => { if (!recibio) probar(i + 1); });
    p.stdout.on("data", (buf) => {
      recibio = true;
      escritores.ellos?.escribir(buf);
      coach.nivel(false, muestras(buf));
    });
    parec = p;
  };
  probar(0);
}

ipcMain.on("grabadora-bloque", (_e, pista, buf) => {
  if (pista === "dictado") return dictadoBloque(buf);
  const w = escritores[pista];
  if (!w || M.fase !== "grabando") return;
  w.escribir(buf);
  coach.nivel(pista === "yo", muestras(buf));
});
ipcMain.on("grabadora-listo", (_e, r) => {
  if (process.env.MINUTA_PRUEBAS === "1") console.log("grabadora:", JSON.stringify(r));
  if (dictado?.esperando) { dictado.esperando = false; if (!r.yo) { llamarFuncion(ventana, "dictado", { error: t("No pude usar el micrófono."), escuchando: false }); dictado = null; } return; }
  if (!r.yo) M.estado = r.errores?.yo === "permiso" ? t("Falta permiso de micrófono (Configuración > Privacidad > Micrófono).") : `${t("No pude usar el micrófono")}: ${r.errores?.yo || ""}`;
  else if (ES_WIN && !r.ellos) M.estado = `${t("Solo micrófono")}: ${r.errores?.ellos || ""}`;
  cambio();
});

function detener() {
  if (M.fase !== "grabando" || !M.carpeta) return;
  const dir = M.carpeta;
  clearTimeout(finPendiente);
  coach.detener();
  ocultarAlerta("fin");
  grabadora.webContents.send("detener");
  try { parec?.kill(); } catch {}
  parec = null;
  // Un respiro para que lleguen los últimos bloques antes de cerrar los archivos.
  setTimeout(() => {
    const yo = escritores.yo, ellos = escritores.ellos;
    yo?.cerrar(); ellos?.cerrar();
    const meta = {
      titulo: M.titulo.trim(), tipo: M.tipo, plataforma: M.plataforma, inicio: M.desde / 1000, fin: Date.now() / 1000,
      yo_primer_buffer: yo?.primero || 0, ellos_primer_buffer: ellos?.primero || 0,
      evento: M.evento?.titulo || "", asistentes: M.evento?.asistentes || [], correos: M.evento?.correos || [],
    };
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
    const nombre = meta.titulo || meta.evento || t("Reunión");
    Object.assign(M, { fase: "inactiva", titulo: "", tipoManual: false, tipoAuto: false, plataforma: "", evento: null, carpeta: null, estado: "" });
    escritores = {};
    M.enCola.push({ dir, titulo: nombre });
    cambio();
    procesarSiguiente();
  }, 400);
}

// ───────────────────────── Procesamiento (Python) ─────────────────────────
function entornoPython() {
  return { ...process.env, MINUTA_HERRAMIENTAS: herramientas(), MINUTA_RECURSOS: recursos(), PYTHONDONTWRITEBYTECODE: "1", PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8", PATH: [herramientas(), IA.path()].join(path.delimiter) };
}
function ejecutar(script, args, log) {
  return new Promise((fin) => {
    let salida;
    try { salida = fs.openSync(log, "w"); } catch { salida = "ignore"; }
    let p;
    try { p = spawn(python(), [path.join(recursos(), "bin", script), ...args], { env: entornoPython(), stdio: ["ignore", salida, salida], windowsHide: true }); }
    catch (e) { M.estado = `No pude ejecutar ${script}: ${e.message}`; return fin(false); }
    p.on("error", (e) => { M.estado = `No pude ejecutar ${script}: ${e.message}`; fin(false); });
    p.on("close", (c) => { if (typeof salida === "number") try { fs.closeSync(salida); } catch {} fin(c === 0); });
  });
}
async function correrScriptJSON(script, args) {
  const id = Math.random().toString(36).slice(2);
  const salida = path.join(os.tmpdir(), `minuta-${id}.json`), log = path.join(os.tmpdir(), `minuta-${script}.log`);
  await ejecutar(script, [...args, salida], log);
  const datos = leerJSON(salida);
  let error = "sin respuesta";
  try { error = fs.readFileSync(log, "utf8").trim().split("\n").pop() || error; } catch {}
  fs.rmSync(salida, { force: true });
  return { datos, error };
}

async function procesarSiguiente() {
  if (M.procesandoAhora || !M.enCola.length) return;
  const siguiente = M.enCola[0];
  M.procesandoAhora = siguiente.dir;
  const ok = await ejecutar("procesar.py", [siguiente.dir], path.join(siguiente.dir, "procesar.log"));
  M.procesandoAhora = null;
  M.enCola = M.enCola.filter((x) => x.dir !== siguiente.dir);
  let ruta = null;
  try { ruta = fs.readFileSync(path.join(siguiente.dir, "nota.txt"), "utf8").trim(); } catch {}
  if (ok && ruta) {
    M.ultimaNota = ruta; M.notaSeleccionada = ruta;
    M.estado = `Lista: ${path.basename(ruta, ".md")}`;
    notasCambiaron();
    anunciarNota(ruta);
    Respaldo.sincronizar();
  } else {
    M.estado = `Falló el procesamiento de «${siguiente.titulo}». Revisa procesar.log en ${path.basename(siguiente.dir)}.`;
    notificar(t("Minuta: error al procesar"), t("Revisa procesar.log"));
  }
  cambio();
  procesarSiguiente();
}

async function anunciarNota(ruta) {
  const nombre = path.basename(ruta, ".md").replace(/^\d{4}-\d{2}-\d{2} \d{4} - /, "");
  const p = await premios(ruta);
  const logros = p?.logros || [], rango = p?.rango;
  if (logros.length || rango) {
    let titulo, emoji, detalle;
    if (rango) {
      titulo = f("¡Subiste a «{x}»!", rango.nombre || ""); emoji = rango.emoji || "⬆️";
      detalle = logros.length ? f(logros.length > 1 ? "Y desbloqueaste {x} logros." : "Y desbloqueaste {x} logro.", String(logros.length)) : f("Con tu reunión «{x}».", nombre);
    } else {
      titulo = f("Desbloqueaste «{x}»", logros[0].nombre || ""); emoji = logros[0].emoji || "🏆";
      detalle = logros.length > 1 ? f(logros.length > 2 ? "Y {x} logros más." : "Y {x} logro más.", String(logros.length - 1)) : f("Con tu reunión «{x}».", nombre);
    }
    if (typeof p.xp === "number" && p.moneda) detalle += ` +${p.xp} ${p.moneda}`;
    mostrarAlerta({ tipo: "logro", titulo, detalle, principal: "Abrir", secundario: "Después", emoji, alPrincipal: () => abrirRevelacion(ruta) }, 300);
  } else if (M.ajustes.avisarNotas) {
    mostrarAlerta({ tipo: "listo", titulo: nombre, detalle: "Resumen, tu desempeño y el mensaje para enviar.", principal: "Ver notas", secundario: "Después",
      alPrincipal: () => abrirVisor(ruta) }, 120);
  }
}

function abrirRevelacion(ruta) {
  abrirVisor(ruta);
  const intentar = async (n) => {
    const r = await llamarFuncion(ventana, "revelar", ruta);
    if (r !== true && n < 20) setTimeout(() => intentar(n + 1), 350);
  };
  setTimeout(() => intentar(0), 300);
}

// ───────────────────────── Dictado del Gimnasio (whisper local, sin enviar audio) ─────────────────────────
function empezarDictado(silencio = 1.6) {
  callarVoz();
  dictado = { trozos: [], habla: false, silencio: 0, total: 0, finSilencio: silencio, esperando: true, piso: -60 };
  grabadora.webContents.send("empezar", { sistema: false, dictado: true });
  llamarFuncion(ventana, "dictado", { texto: "", escuchando: true, nivel: 0 });
}
function dictadoBloque(buf) {
  if (!dictado) return;
  dictado.trozos.push(Buffer.from(buf));
  const pcm = muestras(buf);
  let suma = 0; for (let i = 0; i < pcm.length; i++) { const v = pcm[i] / 32768; suma += v * v; }
  const db = 10 * Math.log10(Math.max(1e-9, suma / pcm.length));
  dictado.piso = db < dictado.piso ? db : dictado.piso + 0.05;
  const voz = db > Math.max(dictado.piso + 12, -50);
  const dt = pcm.length / 16000;
  dictado.total += dt;
  if (voz) { dictado.habla = true; dictado.silencio = 0; } else dictado.silencio += dt;
  llamarFuncion(ventana, "dictado", { texto: dictado.habla ? "…" : "", escuchando: true, nivel: Math.max(0, Math.min(1, (db + 60) / 50)) });
  if ((dictado.habla && dictado.silencio >= dictado.finSilencio) || dictado.total > 120) terminarDictado(true);
  else if (!dictado.habla && dictado.total > 20) terminarDictado(false);
}
async function terminarDictado(enviar) {
  if (!dictado) return;
  const d = dictado; dictado = null;
  grabadora.webContents.send("detener");
  if (!enviar || !d.habla) { llamarFuncion(ventana, "dictado", { texto: "", final: true, escuchando: false }); return; }
  llamarFuncion(ventana, "dictado", { texto: t("Transcribiendo…"), escuchando: false });
  const wav = path.join(os.tmpdir(), `minuta-dictado-${Date.now()}.wav`);
  const w = new EscritorWav(wav);
  for (const b of d.trozos) w.escribir(b);
  w.cerrar();
  const texto = await transcribirCorto(wav);
  fs.rmSync(wav, { force: true });
  llamarFuncion(ventana, "dictado", { texto, final: true, escuchando: false });
}
function transcribirCorto(wav) {
  return new Promise((fin) => {
    const exe = path.join(herramientas(), ES_WIN ? "whisper-cli.exe" : "whisper-cli");
    const elegido = Modelos.transcripcion.find((m) => m.id === Perfil.datos().modelo_whisper);
    const modelo = [elegido, ...Modelos.transcripcion].filter(Boolean).map((m) => path.join(Modelos.carpeta, m.archivo)).find((r) => fs.existsSync(r));
    if (!fs.existsSync(exe) || !modelo) return fin("");
    const idioma = (Perfil.datos().idioma_audio || "auto").trim() || "auto";
    let out = "";
    const p = spawn(exe, ["-m", modelo, "-l", idioma, "-t", String(Math.max(2, Math.min(8, os.cpus().length))), "-f", wav, "-nt", "-np"], { windowsHide: true });
    p.stdout.on("data", (x) => (out += x));
    p.on("error", () => fin(""));
    p.on("close", () => fin(out.replace(/\s+/g, " ").trim()));
  });
}

/** Voz de la contraparte en el Gimnasio: la del sistema (Web Speech en la propia ventana). */
function hablar(texto) {
  if (!ventana) return;
  const js = `(() => { const s = window.speechSynthesis; const fin = () => window.Minuta && window.Minuta.vozTermino && window.Minuta.vozTermino();
    if (!s) return fin(); s.cancel(); const u = new SpeechSynthesisUtterance(${json(texto)});
    const voces = s.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith(${json(Idioma.codigo() === "en" ? "en" : "es")}));
    const orden = ["es-cl", "es-419", "es-mx", "es-us", "es-ar", "es-co", "es-es"];
    voces.sort((a, b) => (orden.indexOf(a.lang.toLowerCase()) + 99) % 99 - (orden.indexOf(b.lang.toLowerCase()) + 99) % 99);
    if (voces[0]) u.voice = voces[0]; else if (!s.getVoices().length) return fin();
    u.onend = fin; u.onerror = fin; s.speak(u); })()`;
  ventana.webContents.executeJavaScript(js).catch(() => {});
}
function callarVoz() { ventana?.webContents.executeJavaScript("window.speechSynthesis && window.speechSynthesis.cancel()").catch(() => {}); }

// ───────────────────────── Recordatorios: archivo de calendario (.ics) ─────────────────────────
function crearRecordatorios(lista) {
  const ahora = new Date(), sello = ahora.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const fecha = (ms) => { const d = new Date(ms); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; };
  const eventos = lista.filter((d) => d.titulo).map((d, i) => {
    const dia = fecha(d.fecha || ahora.getTime() + 86400000);
    return ["BEGIN:VEVENT", `UID:minuta-${sello}-${i}@minuta`, `DTSTAMP:${sello}`, `DTSTART;VALUE=DATE:${dia}`, `SUMMARY:${esc(d.titulo)}`,
      d.notas ? `DESCRIPTION:${esc(d.notas)}` : "", "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(d.titulo)}`, "TRIGGER:PT9H", "END:VALARM", "END:VEVENT"].filter(Boolean).join("\r\n");
  });
  if (!eventos.length) return t("No hay compromisos abiertos");
  const archivo = path.join(os.tmpdir(), `Minuta-compromisos-${sello}.ics`);
  fs.writeFileSync(archivo, ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Minuta//ES", ...eventos, "END:VCALENDAR"].join("\r\n"));
  shell.openPath(archivo);
  return f("⏰ {n} compromisos abiertos en tu calendario", String(eventos.length));
}

// ───────────────────────── Inicio automático ─────────────────────────
const autostart = path.join(os.homedir(), ".config", "autostart", "minuta.desktop");
function inicioAutomatico() {
  if (ES_WIN) return app.getLoginItemSettings().openAtLogin;
  return fs.existsSync(autostart);
}
function cambiarInicioAutomatico(activo) {
  if (ES_WIN) return app.setLoginItemSettings({ openAtLogin: !!activo, args: ["--oculta"] });
  if (!activo) return fs.rmSync(autostart, { force: true });
  fs.mkdirSync(path.dirname(autostart), { recursive: true });
  const exe = process.env.APPIMAGE || process.execPath;
  fs.writeFileSync(autostart, `[Desktop Entry]\nType=Application\nName=Minuta\nExec="${exe}" --oculta\nX-GNOME-Autostart-enabled=true\n`);
}

// ───────────────────────── Acciones de la interfaz (host.enviar) ─────────────────────────
const ACCIONES = {
  tema: (d) => { if (d.id) { M.temaID = d.id; Temas.guardarId(d.id); llamar(panel, { temaId: d.id }); } },
  tipo: (d) => { if (M.categorias.some((c) => c.id === d.tipo)) { M.tipo = d.tipo; M.tipoManual = true; M.tipoAuto = false; cambio(); } },
  titulo: (d) => { M.titulo = String(d.texto || ""); },
  grabar: (d) => { if (typeof d.titulo === "string") M.titulo = d.titulo; grabar(); },
  detener: () => detener(),
  copiar: (d) => clipboard.writeText(String(d.texto || "")),
  copiarFormato: (d) => clipboard.write({ text: String(d.texto || ""), html: typeof d.html === "string" ? d.html : undefined }),
  obsidian: async (d) => {
    if (!d.ruta) return;
    try { await shell.openExternal(`obsidian://open?path=${encodeURIComponent(d.ruta)}`); } catch { shell.openPath(d.ruta); }
  },
  finder: (d) => d.ruta && shell.showItemInFolder(d.ruta),
  seleccion: (d) => { if (d.ruta) M.notaSeleccionada = d.ruta; },
  abrir: (d) => { if (/^(https|mailto|msteams|obsidian):/.test(String(d.url || ""))) shell.openExternal(d.url); },
  abrirURL: (d) => { if (/^https:\/\//.test(String(d.url || ""))) shell.openExternal(d.url); },
  reescribir: (d) => { if (Extras.reescribir(d.ruta, d.texto)) notasCambiaron(); },
  correccion: (d) => Extras.agregarCorreccion(d),
  quitarCorreccion: (d) => d.de && Extras.quitarCorreccion(d.de),
  voto: (d) => Extras.votar(d),
  crearUniverso: async (d) => {
    const nombre = String(d.nombre || "").trim();
    if (!nombre) return;
    const log = path.join(BASE, "universo.log");
    const ok = await ejecutar("universo.py", [nombre, String(d.notas || "")], log);
    let linea = "ERROR sin respuesta";
    try { linea = fs.readFileSync(log, "utf8").split("\n").filter((l) => /^(OK|ERROR) /.test(l)).pop() || linea; } catch {}
    notasCambiaron();
    if (ok && linea.startsWith("OK ")) {
      const [id, ...resto] = linea.slice(3).split(" ");
      notificar(`${t("Universo listo")}: ${resto.join(" ") || nombre}`, t("Ábrelo en la galería de universos."));
      llamarFuncion(ventana, "forjado", { ok: true, id, nombre: resto.join(" ") || nombre });
    } else llamarFuncion(ventana, "forjado", { ok: false, error: linea.slice(6) });
  },
  ajustesAvisos: (d) => { M.ajustes = Ajustes.desdeJS(d.ajustes || {}); Ajustes.guardar(M.ajustes); },
  abrirAjustesAvisos: (_d, w) => (ES_WIN ? shell.openExternal("ms-settings:notifications") : llamarFuncion(w, "aviso", { t: t("Actívalas en la configuración de notificaciones de tu escritorio.") })),
  abrirAjustesCalendario: () => enVisor("window.Minuta && window.Minuta.ir('preferencias')"),
  pedirAvisos: () => enviarEstadoAvisos(),
  pedirCalendario: () => enviarEstadoAvisos(),
  estadoAvisos: () => enviarEstadoAvisos(),
  probarAviso: () => mostrarAlerta({ tipo: "reunion", titulo: "«Daily del equipo» en Microsoft Teams", detalle: "Así se ve el aviso (es una prueba: no graba).",
    principal: "Grabar", secundario: "Ahora no" }, 20),
  borrarUniverso: async (d) => {
    if (await Extras.borrarUniverso(String(d.id || ""))) { if (M.temaID === d.id && !Temas.existe(d.id)) { M.temaID = "cine"; Temas.guardarId("cine"); } notasCambiaron(); }
  },
  calendarioICS: async (d, w) => {
    const r = await Calendario.conectar(String(d.url || "").trim());
    llamarFuncion(w, "aviso", { t: r.ok ? f("Calendario conectado: {n} reuniones próximas ✓", String(r.eventos)) : r.error });
    notasCambiaron();
  },
  // ── Asistente de bienvenida ──
  bienvenidaEstado: (_d, w) => {
    const c = Perfil.carpetaNotas();
    llamarFuncion(w, "bienvenida", { ia: IA.paraJS(), modelos: Modelos.paraJS(), perfil: Perfil.datos(), carpeta: corta(c), notas: Respaldo.contarNotas(c),
      tokens: { github: !!Respaldo.token("github"), gitlab: !!Respaldo.token("gitlab") }, plataforma: PLATAFORMA });
    enviarEstadoAvisos();
  },
  probarIA: async (d, w) => {
    const id = d.id || "claude";
    const r = await IA.probar(id);
    if (r.ok) Perfil.mezclar({ ia: id });
    llamarFuncion(w, "iaProbada", { id, ok: r.ok, texto: r.texto });
  },
  descargarModelo: async (d, w) => {
    const id = d.id || Modelos.recomendado;
    let ultimo = -1;
    try {
      await Modelos.descargar(id, (x) => { const pct = Math.floor(x * 100); if (pct !== ultimo) { ultimo = pct; llamarFuncion(w, "modeloProgreso", { id, pct }); } });
      Perfil.mezclar({ modelo_whisper: id });
      llamarFuncion(w, "modeloListo", { id, ok: true, error: "", modelos: Modelos.paraJS() });
    } catch (e) { llamarFuncion(w, "modeloListo", { id, ok: false, error: String(e.message || e), modelos: Modelos.paraJS() }); }
  },
  elegirCarpetaNotas: async (_d, w) => {
    const r = await Respaldo.elegirCarpeta(w);
    if (!r) return;
    Perfil.mezclar({ carpeta_notas: corta(r) });
    llamarFuncion(w, "carpetaNotas", { ruta: corta(r), notas: Respaldo.contarNotas(r) });
    enviarTodo();
  },
  clonarNotas: async (d, w) => {
    const url = String(d.url || "");
    if (!url.startsWith("https://")) return;
    const proveedor = url.includes("gitlab") ? "gitlab" : "github";
    if (d.token) Respaldo.guardarToken(String(d.token), proveedor);
    const nombre = path.basename(new URL(url).pathname).replace(/\.git$/, "") || "notas";
    const destino = path.join(os.homedir(), "Documents", "Minuta", nombre);
    const r = await Respaldo.clonar(url, proveedor, destino);
    if (r.ok) { Perfil.mezclar({ carpeta_notas: corta(destino), respaldo: proveedor, respaldo_remoto: url }); enviarTodo(); }
    llamarFuncion(w, "repoNotas", { ok: r.ok, texto: r.ok ? corta(destino) : r.texto.slice(-300), notas: r.ok ? Respaldo.contarNotas(destino) : 0 });
  },
  crearRepoNotas: async (d, w) => {
    if (!d.proveedor || !d.token) return;
    const r = await Respaldo.crearRepo(d.proveedor, String(d.token), String(d.nombre || "") || "minuta-notas", Perfil.carpetaNotas());
    llamarFuncion(w, "repoNotas", { ok: r.ok, texto: String(r.texto).slice(-300), creado: true });
  },
  pedirMicrofono: async (_d, w) => {
    // Windows pide (o no) el permiso al usar el micrófono; aquí se revisa que esté permitido en Configuración.
    const ok = ES_WIN ? systemPreferences.getMediaAccessStatus("microphone") !== "denied" : true;
    llamarFuncion(w, "permisoMicrofono", { ok });
    if (!ok) shell.openExternal("ms-settings:privacy-microphone");
  },
  terminarBienvenida: (d) => {
    Perfil.mezclar(d.perfil || {});
    if (Perfil.falta) Perfil.guardar(Perfil.datos());
    Idioma.olvidar();
    if (d.tema) { M.temaID = d.tema; Temas.guardarId(d.tema); }
    actualizarBandeja();
    notasCambiaron();
  },
  // ── Actualizaciones ──
  buscarActualizacion: () => buscarActualizacion(),
  actualizar: async (_d, w) => {
    // Desde el panel: se abre la ventana y el avance se muestra ahí.
    if (panel && w === panel) { panel.hide(); return enVisor("window.Minuta && window.Minuta.iniciarActualizacion && window.Minuta.iniciarActualizacion()"); }
    if (M.fase !== "inactiva" || M.enCola.length) return llamarFuncion(w, "actualizacionProgreso", { paso: "error", texto: t("Termina la grabación y espera a que se generen las notas antes de actualizar.") });
    // El aviso de actualización pasa a mostrar el avance (descargar → instalar), sin alertas.
    try { await Actualizaciones.instalar((d) => llamarFuncion(w, "actualizacionProgreso", d)); }
    catch (e) { llamarFuncion(w, "actualizacionProgreso", { paso: "error", texto: String(e.message || e) }); }
  },
  catalogo: async (d, w) => {
    const tipo = d.tipo === "idiomas" ? "idiomas" : "universos";
    const r = await Catalogo.indice(tipo);
    llamarFuncion(w, "catalogo", { tipo, lista: r.lista, ...(r.error ? { error: r.error } : {}) });
  },
  descargarUniverso: async (d, w) => {
    const error = await Catalogo.descargarUniverso(String(d.id || ""));
    if (!error && d.usar) { M.temaID = d.id; Temas.guardarId(d.id); }
    notasCambiaron();
    llamarFuncion(w, "descargado", { tipo: "universo", id: d.id, ok: !error, error: error || "" });
  },
  descargarIdioma: async (d, w) => {
    const error = await Catalogo.descargarIdioma(String(d.codigo || ""));
    llamarFuncion(w, "descargado", { tipo: "idioma", id: d.codigo, ok: !error, error: error || "", instalados: Idioma.instalados() });
  },
  perfil: (d) => { Perfil.mezclar(d.cambios || {}); Idioma.olvidar(); actualizarBandeja(); notasCambiaron(); },
  corregirIA: async (d, w) => {
    // La IA corrige la nota según lo que la persona dijo en palabras (bin/corregir.py).
    const archivo = path.join(os.tmpdir(), `minuta-corregir-${Date.now()}.txt`);
    fs.writeFileSync(archivo, String(d.instruccion || ""));
    const r = await correrScriptJSON("corregir.py", [String(d.ruta || ""), archivo]);
    fs.rmSync(archivo, { force: true });
    notasCambiaron();
    llamarFuncion(w, "corregido", r.datos || { ok: false, error: r.error });
  },
  comentariosCuenta: async (d, w) => llamarFuncion(w, "comentariosCuenta", { usuario: await Comentarios.cuenta() }),
  votarUniverso: async (d, w) => {
    const r = await Comentarios.votar(Number(d.numero), d.positivo !== false);
    llamarFuncion(w, "votado", { id: d.id, ok: r.ok, nuevo: r.nuevo, positivo: d.positivo !== false });
  },
  comentarios: async (d, w) => {
    if (d.directo) {
      // Con la cuenta de GitHub de la persona (la del respaldo): se publica sin abrir el navegador.
      const r = await Comentarios.publicar(d.repo, String(d.titulo || ""), String(d.cuerpo || ""), String(d.etiqueta || "comentario"));
      return llamarFuncion(w, "comentarioEnviado", r);
    }
    const u = new URL(`https://github.com/${Comentarios.repos[d.repo] || Comentarios.repos.app}/issues/new`);
    u.searchParams.set("title", String(d.titulo || "")); u.searchParams.set("body", String(d.cuerpo || "")); u.searchParams.set("labels", String(d.etiqueta || "comentario"));
    shell.openExternal(u.toString());
  },
  gimnasio: async (d, w) => {
    if (!d.modo || d.entrada == null) return;
    const archivo = path.join(os.tmpdir(), `minuta-gym-${Date.now()}.json`);
    fs.writeFileSync(archivo, json(d.entrada));
    const r = await correrScriptJSON("gimnasio.py", [d.modo, archivo]);
    fs.rmSync(archivo, { force: true });
    llamarFuncion(w, "gym", { modo: d.modo, ok: !!r.datos, ...(r.datos ? { datos: r.datos } : { error: r.error }) });
  },
  redactar: async (d, w) => {
    if (!d.ruta) return;
    const g = !d.forzar && Extras.mensajeGuardado(d.ruta);
    if (g) return llamarFuncion(w, "redactado", { ok: true, texto: g.texto || "", asunto: g.asunto || "", guardado: true, editado: !!g.editado });
    llamarFuncion(w, "redactando", {});
    const archivo = path.join(os.tmpdir(), `minuta-indic-${Date.now()}.json`);
    fs.writeFileSync(archivo, json({ indicaciones: String(d.indicaciones || ""), forzar: !!d.forzar }));
    const r = await correrScriptJSON("redactar.py", [d.ruta, archivo]);
    fs.rmSync(archivo, { force: true });
    llamarFuncion(w, "redactado", { ok: !!r.datos, texto: r.datos?.texto || "", asunto: r.datos?.asunto || "", error: r.error });
  },
  guardarMensaje: (d) => d.ruta && Extras.guardarMensaje(d.ruta, String(d.asunto || ""), String(d.texto || "")),
  recordatorios: (d, w) => {
    const lista = Array.isArray(d.lista) ? d.lista : [];
    llamarFuncion(w, "aviso", { t: lista.length ? crearRecordatorios(lista) : t("No hay compromisos abiertos") });
  },
  hablar: (d) => { if (dictado) terminarDictado(false); if (d.texto) hablar(String(d.texto)); },
  escuchar: (d) => empezarDictado(typeof d.silencio === "number" ? d.silencio : 1.6),
  dejarDeEscuchar: (d) => terminarDictado(!!d.enviar),
  callar: (d) => { callarVoz(); if (d.mic !== false) terminarDictado(false); },
  preguntar: async (d, w) => {
    if (!d.id || !d.pregunta) return;
    const r = await correrScriptJSON("preguntar.py", [String(d.pregunta)]);
    llamarFuncion(w, "respuesta", { id: d.id, ok: !!r.datos, ...(r.datos ? { respuesta: r.datos.respuesta || "", fuentes: r.datos.fuentes || [] } : { error: r.error }) });
  },
  categorias: (d) => { const l = Categorias.desdeJS(d.lista); if (l) { M.categorias = l; Categorias.guardar(l); if (!l.some((c) => c.id === M.tipo)) { M.tipo = l[0].id; M.tipoManual = false; } notasCambiaron(); } },
  borrar: async (d) => { if (await Extras.borrarNota(String(d.ruta || ""))) { if (M.notaSeleccionada === d.ruta) M.notaSeleccionada = null; notasCambiaron(); } },
  ventana: (d, w) => {
    if (!w || w === panel) return;
    if (d.op === "cerrar") w.close();
    else if (d.op === "minimizar") w.minimize();
    else if (d.op === "pantalla") w.setFullScreen(!w.isFullScreen());
    else if (d.op === "zoom") (w.isMaximized() ? w.unmaximize() : w.maximize());
  },
  regiones: () => {},
  // ── Panel de la bandeja ──
  semana: async () => {
    M.estado = t("Generando resumen semanal…"); cambio();
    const ok = await ejecutar("semana.py", [], path.join(BASE, "semana.log"));
    let ruta = null;
    try { ruta = fs.readFileSync(path.join(BASE, "ultimo-semanal.txt"), "utf8").trim(); } catch {}
    M.estado = ok && ruta ? t("Resumen semanal listo.") : t("No pude generar el resumen semanal (ver semana.log).");
    if (ok && ruta) shell.openExternal(`obsidian://open?path=${encodeURIComponent(ruta)}`).catch(() => shell.openPath(ruta));
    cambio();
  },
  visor: (d) => { panel?.hide(); abrirVisor(d.ruta || null); },
  inicio: (d) => { cambiarInicioAutomatico(!!d.activo); cambio(); },
  preferencias: () => { panel?.hide(); enVisor("window.Minuta && window.Minuta.ir && window.Minuta.ir('preferencias')"); },
  visorEnviar: (d) => { if (!d.ruta) return; panel?.hide(); abrirVisor(d.ruta); enVisor(`window.Minuta && window.Minuta.abrirEnviar(${json(d.ruta)})`); },
  prep: (d) => { panel?.hide(); enVisor(d.id ? `window.Minuta && window.Minuta.irBrief(${json(d.id)})` : "window.Minuta && window.Minuta.ir('agenda')"); },
  salir: () => salir(),
  cerrarPanel: () => panel?.hide(),
  panelAlto: (d) => {
    const a = Number(d.alto);
    if (a > 100 && Math.abs(a - panelAlto) > 1) { panelAlto = Math.round(a); if (panel?.isVisible()) posicionarPanel(); }
  },
};

ipcMain.on("minuta", async (e, msg) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const fn = msg && ACCIONES[msg.accion];
  if (!fn) return;
  try { await fn(msg, w); } catch (err) { console.error("Minuta:", msg.accion, err); }
});

async function buscarActualizacion() {
  const r = await Actualizaciones.revisar();
  M.actualizacion = { ...r, version: app.getVersion() };
  llamarFuncion(ventana, "actualizacion", M.actualizacion);
  enviarEstado();
}

function salir() {
  if (M.fase === "grabando") detener();
  setTimeout(() => { app.exit(0); }, M.fase === "grabando" ? 900 : 50);
}

// ───────────────────────── Arranque ─────────────────────────
app.on("second-instance", () => abrirVisor());
app.on("window-all-closed", () => {}); // sigue viva en la bandeja

app.whenReady().then(async () => {
  asegurarCarpetas();
  // minuta://ui/… → interfaz (recursos/ui); minuta://app/… → páginas propias de esta app (grabadora, alerta).
  protocol.handle("minuta", (req) => {
    const u = new URL(req.url);
    const raiz = u.host === "ui" ? path.join(recursos(), "ui") : u.host === "app" ? __dirname : null;
    const ruta = raiz && path.normalize(path.join(raiz, decodeURIComponent(u.pathname)));
    if (!ruta || !ruta.startsWith(raiz)) return new Response("no", { status: 404 });
    return net.fetch(require("url").pathToFileURL(ruta).toString());
  });
  // Audio del sistema en Windows: getDisplayMedia recibe la pantalla principal + "loopback" (todo lo que suena).
  session.defaultSession.setDisplayMediaRequestHandler((_req, responder) => {
    desktopCapturer.getSources({ types: ["screen"] }).then((s) => responder({ video: s[0], audio: "loopback" })).catch(() => responder({}));
  });
  session.defaultSession.setPermissionRequestHandler((_wc, permiso, ok) => ok(["media", "clipboard-sanitized-write", "notifications"].includes(permiso)));

  M.categorias = Categorias.cargar();
  M.tipo = M.categorias[0]?.id || "Otra";
  M.ajustes = Ajustes.cargar();
  M.temaID = Temas.idGuardado();
  try { const u = fs.readFileSync(path.join(BASE, "ultima-nota.txt"), "utf8").trim(); if (fs.existsSync(u)) M.ultimaNota = u; } catch {}

  grabadora = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, "preload-grabadora.js"), contextIsolation: true, backgroundThrottling: false } });
  grabadora.loadURL("minuta://app/grabadora.html");

  coach.alActualizar = (d) => {
    if (bandeja) bandeja.setToolTip(d.racha >= 60 ? `Minuta · ${Math.floor(d.racha / 60)}:${String(d.racha % 60).padStart(2, "0")}` : t("Minuta · grabando"));
    if (panel?.isVisible()) llamarFuncion(panel, "vivo", d);
  };
  coach.alMonologoLargo = (seg) => {
    if (M.ajustes.avisoMonologo) notificar(f("Llevas {x} hablando", `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, "0")}`), t("Buen momento para una pregunta: «¿cómo lo ven ustedes?»"));
  };
  detector.alDetectar = reunionDetectada;
  detector.alTerminar = reunionTerminada;
  detector.iniciar();
  Calendario.iniciar({ alAviso: (titulo, detalle, tituloEvento) => { if (M.ajustes.avisarCalendario && M.fase === "inactiva") alertaReunion(titulo, detalle, tituloEvento); },
    alCambio: () => notasCambiaron(), t, f });

  crearBandeja();
  crearPanel();
  if (Perfil.falta || !process.argv.includes("--oculta")) setTimeout(() => abrirVisor(), 300);
  setTimeout(buscarActualizacion, 20000);
  setInterval(buscarActualizacion, 6 * 3600 * 1000);
  if (process.argv.includes("--prueba-deteccion")) setTimeout(() => reunionDetectada("Microsoft Teams"), 2000);
});

// Pruebas automáticas (escritorio/pruebas): acceso al estado y a las acciones desde Playwright.
if (process.env.MINUTA_PRUEBAS === "1") global.minutaPruebas = { M, ACCIONES, grabar, detener, enviarTodo, datosCompletos, mostrarPanel, abrirVisor, mostrarAlerta, ventanas: () => ({ ventana, panel, alertaVentana }) };
